import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { supabase } from "@/integrations/supabase/client";

/**
 * Global error sink (A50): forward uncaught errors and unhandled rejections to
 * the backend so client-side failures are visible in turn_metrics.
 * Fire-and-forget, never throws, rate-limited to 5 posts per minute.
 */
const installClientErrorSink = () => {
  const sentAt: number[] = [];
  const post = (rawMessage: unknown) => {
    try {
      const now = Date.now();
      while (sentAt.length > 0 && now - sentAt[0] > 60_000) sentAt.shift();
      if (sentAt.length >= 5) return;
      sentAt.push(now);
      const message = String(rawMessage ?? "unknown").slice(0, 500);
      const sessionId = (() => {
        try {
          return localStorage.getItem("chat-session-id") || "none";
        } catch {
          return "none";
        }
      })();
      supabase.functions
        .invoke("chat-proxy", {
          body: {
            action: "client_error",
            message,
            sessionId,
            timestamp: new Date().toISOString(),
          },
        })
        .catch(() => {
          /* fire-and-forget */
        });
    } catch {
      /* the sink itself must never throw */
    }
  };

  window.onerror = (message, _source, _lineno, _colno, error) => {
    post(error?.message || message);
  };
  window.onunhandledrejection = (event) => {
    const reason = event.reason;
    post(reason instanceof Error ? reason.message : reason);
  };
};

installClientErrorSink();

createRoot(document.getElementById("root")!).render(<App />);
