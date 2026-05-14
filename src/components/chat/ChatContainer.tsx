import { useState, useRef, useEffect, useCallback } from "react";
import { AnimatePresence } from "framer-motion";
import { Menu, MessageSquare, FileText, Search } from "lucide-react";
import { Message } from "@/types/chat";
import { ChatHeader } from "./ChatHeader";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { TypingIndicator } from "./TypingIndicator";
import { EmptyState } from "./EmptyState";
import { ConversationSidebar, ConversationSummary } from "./ConversationSidebar";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const ChatContainer = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [currentUserEmail, setCurrentUserEmail] = useState(() => {
    if (typeof window === "undefined") return "preview@test.com";
    const emailFromUrl = new URLSearchParams(window.location.search).get("email");
    return emailFromUrl || "preview@test.com";
  });
  const isUnresolvedEmail = currentUserEmail.includes("{{") || currentUserEmail.includes("}}");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  // Sidebar is always available; conversations are filtered by user_email so each
  // email only sees its own history.
  const historyEnabled = true;
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth >= 768;
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);

  // Load conversations list for the current user
  const loadConversations = useCallback(async () => {
    if (!currentUserEmail) return [] as ConversationSummary[];
    const { data, error } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("user_email", currentUserEmail)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Fehler beim Laden des Verlaufs:", error);
      return [];
    }

    const map = new Map<string, { firstUserMsg?: string; lastAt: Date }>();
    for (const row of data || []) {
      const cid = (row as any).conversation_id || "legacy";
      const existing = map.get(cid) || { lastAt: new Date(row.created_at) };
      if (!existing.firstUserMsg && row.role === "user") {
        existing.firstUserMsg = row.content;
      }
      existing.lastAt = new Date(row.created_at);
      map.set(cid, existing);
    }

    const list: ConversationSummary[] = Array.from(map.entries()).map(([id, v]) => ({
      id,
      title: (v.firstUserMsg || "Neues Gespräch").slice(0, 40),
      lastAt: v.lastAt,
    }));
    list.sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
    setConversations(list);
    return list;
  }, [currentUserEmail]);

  const loadConversationMessages = useCallback(
    async (cid: string) => {
      if (!currentUserEmail) return;
      let query = supabase
        .from("chat_messages")
        .select("*")
        .eq("user_email", currentUserEmail)
        .order("created_at", { ascending: true });

      query = cid === "legacy" ? query.is("conversation_id", null) : query.eq("conversation_id", cid);

      const { data, error } = await query;
      if (error) {
        console.error("Fehler beim Laden der Nachrichten:", error);
        return;
      }
      const restored: Message[] = (data || []).map((row: any) => ({
        id: row.id,
        content: row.content,
        role: row.role === "ai" ? "assistant" : "user",
        timestamp: new Date(row.created_at),
      }));
      setMessages(restored);
    },
    [currentUserEmail],
  );

  useEffect(() => {
    (async () => {
      if (historyEnabled) {
        await loadConversations();
      } else {
        setConversations([]);
      }
      // Always start with a fresh empty conversation on mount/refresh.
      // The sessionId sent to n8n MUST equal the conversationId so that
      // gpt_session_context starts clean for every new conversation.
      const freshId = crypto.randomUUID();
      setConversationId(freshId);
      localStorage.setItem("chat-session-id", freshId);
      setMessages([]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserEmail]);

  const persistMessage = async (role: "user" | "ai", content: string) => {
    if (!currentUserEmail || !content || !conversationId) return;
    const { error } = await supabase.from("chat_messages").insert({
      user_email: currentUserEmail,
      role,
      content,
      conversation_id: conversationId,
    });
    if (error) console.error("Fehler beim Speichern der Nachricht:", error);
  };

  const handleNewConversation = () => {
    // sessionId sent to n8n == conversationId, so a new conversation
    // always means a fresh, empty gpt_session_context on the backend.
    const newId = crypto.randomUUID();
    setConversationId(newId);
    localStorage.setItem("chat-session-id", newId);
    setMessages([]);
    if (typeof window !== "undefined" && window.innerWidth < 768) setSidebarOpen(false);
  };

  const handleSelectConversation = async (cid: string) => {
    setConversationId(cid);
    // Keep n8n session aligned with the selected conversation.
    localStorage.setItem("chat-session-id", cid);
    await loadConversationMessages(cid);
    if (typeof window !== "undefined" && window.innerWidth < 768) setSidebarOpen(false);
  };

  const handleDeleteConversation = async (cid: string) => {
    if (!currentUserEmail) return;
    let query = supabase.from("chat_messages").delete().eq("user_email", currentUserEmail);
    query = cid === "legacy" ? query.is("conversation_id", null) : query.eq("conversation_id", cid);
    const { error } = await query;
    if (error) {
      console.error("Fehler beim Löschen:", error);
      toast.error("Gespräch konnte nicht gelöscht werden.");
      return;
    }
    toast.success("Gespräch gelöscht");
    if (conversationId === cid) {
      setMessages([]);
      setConversationId(crypto.randomUUID());
    }
    await loadConversations();
  };

  const toBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove the data URL prefix (data:application/pdf;base64,)
        const base64 = result.split(",")[1];
        console.log("[PDF DEBUG 1] FileReader onload fired");
        console.log("[PDF DEBUG 2] base64 length:", base64?.length);
        console.log("[PDF DEBUG 3] base64 preview:", base64?.substring(0, 80));
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const sendMessage = async (content: string, file?: File | null, ziel?: string) => {
    const displayContent = file ? (content ? `📎 [${file.name}] — ${content}` : `📎 [${file.name}]`) : content;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      content: displayContent,
      role: "user",
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    persistMessage("user", displayContent);

    // sessionId sent to n8n is ALWAYS the current conversationId.
    // This guarantees gpt_session_context is scoped to this conversation
    // and that a new conversation = a brand-new, empty server-side session.
    const sessionId = conversationId || crypto.randomUUID();
    if (sessionId !== localStorage.getItem("chat-session-id")) {
      localStorage.setItem("chat-session-id", sessionId);
    }

    // Build payload
    let payload: Record<string, unknown> = {
      sessionId,
      timestamp: new Date().toISOString(),
    };

    if (file) {
      try {
        const base64 = await toBase64(file);
        console.log("base64 length:", base64.length);
        if (!base64) {
          throw new Error("Empty base64 result");
        }
        payload = {
          ...payload,
          action: "analyze_pdf",
          file_name: file.name,
          file_base64: base64,
          additional_question: content || null,
          message: "Analysiere dieses Behördenschreiben",
        };
        if (ziel && ziel.trim()) {
          (payload as Record<string, unknown>).ziel = ziel.trim();
        }
      } catch (err) {
        console.error("PDF konnte nicht gelesen werden:", err);
        toast.error("PDF konnte nicht gelesen werden.");
        setIsLoading(false);
        return;
      }
    } else {
      // Action detection (text-only flow, unchanged)
      const msg = content.toLowerCase();
      let action = "question";
      const extra: Record<string, string> = { question: content };
      if (msg.startsWith("erstelle eine stellungnahme")) {
        action = "draft_statement";
        extra.topic = content.replace(/erstelle eine stellungnahme zum thema:?/i, "").trim();
        delete extra.question;
      } else if (msg.startsWith("analysiere dieses behördenschreiben")) {
        action = "analyze_pdf";
        delete extra.question;
      }
      payload = {
        ...payload,
        message: content,
        action,
        ...extra,
      };
    }

    const startTime = performance.now();
    try {
      console.log("Sende Nachricht über Edge Function:", { sessionId, action: payload.action, hasFile: !!file });
      console.log(
        "[PDF DEBUG 4] Sending message with file_base64 length:",
        (payload.file_base64 as string | undefined)?.length,
      );
      console.log("[PDF DEBUG 5] action:", payload.action);

      const { data, error } = await supabase.functions.invoke("chat-proxy", {
        body: payload,
      });

      if (error) {
        throw new Error(error.message);
      }

      console.log("n8n Antwort:", data);

      let responseText: string;
      let imageUrl: string | undefined;
      let usedChunkIds: string[] = [];
      let usedParagraphs: string[] = [];

      const parsed = Array.isArray(data) ? data[0] : data;

      if (typeof data === "string") {
        responseText = data;
      } else if (parsed && typeof parsed === "object") {
        imageUrl = parsed.imageUrl || parsed.image_url || undefined;
        if (Array.isArray(parsed.used_chunk_ids)) usedChunkIds = parsed.used_chunk_ids;
        if (Array.isArray(parsed.used_paragraphs)) usedParagraphs = parsed.used_paragraphs;
        if (parsed.action || parsed.antwort || parsed.entwurf_stellungnahme || parsed.antwortschreiben_entwurf || parsed.projekt_und_sachverhalt) {
          responseText = JSON.stringify(parsed);
        } else {
          responseText = parsed.output || parsed.response || parsed.message || parsed.text || JSON.stringify(data);
        }
      } else {
        responseText = String(data);
      }

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        content: responseText,
        role: "assistant",
        timestamp: new Date(),
        imageUrl,
        durationMs: performance.now() - startTime,
        usedChunkIds,
        usedParagraphs,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      persistMessage("ai", responseText);
      // Refresh sidebar list (title/lastAt) after a successful exchange
      if (historyEnabled) loadConversations();
    } catch (error) {
      console.error("Fehler beim Senden:", error);
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        content: JSON.stringify({
          status: "error",
          action: "question",
          antwort: "Der Server ist momentan nicht erreichbar. Bitte senden Sie Ihre Nachricht erneut.",
          rechtsgrundlage: [],
          fehlende_informationen: null,
          naechste_schritte: "Bitte versuchen Sie es in wenigen Sekunden erneut.",
          wichtiger_hinweis: null,
          quellen: [],
          model_used: "none",
          tokens_used: {},
        }),
        role: "assistant",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFeedback = async (
    messageId: string,
    status: "correct" | "inaccurate" | "correction" | "note",
    correctedText?: string,
  ): Promise<boolean> => {
    const ratedMessage = messages.find((m) => m.id === messageId);
    const messageIndex = messages.findIndex((m) => m.id === messageId);
    const userMessage = messageIndex > 0 ? messages[messageIndex - 1] : null;

    // Try to extract structured fields from the assistant message content
    let usedChunkIds: string[] = ratedMessage?.usedChunkIds || [];
    let usedParagraphs: string[] = ratedMessage?.usedParagraphs || [];
    let responseContent: string = ratedMessage?.content || "";
    try {
      const trimmed = (ratedMessage?.content || "").trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        const parsed = JSON.parse(trimmed);
        const obj = Array.isArray(parsed) ? parsed[0] : parsed;
        if (obj && typeof obj === "object") {
          if (Array.isArray(obj.used_chunk_ids) && obj.used_chunk_ids.length) usedChunkIds = obj.used_chunk_ids;
          if (Array.isArray(obj.used_paragraphs) && obj.used_paragraphs.length) usedParagraphs = obj.used_paragraphs;
          responseContent = obj.antwort || obj.entwurf_stellungnahme || obj.antwortschreiben_entwurf || responseContent;
        }
      }
    } catch { /* ignore */ }

    const payload: Record<string, unknown> = {
      action: "submit_feedback",
      status,
      response_id: messageId,
      sessionId: localStorage.getItem("chat-session-id") || conversationId || "",
      question: userMessage?.content || "",
      response_content: responseContent,
      used_chunk_ids: usedChunkIds,
      used_paragraphs: usedParagraphs,
      user_email: currentUserEmail || "",
    };
    if (status === "correction" || status === "note") {
      payload.corrected_text = correctedText || "";
    }

    try {
      const { data, error } = await supabase.functions.invoke("chat-proxy", { body: payload });
      if (error) throw new Error(error.message);
      if (data && data.success === false) throw new Error(data.error || "feedback failed");

      const successToasts: Record<string, string> = {
        correct: "Vielen Dank! Die zitierten Quellen wurden als verifiziert markiert.",
        inaccurate: "Notiert. Die zitierten Quellen werden in zukünftigen Antworten zurückgestuft.",
        correction: "Vielen Dank! Ihre Korrektur wird in zukünftigen Antworten priorisiert verwendet.",
        note: "Notiz gespeichert.",
      };
      toast.success(successToasts[status], { duration: 4000 });
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, feedbackSubmitted: status } : m)),
      );
      return true;
    } catch (e) {
      console.error("Feedback error:", e);
      toast.error("Feedback konnte nicht gespeichert werden. Bitte erneut versuchen.");
      return false;
    }
  };

  // Session ID initialisieren
  useEffect(() => {
    if (!localStorage.getItem("chat-session-id")) {
      localStorage.setItem("chat-session-id", crypto.randomUUID());
    }
  }, []);

  // Server-verified admin check
  useEffect(() => {
    const checkAdmin = async () => {
      const params = new URLSearchParams(window.location.search);
      const email = params.get("email") || "";

      if (!email) {
        setIsAdmin(false);
        return;
      }

      try {
        const { data, error } = await supabase.functions.invoke("chat-proxy", {
          body: { action: "check_admin", email },
        });

        if (data && data.isAdmin === true) {
          setIsAdmin(true);
        } else {
          setIsAdmin(false);
        }
      } catch (e) {
        console.error("Admin check failed:", e);
        setIsAdmin(false);
      }
    };

    checkAdmin();
  }, []);

  return (
    <div className="flex h-screen w-full bg-background">
      {historyEnabled && (
        <ConversationSidebar
          conversations={conversations}
          activeId={conversationId}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onSelect={handleSelectConversation}
          onNew={handleNewConversation}
          onDelete={handleDeleteConversation}
        />
      )}

      <div className="relative flex h-screen flex-1 flex-col">
        {/* Ambient glow effect */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-1/4 top-0 h-96 w-96 rounded-full bg-primary/5 blur-3xl" />
          <div className="absolute -right-1/4 bottom-0 h-96 w-96 rounded-full bg-accent/5 blur-3xl" />
        </div>

        {/* Sidebar toggle (only when history is available) */}
        {historyEnabled && !sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute left-3 top-3 z-30 flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background/80 text-muted-foreground backdrop-blur hover:bg-accent hover:text-accent-foreground transition-colors"
            aria-label="Seitenleiste öffnen"
            title="Gespräche"
          >
            <Menu className="h-4 w-4" />
          </button>
        )}

        <ChatHeader onLogoClick={handleNewConversation} />

        <div
          className={`border-b border-border backdrop-blur-xl ${isUnresolvedEmail ? "bg-destructive/10" : "bg-background/60"}`}
        >
          <div className="mx-auto max-w-3xl px-4 py-1.5 text-center">
            {isUnresolvedEmail ? (
              <span className="text-[11px] text-destructive">
                ⚠ E-Mail nicht erkannt. Bitte kontaktieren Sie Ihren Administrator.
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground/70">
                Eingeloggt als: <span className="font-mono text-muted-foreground">{currentUserEmail}</span>
              </span>
            )}
          </div>
        </div>

        <main className="relative flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl">
            {messages.length === 0 ? (
              <EmptyState onSuggestionClick={(text) => setInputValue(text)} />
            ) : (
              <div className="py-4">
                {messages.map((message) => (
                  <ChatMessage key={message.id} message={message} onFeedback={handleFeedback} isAdmin={isAdmin} />
                ))}
                <AnimatePresence>{isLoading && <TypingIndicator />}</AnimatePresence>
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        </main>

        <div className="border-t border-border bg-background/80 px-4 pt-3 backdrop-blur-xl">
          <div className="mx-auto flex max-w-3xl flex-wrap gap-2">
            {(() => {
              const hasB4Analysis = messages.some((m) => {
                if (m.role !== "assistant") return false;
                const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
                const lower = content.toLowerCase();
                return (
                  lower.includes("analyse der forderungen") ||
                  lower.includes("behördenschreiben") ||
                  lower.includes("behoerdenschreiben") ||
                  lower.includes("analyze_pdf")
                );
              });
              console.log("[Stellungnahme] hasB4Analysis =", hasB4Analysis, "messages:", messages.length);
              const stellungnahmePrefill = hasB4Analysis
                ? "Zielsetzung: [Ziel der Stellungnahme]\n\nℹ️ Projekt und Sachverhalt werden automatisch aus dem analysierten Behördenschreiben übernommen."
                : "Projekt: [Projektbeschreibung]\nSachverhalt: [Fakten die bewertet werden sollen]\nZielsetzung: [Ziel der Stellungnahme]";
              const buttons = [
                { icon: MessageSquare, label: "Rechtsfrage", prefill: "Ich habe eine Baurechtsfrage: " },
                { icon: FileText, label: "Stellungnahme", prefill: stellungnahmePrefill },
                { icon: Search, label: "Behördenschreiben", prefill: "Analysiere dieses Behördenschreiben: " },
              ];
              return buttons.map(({ icon: Icon, label, prefill }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setInputValue(prefill)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/50 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-accent hover:text-foreground"
                >
                  <Icon className="h-3 w-3" />
                  {label}
                </button>
              ));
            })()}
          </div>
        </div>
        <ChatInput
          onSendMessage={(msg, file, ziel) => {
            sendMessage(msg, file, ziel);
            setInputValue("");
          }}
          isLoading={isLoading}
          inputValue={inputValue}
          onInputChange={setInputValue}
        />
      </div>
    </div>
  );
};
