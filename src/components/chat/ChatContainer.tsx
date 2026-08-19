import { useState, useRef, useEffect, useCallback } from "react";
import { AnimatePresence } from "framer-motion";
import { Menu, MessageSquare, FileText, Search, Pencil, X } from "lucide-react";
import { Message } from "@/types/chat";
import { ChatHeader } from "./ChatHeader";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { TypingIndicator } from "./TypingIndicator";
import { EmptyState } from "./EmptyState";
import { ConversationSidebar, ConversationSummary } from "./ConversationSidebar";
import { ProjectPicker, ProjectStatus } from "./ProjectPicker";
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
  const [editDraftDismissed, setEditDraftDismissed] = useState<Set<string>>(new Set());
  const [projectRef, setProjectRef] = useState<string | null>(null);
  const [projectStatus, setProjectStatus] = useState<ProjectStatus>('idle');
  // Single source of truth for which backend the next message hits.
  // Set ONLY by clicking a tab. Never derived from input content.
  const [activeMode, setActiveModeState] = useState<"rechtsfrage" | "stellungnahme" | "behoerdenschreiben">(() => {
    if (typeof window === "undefined") return "rechtsfrage";
    const saved = localStorage.getItem("chat-active-mode");
    if (saved === "rechtsfrage" || saved === "stellungnahme" || saved === "behoerdenschreiben") return saved;
    return "rechtsfrage";
  });
  const setActiveMode = (m: "rechtsfrage" | "stellungnahme" | "behoerdenschreiben") => {
    setActiveModeState(m);
    try { localStorage.setItem("chat-active-mode", m); } catch { /* ignore */ }
  };
  // Sidebar is always available; conversations are filtered by user_email so each
  // email only sees its own history.
  const historyEnabled = true;
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth >= 768;
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Guard for async polling (analyze_pdf). Bump to cancel any in-flight poll.
  const pollCancelRef = useRef(0);
  useEffect(() => () => { pollCancelRef.current += 1; }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);

  // All chat_messages access is routed through the chat-history edge function,
  // which uses the service role and scopes every operation to a single
  // user_email. The table itself is locked down (no anon GRANTs / no policies).
  const callHistory = useCallback(async (payload: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("chat-history", { body: payload });
    if (error) {
      console.error("chat-history error:", error);
      return null;
    }
    return data as any;
  }, []);

  // Load conversations list for the current user
  const loadConversations = useCallback(async () => {
    if (!currentUserEmail) return [] as ConversationSummary[];
    const data = await callHistory({ action: "list_conversations", user_email: currentUserEmail });
    if (!data?.success) return [];

    const map = new Map<string, { firstUserMsg?: string; lastAt: Date }>();
    for (const row of (data.rows as any[]) || []) {
      const cid = row.conversation_id || "legacy";
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
  }, [currentUserEmail, callHistory]);

  const loadConversationMessages = useCallback(
    async (cid: string) => {
      if (!currentUserEmail) return;
      const data = await callHistory({
        action: "load_messages",
        user_email: currentUserEmail,
        conversation_id: cid,
      });
      if (!data?.success) return;
      const restored: Message[] = ((data.rows as any[]) || []).map((row: any) => ({
        id: row.id,
        content: row.content,
        role: row.role === "ai" ? "assistant" : "user",
        timestamp: new Date(row.created_at),
        responseId: row.response_id || undefined,
        usedChunkIds: Array.isArray(row.used_chunk_ids) ? row.used_chunk_ids : undefined,
        usedParagraphs: Array.isArray(row.used_paragraphs) ? row.used_paragraphs : undefined,
      }));
      setMessages(restored);
    },
    [currentUserEmail, callHistory],
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
      // Start fresh in Rechtsfrage mode; the pills are the single control.
      setActiveMode("rechtsfrage");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserEmail]);

  const persistMessage = async (
    role: "user" | "ai",
    content: string,
    meta?: { responseId?: string; usedChunkIds?: string[]; usedParagraphs?: string[] },
  ) => {
    if (!currentUserEmail || !content || !conversationId) return;
    const data = await callHistory({
      action: "save_message",
      user_email: currentUserEmail,
      role,
      content,
      conversation_id: conversationId,
      response_id: meta?.responseId ?? null,
      used_chunk_ids: meta?.usedChunkIds ?? null,
      used_paragraphs: meta?.usedParagraphs ?? null,
    });
    if (!data?.success) console.error("Fehler beim Speichern der Nachricht");
  };


  const handleNewConversation = () => {
    // sessionId sent to n8n == conversationId, so a new conversation
    // always means a fresh, empty gpt_session_context on the backend.
    pollCancelRef.current += 1; // cancel any pending analyze_pdf poll
    const newId = crypto.randomUUID();
    setConversationId(newId);
    localStorage.setItem("chat-session-id", newId);
    setMessages([]);
    // The pills are the single mode control; every new conversation starts fresh
    // in Rechtsfrage mode so the user is never in a mode they did not choose.
    setActiveMode("rechtsfrage");
    if (typeof window !== "undefined" && window.innerWidth < 768) setSidebarOpen(false);
  };

  const handleSelectConversation = async (cid: string) => {
    pollCancelRef.current += 1;
    setConversationId(cid);
    // Keep n8n session aligned with the selected conversation.
    localStorage.setItem("chat-session-id", cid);
    await loadConversationMessages(cid);
    if (typeof window !== "undefined" && window.innerWidth < 768) setSidebarOpen(false);
  };

  const handleDeleteConversation = async (cid: string) => {
    if (!currentUserEmail) return;
    const data = await callHistory({
      action: "delete_conversation",
      user_email: currentUserEmail,
      conversation_id: cid,
    });
    if (!data?.success) {
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

  // Detect the current "mode" from the input text prefix (same prefixes the
  // mode buttons prefill). Falls back to "behoerdenschreiben" to preserve
  // existing default attach behavior.
  const detectMode = (text: string): "rechtsfrage" | "stellungnahme" | "behoerdenschreiben" => {
    const m = (text || "").trim().toLowerCase();
    if (m.startsWith("ich habe eine baurechtsfrage")) return "rechtsfrage";
    if (
      m.startsWith("erstelle eine stellungnahme") ||
      m.startsWith("projekt:") ||
      m.startsWith("zielsetzung:")
    ) return "stellungnahme";
    if (m.startsWith("analysiere dieses behördenschreiben") || m.startsWith("analysiere dieses behoerdenschreiben")) {
      return "behoerdenschreiben";
    }
    return "behoerdenschreiben";
  };

  // Direct fetch to chat-proxy with a longer timeout than supabase.functions.invoke's default.
  // analyze_pdf/draft_statement can legitimately take up to ~3 min.
  const invokeChatProxy = async (body: Record<string, unknown>, timeoutMs = 180000): Promise<any> => {
    const url = `https://phxsmsaoxhhvopwndujq.supabase.co/functions/v1/chat-proxy`;
    const anon = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBoeHNtc2FveGhodm9wd25kdWpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNTQ5MjIsImV4cCI6MjA5MTkzMDkyMn0.HzBU8UiSPly2LCCPgot5FkhQvsF9Mc6aYeyjlyrKWhQ";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": anon,
          "Authorization": `Bearer ${anon}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!text) throw new Error("Leere Antwort vom Server.");
      try { return JSON.parse(text); } catch { return { output: text }; }
    } finally {
      clearTimeout(timer);
    }
  };

  // Poll chat-proxy `get_result` every 3s for up to 5 min. Returns the
  // final payload (byte-identical to a synchronous analyze_pdf response).
  const pollForResult = async (
    sessionId: string,
    targetAction: string,
    onTick: (elapsedSec: number) => void,
  ): Promise<any> => {
    const token = ++pollCancelRef.current;
    const startedAt = Date.now();
    const maxMs = 5 * 60 * 1000;
    const intervalMs = 3000;
    while (Date.now() - startedAt < maxMs) {
      await new Promise((r) => setTimeout(r, intervalMs));
      if (pollCancelRef.current !== token) throw new Error("PollCancelled");
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      onTick(elapsed);
      try {
        const res = await invokeChatProxy(
          { action: "get_result", sessionId, target_action: targetAction },
          30000,
        );
        if (pollCancelRef.current !== token) throw new Error("PollCancelled");
        const p = Array.isArray(res) ? res[0] : res;
        if (p && p.ready === true) return p.payload ?? p;
      } catch (e) {
        if ((e as Error)?.message === "PollCancelled") throw e;
        // transient network error — keep polling
        console.warn("get_result poll error, retrying:", e);
      }
    }
    throw new Error("PollTimeout");
  };

  const sendMessage = async (
    content: string,
    files?: File[] | null,
    ziel?: string,
    sourceType?: 'rechtsquelle' | 'kontext' | 'analyze',
  ) => {
    // sessionId sent to n8n is ALWAYS the current conversationId.
    const sessionId = conversationId || crypto.randomUUID();
    if (sessionId !== localStorage.getItem("chat-session-id")) {
      localStorage.setItem("chat-session-id", sessionId);
    }

    const hasFiles = Array.isArray(files) && files.length > 0;
    const firstFile = hasFiles ? files![0] : null;

    // === upload_source path (Rechtsquelle / Kontext attachments) — one call per file ===
    if (hasFiles) {
      const effectiveSourceType: 'rechtsquelle' | 'kontext' | 'analyze' =
        sourceType ?? (activeMode === 'behoerdenschreiben' ? 'analyze' : 'rechtsquelle');

      if (effectiveSourceType === 'rechtsquelle' || effectiveSourceType === 'kontext') {
        const list = files!;
        const label = effectiveSourceType === 'kontext' ? 'Kontext' : 'Rechtsquelle';
        // One user message listing every attached document, in send order.
        const userMessage: Message = {
          id: crypto.randomUUID(),
          content: list.map((f, i) => `📎 [${i + 1}/${list.length}] ${f.name}`).join("\n"),
          role: "user",
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, userMessage]);
        persistMessage("user", userMessage.content);

        // One combined progress placeholder for the whole batch.
        const progressId = crypto.randomUUID();
        const progressText = (n: number, name: string) =>
          `⏳ Quelle ${n} von ${list.length} wird hinzugefügt… (${name})`;
        setMessages((prev) => [
          ...prev,
          { id: progressId, content: progressText(1, list[0].name), role: "assistant", timestamp: new Date() },
        ]);
        setIsLoading(true);

        const succeeded: string[] = [];
        const failed: string[] = [];
        try {
          for (let i = 0; i < list.length; i++) {
            const file = list[i];
            setMessages((prev) =>
              prev.map((m) => (m.id === progressId ? { ...m, content: progressText(i + 1, file.name) } : m)),
            );
            try {
              const base64 = await toBase64(file);
              if (!base64) throw new Error("Empty base64 result");
              const data = await invokeChatProxy({
                action: "upload_source",
                source_type: effectiveSourceType,
                sessionId,
                file_name: file.name,
                file_base64: base64,
                ...(projectRef ? { project_ref: projectRef } : {}),
              }, 120000);
              const parsed = Array.isArray(data) ? data[0] : data;
              const fileName = parsed?.fileName || file.name;
              const chunks = typeof parsed?.chunks === "number" ? parsed.chunks : 0;
              if (parsed && parsed.indexed === true) {
                succeeded.push(`${fileName}${chunks ? ` (${chunks} Abschnitte)` : ""}`);
              } else {
                failed.push(file.name);
              }
            } catch (e) {
              console.error("upload_source error:", e);
              failed.push(file.name);
            }
          }
        } finally {
          setMessages((prev) => prev.filter((m) => m.id !== progressId));
          setIsLoading(false);
        }

        const parts: string[] = [];
        if (succeeded.length > 0) {
          parts.push(
            `✓ ${succeeded.length} von ${list.length} Quellen hinzugefügt (${label}) — werden in dieser Unterhaltung berücksichtigt:\n` +
              succeeded.map((s, i) => `${i + 1}. ${s}`).join("\n"),
          );
        }
        if (failed.length > 0) {
          parts.push(
            `⚠ Nicht verarbeitet:\n` +
              failed.map((f, i) => `${i + 1}. ${f}`).join("\n") +
              `\nBitte diese Datei${failed.length > 1 ? "en" : ""} erneut hinzufügen.`,
          );
        }
        const summary = parts.join("\n\n");
        const ackMessage: Message = {
          id: crypto.randomUUID(),
          content: summary,
          role: "assistant",
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, ackMessage]);
        persistMessage("ai", summary);
        return;
      }
    }

    // === analyze_pdf (multi-file) OR text-only Q&A ===
    const displayContent = hasFiles
      ? (content
          ? `📎 [${files!.map((f) => f.name).join(", ")}] — ${content}`
          : `📎 [${files!.map((f) => f.name).join(", ")}]`)
      : content;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      content: displayContent,
      role: "user",
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    persistMessage("user", displayContent);

    let payload: Record<string, unknown> = {
      sessionId,
      timestamp: new Date().toISOString(),
      ...(projectRef ? { project_ref: projectRef } : {}),
    };

    if (hasFiles) {
      try {
        const encoded = await Promise.all(
          files!.map(async (f) => ({ file_name: f.name, file_base64: await toBase64(f) })),
        );
        payload = {
          ...payload,
          action: "analyze_pdf",
          files: encoded,
          // Back-compat: also send first file top-level (n8n may still read either)
          file_name: firstFile!.name,
          file_base64: encoded[0].file_base64,
          additional_question: content || null,
          message: "Analysiere dieses Behördenschreiben",
        };
        if (ziel && ziel.trim()) (payload as Record<string, unknown>).ziel = ziel.trim();
      } catch (err) {
        console.error("PDF konnte nicht gelesen werden:", err);
        toast.error("Datei konnte nicht gelesen werden.");
        setIsLoading(false);
        return;
      }
    } else if (isEditDraftMode) {
      setIsLoading(false);
      return;
    } else {
      // ROUTING: action is a pure function of activeMode. Never read message text.
      if (activeMode === "stellungnahme") {
        payload = { ...payload, message: content, action: "draft_statement", topic: content };
      } else if (activeMode === "behoerdenschreiben") {
        payload = { ...payload, message: content, action: "analyze_pdf" };
      } else {
        payload = { ...payload, message: content, action: "question", question: content };
      }
    }

    const startTime = performance.now();
    // Initial request is fast: analyze_pdf now returns {accepted, poll:true}
    // in ~1s; the real work is fetched via pollForResult below. B3/B6 stay sync.
    const timeoutMs =
      payload.action === "analyze_pdf" ? 30000 :
      payload.action === "draft_statement" ? 210000 :
      120000;
    // Progress placeholder id (only used for the async analyze_pdf path).
    let progressMsgId: string | null = null;
    try {
      let data = await invokeChatProxy(payload, timeoutMs);
      console.log("n8n Antwort:", data);

      // --- ASYNC REQUEST-REPLY for analyze_pdf ---
      // Detect on BODY (chat-proxy normalises status codes to 200).
      const initial = Array.isArray(data) ? data[0] : data;
      if (
        payload.action === "analyze_pdf" &&
        initial && typeof initial === "object" &&
        (initial.status === "accepted" || initial.poll === true)
      ) {
        progressMsgId = crypto.randomUUID();
        const makeText = (sec: number) =>
          `⏳ Die Analyse läuft — das kann bei umfangreichen Schreiben 2–3 Minuten dauern.\n\nBisher vergangen: ${sec}s`;
        const progressMsg: Message = {
          id: progressMsgId,
          content: makeText(0),
          role: "assistant",
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, progressMsg]);
        data = await pollForResult(sessionId, "analyze_pdf", (sec) => {
          setMessages((prev) => prev.map((m) =>
            m.id === progressMsgId ? { ...m, content: makeText(sec) } : m,
          ));
        });
        // Remove the placeholder before rendering the final assistant message.
        setMessages((prev) => prev.filter((m) => m.id !== progressMsgId));
        progressMsgId = null;
      }


      let responseText: string;
      let imageUrl: string | undefined;
      let usedChunkIds: string[] = [];
      let usedParagraphs: string[] = [];
      let responseId: string | undefined;
      let needsClarification = false;

      const parsed = Array.isArray(data) ? data[0] : data;

      if (typeof data === "string") {
        responseText = data;
      } else if (parsed && typeof parsed === "object") {
        imageUrl = parsed.imageUrl || parsed.image_url || undefined;
        if (Array.isArray(parsed.used_chunk_ids)) usedChunkIds = parsed.used_chunk_ids;
        if (Array.isArray(parsed.used_paragraphs)) usedParagraphs = parsed.used_paragraphs;
        if (typeof parsed.response_id === "string") responseId = parsed.response_id;
        if (parsed.needs_clarification === true) needsClarification = true;
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
        responseId,
        usedChunkIds,
        usedParagraphs,
        needsClarification,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      persistMessage("ai", responseText, { responseId, usedChunkIds, usedParagraphs });
      if (historyEnabled) loadConversations();
    } catch (error) {
      console.error("Fehler beim Senden:", error);
      // Clean up progress placeholder from async analyze_pdf, if any.
      if (progressMsgId) {
        const pid = progressMsgId;
        setMessages((prev) => prev.filter((m) => m.id !== pid));
      }
      const errName = (error as Error)?.name;
      const errMsgStr = (error as Error)?.message || "";
      if (errMsgStr === "PollCancelled") {
        // User navigated away / started a new conversation. Silent.
        return;
      }
      const isAbort = errName === "AbortError";
      const isPollTimeout = errMsgStr === "PollTimeout";
      const msg = isPollTimeout
        ? "Die Analyse dauert länger als 5 Minuten. Bitte erneut versuchen — das Ergebnis wird beim nächsten Versuch normalerweise sofort geladen."
        : isAbort
        ? "Zeitüberschreitung. Die Analyse dauert länger als erwartet. Bitte erneut versuchen."
        : "Der Server ist momentan nicht erreichbar. Bitte senden Sie Ihre Nachricht erneut.";
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        content: JSON.stringify({
          status: "error",
          action: "question",
          antwort: msg,
          rechtsgrundlage: [],
          fehlende_informationen: null,
          naechste_schritte: "Bitte versuchen Sie es in wenigen Sekunden erneut.",
          wichtiger_hinweis: null,
          quellen: [],
        }),
        role: "assistant",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
      // Preserve the user's input in the composer so they can retry
      if (content) setInputValue(content);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFeedback = async (
    messageId: string,
    status: "correct" | "inaccurate" | "correction" | "note",
    text?: string,
  ): Promise<boolean> => {
    const ratedMessage = messages.find((m) => m.id === messageId);
    const messageIndex = messages.findIndex((m) => m.id === messageId);
    const userMessage = messageIndex > 0 ? messages[messageIndex - 1] : null;

    if (!ratedMessage) return false;

    // Use the backend response_id when available; fall back to local id only as a last resort.
    const backendResponseId = ratedMessage.responseId;

    // Try to extract structured fields from the assistant message content
    let usedChunkIds: string[] = ratedMessage.usedChunkIds || [];
    let usedParagraphs: string[] = ratedMessage.usedParagraphs || [];
    let responseContent: string = ratedMessage.content || "";
    try {
      const trimmed = (ratedMessage.content || "").trim();
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
      response_id: backendResponseId || messageId,
      session_id: localStorage.getItem("chat-session-id") || conversationId || "",
      sessionId: localStorage.getItem("chat-session-id") || conversationId || "",
      question: userMessage?.content || "",
      response_content: responseContent,
      used_chunk_ids: usedChunkIds,
      used_paragraphs: usedParagraphs,
      user_email: currentUserEmail || "",
    };
    // corrected_text is ONLY sent on the correction path (per backend contract)
    if (status === "correction") {
      payload.corrected_text = text || "";
    }
    // message is sent on the note path (freeform admin note)
    if (status === "note") {
      payload.message = text || "";
    }

    // Optimistic UI: mark immediately, roll back on failure
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, feedbackSubmitted: status } : m)));

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
      return true;
    } catch (e) {
      console.error("Feedback error:", e, "payload:", payload);
      // Roll back optimistic state
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, feedbackSubmitted: undefined } : m)));
      toast.error("Feedback konnte nicht gespeichert werden. Bitte erneut versuchen.");
      return false;
    }
  };

  // --- Draft helpers (entwurf_stellungnahme) ---
  const extractDraft = (content: string): string | null => {
    try {
      const trimmed = (content || "").trim();
      if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
      const parsed = JSON.parse(trimmed);
      const obj = Array.isArray(parsed) ? parsed[0] : parsed;
      const d = obj?.entwurf_stellungnahme;
      return typeof d === "string" && d.trim() ? d : null;
    } catch { return null; }
  };

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const lastAssistantDraft = lastAssistant ? extractDraft(lastAssistant.content) : null;
  const isEditDraftMode = !!(lastAssistant && lastAssistantDraft && !editDraftDismissed.has(lastAssistant.id));

  // --- Conversational draft edit: dedicated request, no chat history attached ---
  const handleEditDraft = async (instruction: string) => {
    const text = (instruction || "").trim();
    if (!text) return;
    const sessionId = conversationId || localStorage.getItem("chat-session-id") || "";
    if (!sessionId) {
      toast.error("Keine Session aktiv.");
      return;
    }
    const userMessage: Message = {
      id: crypto.randomUUID(),
      content: text,
      role: "user",
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    persistMessage("user", text);

    const startTime = performance.now();
    try {
      const { data, error } = await supabase.functions.invoke("chat-proxy", {
        body: {
          action: "draft_statement",
          mode: "edit",
          sessionId,
          topic: text,
          ...(projectRef ? { project_ref: projectRef } : {}),
        },
      });
      if (error) throw new Error(error.message);

      console.log("[DRAFT EDIT] n8n response:", data);

      const parsed = Array.isArray(data) ? data[0] : data;
      let responseText: string;
      let usedChunkIds: string[] = [];
      let usedParagraphs: string[] = [];
      let responseId: string | undefined;

      if (parsed && typeof parsed === "object") {
        if (Array.isArray(parsed.used_chunk_ids)) usedChunkIds = parsed.used_chunk_ids;
        if (Array.isArray(parsed.used_paragraphs)) usedParagraphs = parsed.used_paragraphs;
        if (typeof parsed.response_id === "string") responseId = parsed.response_id;

        // If backend returned a wrapped { output: "..." } where output is a JSON string with the draft, unwrap it.
        let draftObj: Record<string, unknown> = parsed;
        if (!parsed.entwurf_stellungnahme && typeof parsed.output === "string") {
          try {
            const inner = JSON.parse(parsed.output);
            const innerObj = Array.isArray(inner) ? inner[0] : inner;
            if (innerObj && typeof innerObj === "object" && innerObj.entwurf_stellungnahme) {
              draftObj = { ...parsed, ...innerObj };
            }
          } catch { /* keep parsed */ }
        }
        // Ensure the action marker so tryParseStructured/StructuredResponse render this as a draft.
        if (!draftObj.action) draftObj = { ...draftObj, action: "draft_statement" };
        responseText = JSON.stringify(draftObj);
      } else {
        responseText = typeof data === "string" ? data : JSON.stringify(data);
      }

      // Append as a NEW assistant message (mirrors how a fresh draft is rendered).
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        content: responseText,
        role: "assistant",
        timestamp: new Date(),
        durationMs: performance.now() - startTime,
        responseId,
        usedChunkIds,
        usedParagraphs,
      };
      setMessages((prev) => [...prev, assistantMessage]);
      persistMessage("ai", responseText, { responseId, usedChunkIds, usedParagraphs });
      if (historyEnabled) loadConversations();
    } catch (e) {
      console.error("Draft edit error:", e);
      toast.error("Entwurf konnte nicht aktualisiert werden.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveStatement = async (
    messageId: string,
    newText: string,
  ): Promise<true | { error: string }> => {
    const sessionId = conversationId || localStorage.getItem("chat-session-id") || "";
    if (!sessionId) return { error: "Keine Session aktiv." };
    try {
      const { data, error } = await supabase.functions.invoke("chat-proxy", {
        body: { action: "save_statement", sessionId, statement_text: newText },
      });
      if (error) return { error: error.message };
      const saved = data && (data.saved === true || data.status === "success");
      if (!saved) return { error: data?.error || "Speichern fehlgeschlagen" };
      setMessages((prev) => prev.map((m) => {
        if (m.id !== messageId) return m;
        try {
          const trimmed = (m.content || "").trim();
          if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return m;
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            parsed[0] = { ...parsed[0], entwurf_stellungnahme: newText };
            return { ...m, content: JSON.stringify(parsed) };
          }
          return { ...m, content: JSON.stringify({ ...parsed, entwurf_stellungnahme: newText }) };
        } catch { return m; }
      }));
      return true;
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  };

  // --- PROJECT PICKER: bind a chat to a Google Drive project folder ---
  const bindProject = async (ref: string) => {
    const cleanRef = (ref || "").trim();
    if (!cleanRef) return;
    setProjectRef(cleanRef);
    localStorage.setItem("chat-project-ref", cleanRef);
    setProjectStatus("loading");
    try {
      const { data, error } = await supabase.functions.invoke("chat-proxy", {
        body: { action: "ingest_project", project_ref: cleanRef },
      });
      if (error) throw new Error(error.message);
      const parsed = Array.isArray(data) ? data[0] : data;
      const ok = parsed && (parsed.status === "success" || parsed.success === true);
      if (!ok) throw new Error(parsed?.error || "ingest_failed");
      setProjectStatus("linked");
      toast.success("Projekt verknüpft");
    } catch (e) {
      console.error("ingest_project error:", e);
      setProjectStatus("error");
      setProjectRef(null);
      localStorage.removeItem("chat-project-ref");
      toast.error("Projekt konnte nicht eingelesen werden.");
    }
  };

  const unlinkProject = () => {
    setProjectRef(null);
    setProjectStatus("idle");
    localStorage.removeItem("chat-project-ref");
  };

  // Rehydrate sessionId + project_ref on mount so a reload preserves the thread.
  useEffect(() => {
    if (!localStorage.getItem("chat-session-id")) {
      localStorage.setItem("chat-session-id", crypto.randomUUID());
    }
    const savedProject = localStorage.getItem("chat-project-ref");
    if (savedProject && !projectRef) {
      setProjectRef(savedProject);
      setProjectStatus("linked");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

        <ProjectPicker
          projectRef={projectRef}
          status={projectStatus}
          onBind={bindProject}
          onUnlink={unlinkProject}
        />


        <main className="relative flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl">
            {messages.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="py-4">
                {messages.map((message) => (
                  <ChatMessage key={message.id} message={message} onFeedback={handleFeedback} isAdmin={isAdmin} onSaveStatement={handleSaveStatement} />
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
              const buttons: Array<{
                icon: typeof MessageSquare;
                label: string;
                mode: "rechtsfrage" | "stellungnahme" | "behoerdenschreiben";
              }> = [
                { icon: MessageSquare, label: "Rechtsfrage", mode: "rechtsfrage" },
                { icon: FileText, label: "Stellungnahme", mode: "stellungnahme" },
                { icon: Search, label: "Behördenschreiben", mode: "behoerdenschreiben" },
              ];
              return buttons.map(({ icon: Icon, label, mode }) => {
                const isActive = activeMode === mode;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setActiveMode(mode)}
                    aria-pressed={isActive}
                    className={
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors " +
                      (isActive
                        ? "border-primary bg-primary/15 text-foreground shadow-sm"
                        : "border-border bg-background/50 text-muted-foreground hover:border-primary/50 hover:bg-accent hover:text-foreground")
                    }
                  >
                    <Icon className="h-3 w-3" />
                    {label}
                  </button>
                );
              });
            })()}
          </div>
        </div>
        {isEditDraftMode && lastAssistant && (
          <div className="border-t border-border bg-primary/5 px-4 py-2 backdrop-blur-xl">
            <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-2 text-primary">
                <Pencil className="h-3 w-3" />
                Änderung am Entwurf — z. B. „mach den dritten Absatz schärfer“
              </span>
              <button
                type="button"
                onClick={() => setEditDraftDismissed((prev) => {
                  const next = new Set(prev);
                  next.add(lastAssistant.id);
                  return next;
                })}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                aria-label="Bearbeitungsmodus verlassen"
                title="Bearbeitungsmodus verlassen"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
        <ChatInput
          onSendMessage={(msg, files, ziel, sourceType) => {
            if ((!files || files.length === 0) && isEditDraftMode) {
              handleEditDraft(msg);
            } else {
              sendMessage(msg, files, ziel, sourceType);
            }
            setInputValue("");
          }}
          isLoading={isLoading}
          inputValue={inputValue}
          onInputChange={setInputValue}
          mode={activeMode}
        />
      </div>
    </div>
  );
};

