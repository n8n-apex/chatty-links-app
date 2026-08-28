import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

/**
 * Global drop guard. Without it, a file dropped anywhere except the composer
 * makes the browser navigate the frame to the raw file — inside the iframe
 * there is no way back, and the draft text is lost. A drop anywhere in the
 * app should ATTACH the file: we forward it to the composer via a custom
 * event, unless the drop already landed on the composer form itself (which
 * has its own handlers).
 */
const GLOBAL_DROP_EVENT = "lawgpt:global-drop";

const useGlobalDropGuard = () => {
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      const target = e.target as HTMLElement | null;
      // The composer <form> handles its own drops; don't double-attach.
      if (target?.closest?.("form")) return;
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length > 0) {
        window.dispatchEvent(new CustomEvent(GLOBAL_DROP_EVENT, { detail: files }));
      }
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);
};

const App = () => {
  useGlobalDropGuard();
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Index />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;
