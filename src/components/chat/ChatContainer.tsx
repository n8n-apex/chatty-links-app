import { useState, useRef, useEffect, useCallback } from "react";
import { AnimatePresence } from "framer-motion";
import { Menu } from "lucide-react";
import { Message, Verstanden } from "@/types/chat";
import { ChatHeader } from "./ChatHeader";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { TypingIndicator } from "./TypingIndicator";
import { EmptyState } from "./EmptyState";
import { ConversationSidebar, ConversationSummary } from "./ConversationSidebar";

import { Gespraechsleiste } from "./Gespraechsleiste";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getUserEmail } from "@/lib/identity";
import { signHistoryRequest } from "@/lib/historySig";
import { parseBackendPayload, schemaInvalidEnvelope, type BackendParseResult } from "@/lib/responseSchema";


type UploadVerdict = {
  state: "success" | "failure" | "unknown";
  fileName?: string;
  chunks?: number;
  error?: string;
};

/**
 * Classify one `upload_source` response.
 *
 * Primary test = the documented "SD Source Response" shape: `{ indexed, fileName, chunks }`.
 * Observed reality: the workflow also answers HTTP 200 with an empty body while the
 * file keeps indexing server-side, so anything unrecognised is UNKNOWN — never a failure.
 * Only an explicit backend rejection counts as a failure.
 */
const classifyUploadSource = (raw: unknown): UploadVerdict => {
  // Unwrap arrays and common envelopes ({ payload }, { data }, { result }, { json }).
  let node: any = raw;
  for (let depth = 0; depth < 4 && node && typeof node === "object"; depth++) {
    if (Array.isArray(node)) { node = node[0]; continue; }
    if ("indexed" in node || "chunks" in node || "status" in node || "error" in node) break;
    const next = node.payload ?? node.data ?? node.result ?? node.json ?? node.body;
    if (next && typeof next === "object") { node = next; continue; }
    break;
  }
  if (!node || typeof node !== "object") return { state: "unknown" };

  const p: any = node;
  const fileName = typeof p.fileName === "string" ? p.fileName
    : typeof p.file_name === "string" ? p.file_name : undefined;
  const chunksRaw = p.chunks ?? p.chunk_count ?? p.chunkCount;
  const chunks = typeof chunksRaw === "number" ? chunksRaw
    : typeof chunksRaw === "string" && /^\d+$/.test(chunksRaw) ? Number(chunksRaw)
    : undefined;

  // --- PRIMARY: the `indexed` flag from SD Source Response ---
  if (p.indexed === true || p.indexed === "true") return { state: "success", fileName, chunks };
  if (p.indexed === false || p.indexed === "false") {
    return { state: "failure", fileName, chunks, error: String(p.error ?? p.message ?? "indexed=false") };
  }

  // --- FALLBACK: loose success/failure signals ---
  const statusStr = String(p.status ?? p.result ?? p.state ?? "").toLowerCase();
  if (["success", "ok", "indexed", "stored", "done", "completed"].includes(statusStr)) {
    return { state: "success", fileName, chunks };
  }
  if (["error", "failed", "failure", "rejected"].includes(statusStr)) {
    return { state: "failure", fileName, chunks, error: String(p.error ?? p.message ?? statusStr) };
  }
  if (typeof chunks === "number" && chunks > 0) return { state: "success", fileName, chunks };
  if (p.error) return { state: "failure", fileName, chunks, error: String(p.error) };

  // Empty body → chat-proxy turns it into { output: "No response from webhook" }.
  return { state: "unknown", fileName, chunks };
};

type AssistantMeta = { responseId?: string; usedChunkIds?: string[]; usedParagraphs?: string[] };

/** Read `verstanden` back out of a persisted assistant message. Never throws. */
const extractVerstanden = (content: unknown): Verstanden | undefined => {
  if (typeof content !== "string") return undefined;
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    const obj = Array.isArray(parsed) ? parsed[0] : parsed;
    const v = obj?.verstanden;
    return v && typeof v === "object" ? (v as Verstanden) : undefined;
  } catch {
    return undefined;
  }
};


/**
 * Turn a backend payload into the assistant Message. Shared by the live send frame
 * and by resume-on-open, so both render results identically.
 */
const buildAssistantMessage = (
  data: any,
  durationMs?: number,
): { message: Message; responseText: string; meta: AssistantMeta } => {
  let responseText: string;
  let imageUrl: string | undefined;
  let usedChunkIds: string[] = [];
  let usedParagraphs: string[] = [];
  let responseId: string | undefined;
  let needsClarification = false;
  let routingNotice: string | undefined;
  let verstanden: Verstanden | undefined;

  const parsed = Array.isArray(data) ? data[0] : data;

  if (typeof data === "string") {
    responseText = data;
  } else if (parsed && typeof parsed === "object") {
    imageUrl = parsed.imageUrl || parsed.image_url || undefined;
    if (Array.isArray(parsed.used_chunk_ids)) usedChunkIds = parsed.used_chunk_ids;
    if (Array.isArray(parsed.used_paragraphs)) usedParagraphs = parsed.used_paragraphs;
    if (typeof parsed.response_id === "string") responseId = parsed.response_id;
    if (parsed.needs_clarification === true) needsClarification = true;
    if (parsed.verstanden && typeof parsed.verstanden === "object") verstanden = parsed.verstanden;
    if (typeof parsed.routing_notice === "string" && parsed.routing_notice.trim()) {
      routingNotice = parsed.routing_notice.trim();
    }
    if (parsed.action || parsed.antwort || parsed.entwurf_stellungnahme || parsed.antwortschreiben_entwurf || parsed.projekt_und_sachverhalt) {
      // Strip the routing notice from the start of antwort so it isn't duplicated in the chip.
      if (routingNotice && typeof parsed.antwort === "string" && parsed.antwort.startsWith(routingNotice)) {
        parsed.antwort = parsed.antwort.slice(routingNotice.length).replace(/^\s*[\n\r]\s*/, "");
      }
      responseText = JSON.stringify(parsed);
    } else {
      const plainField = parsed.output || parsed.response || parsed.message || parsed.text;
      const usablePlain = typeof plainField === "string" && plainField.trim().length > 0;
      if (!usablePlain) {
        // No known shape and no renderable text: validate before guessing. Only a
        // JSON object that matches nothing at all becomes an error card.
        const check: BackendParseResult = parseBackendPayload(parsed);
        if (check.ok === false) {
          console.error("backend payload failed shape validation", {
            issuePaths: check.issuePaths,
          });
          responseText = JSON.stringify(schemaInvalidEnvelope(check.issuePaths));
        } else {
          responseText = JSON.stringify(data);
        }
      } else {
        const plain = plainField as string;
        // Plain-text answers would drop `verstanden` on reload, and an answer that
        // renders without the line is the unsafe case. Store it as a structured
        // payload instead — the renderer is content-addressed, so `antwort` renders
        // exactly the same markdown.
        responseText = verstanden
          ? JSON.stringify({ action: "question", antwort: plain, verstanden })
          : plain;
      }
    }

  } else {
    responseText = String(data);
  }


  const message: Message = {
    id: crypto.randomUUID(),
    content: responseText,
    role: "assistant",
    timestamp: new Date(),
    imageUrl,
    durationMs,
    responseId,
    usedChunkIds,
    usedParagraphs,
    needsClarification,
    routingNotice,
    verstanden,
  };

  return { message, responseText, meta: { responseId, usedChunkIds, usedParagraphs } };
};




export const ChatContainer = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [currentUserEmail, setCurrentUserEmail] = useState(getUserEmail);
  const isUnresolvedEmail = currentUserEmail.includes("{{") || currentUserEmail.includes("}}");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  // Routing is decided by the backend router (`action: "auto"`), never by the UI.

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
  // Always holds the conversation actually on screen. Assigned on the SAME line as
  // every setConversationId(...) — a useEffect would lag by one render.
  const activeConversationRef = useRef<string | null>(null);
  // Set after pollForResult is defined; lets loadConversationMessages resume a turn.
  const resumePendingTurnRef = useRef<((cid: string) => void) | null>(null);


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
    // Signed envelope: attests the app build, not the person. See historySig.ts.
    const sig = await signHistoryRequest(
      String(payload.action ?? ""),
      String(payload.user_email ?? ""),
    );
    const { data, error } = await supabase.functions.invoke("chat-history", {
      body: payload,
      ...(sig ? { headers: { "x-lawgpt-sig": sig } } : {}),
    });
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

  // Returns true only when the transcript was actually replaced. A false return
  // means the caller must NOT commit the new conversation identity.
  const loadConversationMessages = useCallback(
    async (cid: string): Promise<boolean> => {
      if (!currentUserEmail) return false;
      const data = await callHistory({
        action: "load_messages",
        user_email: currentUserEmail,
        conversation_id: cid,
      });
      if (!data?.success) return false;
      const restored: Message[] = ((data.rows as any[]) || []).map((row: any) => ({
        id: row.id,
        historyId: row.id,
        content: row.content,
        role: row.role === "ai" ? "assistant" : "user",
        timestamp: new Date(row.created_at),
        responseId: row.response_id || undefined,
        usedChunkIds: Array.isArray(row.used_chunk_ids) ? row.used_chunk_ids : undefined,
        usedParagraphs: Array.isArray(row.used_paragraphs) ? row.used_paragraphs : undefined,
        // The Verstanden line is safety equipment — it must survive a reload,
        // so it is read back out of the persisted payload.
        verstanden: row.role === "ai" ? extractVerstanden(row.content) : undefined,
      }));


      setMessages(restored);
      // Resume a pending analyze_pdf turn for THIS conversation, if any.
      resumePendingTurnRef.current?.(cid);
      return true;
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
      setConversationId(freshId); activeConversationRef.current = freshId;
      localStorage.setItem("chat-session-id", freshId);
      setMessages([]);

    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserEmail]);

  const persistMessage = async (
    role: "user" | "ai",
    content: string,
    meta?: { responseId?: string; usedChunkIds?: string[]; usedParagraphs?: string[] },
    conversationIdOverride?: string | null,
  ): Promise<string | null> => {
    const target = conversationIdOverride ?? conversationId;
    if (!currentUserEmail || !content || !target) return null;
    const data = await callHistory({
      action: "save_message",
      user_email: currentUserEmail,
      role,
      content,
      conversation_id: target,
      response_id: meta?.responseId ?? null,
      used_chunk_ids: meta?.usedChunkIds ?? null,
      used_paragraphs: meta?.usedParagraphs ?? null,
    });
    if (!data?.success) {
      console.error("Fehler beim Speichern der Nachricht");
      return null;
    }
    return typeof data.id === "string" ? data.id : null;
  };

  /** Remove one persisted message (soft delete) — used when a retry replaces it. */
  const deletePersistedMessage = async (historyId?: string) => {
    if (!historyId || !currentUserEmail) return;
    await callHistory({
      action: "delete_message",
      user_email: currentUserEmail,
      message_id: historyId,
    });
  };


  // Project linking ("Projekt verknüpfen") was withdrawn on 2026-09-03; the
  // backend no longer accepts `ingest_project`. Sweep any persisted refs so a
  // session that was linked before the withdrawal opens cleanly.
  const purgeStoredProjectRefs = () => {
    try {
      const doomed: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k === "chat-project-ref" || k.startsWith("chat-project-ref:"))) doomed.push(k);
      }
      doomed.forEach((k) => localStorage.removeItem(k));
    } catch { /* ignore */ }
  };

  const handleNewConversation = () => {
    // sessionId sent to n8n == conversationId, so a new conversation
    // always means a fresh, empty gpt_session_context on the backend.
    pollCancelRef.current += 1; // cancel any pending analyze_pdf poll
    const newId = crypto.randomUUID();
    setConversationId(newId); activeConversationRef.current = newId;
    localStorage.setItem("chat-session-id", newId);
    setMessages([]);
    setIsLoading(false); // never carry a spinner into another conversation
    

    if (typeof window !== "undefined" && window.innerWidth < 768) setSidebarOpen(false);
  };

  const handleSelectConversation = async (cid: string) => {
    if (cid === conversationId) return; // clicking the active row must do nothing
    // Load FIRST. Identity is committed only once the transcript is in hand,
    // so a failed load can never leave the previous transcript bound to `cid`.
    const loaded = await loadConversationMessages(cid);
    if (!loaded) {
      toast.error("Gespräch konnte nicht geladen werden.");
      return;
    }
    pollCancelRef.current += 1;
    setConversationId(cid); activeConversationRef.current = cid;
    setIsLoading(false);
    // Keep n8n session aligned with the selected conversation.
    localStorage.setItem("chat-session-id", cid);
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
    try { localStorage.removeItem("pending-turn:" + cid); } catch { /* ignore */ }
    if (conversationId === cid) {
      pollCancelRef.current += 1; // cancel any poll belonging to the deleted thread
      setMessages([]);
      const newId = crypto.randomUUID();
      setConversationId(newId); activeConversationRef.current = newId;
      setIsLoading(false);
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

  // Direct fetch to chat-proxy with a longer timeout than supabase.functions.invoke's default.
  // analyze_pdf/draft_statement can legitimately take up to ~3 min.
  // Returns the HTTP status alongside the parsed body so callers can tell a real
  // backend failure apart from an unreadable/empty answer.
  const invokeChatProxyRaw = async (
    body: Record<string, unknown>,
    timeoutMs = 180000,
  ): Promise<{ ok: boolean; status: number; data: any; rawText: string }> => {
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
      let data: any = null;
      if (text) {
        try { data = JSON.parse(text); } catch { data = { output: text }; }
      }
      return { ok: res.ok, status: res.status, data, rawText: text };
    } finally {
      clearTimeout(timer);
    }
  };

  const invokeChatProxy = async (body: Record<string, unknown>, timeoutMs = 180000): Promise<any> => {
    const { ok, status, data, rawText } = await invokeChatProxyRaw(body, timeoutMs);

    // A real HTTP failure is a real failure.
    if (!ok) {
      const obj4xx = Array.isArray(data) ? data[0] : data;
      // The backend sends specific, actionable German on 4xx paths. Carry it
      // through verbatim instead of overwriting it with a generic sentence.
      const backendMessage =
        obj4xx && typeof obj4xx === "object" && typeof (obj4xx as any).message === "string"
          ? ((obj4xx as any).message as string).trim()
          : "";
      console.error("chat-proxy failed:", status, rawText);
      if (status >= 400 && status < 500 && backendMessage) {
        throw new Error(`BackendMessage: ${backendMessage}`);
      }
      const code =
        obj4xx && typeof obj4xx === "object" && typeof (obj4xx as any).error === "string"
          ? (obj4xx as any).error
          : `http_${status}`;
      throw new Error(`BackendError: ${code}`);
    }


    if (!rawText) throw new Error("Leere Antwort vom Server.");

    // Belt and braces: a 200 body that is nothing but an error envelope is still a
    // failure. Only treat it as one when NO answer-shaped field is present, so the
    // deliberate user-facing guidance messages still render normally.
    const obj = Array.isArray(data) ? data[0] : data;
    if (
      obj && typeof obj === "object" &&
      typeof obj.error === "string" &&
      obj.antwort === undefined &&
      obj.action === undefined &&
      obj.ready === undefined &&
      obj.output === undefined &&
      obj.entwurf_stellungnahme === undefined &&
      obj.antwortschreiben_entwurf === undefined &&
      obj.projekt_und_sachverhalt === undefined
    ) {
      console.error("chat-proxy returned an error envelope at 200:", rawText);
      throw new Error(`BackendError: ${obj.error}`);
    }

    return data;
  };



  // Poll chat-proxy `get_result` every 3s for up to 5 min. Returns the
  // final payload (byte-identical to a synchronous analyze_pdf response).
  const pollForResult = async (
    sessionId: string,
    targetAction: string,
    turnId: string,
    turnStartedAt: number,
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
          { action: "get_result", sessionId, target_action: targetAction,
            turn_id: turnId, client_turn_id: turnId },
          30000,
        );
        if (pollCancelRef.current !== token) throw new Error("PollCancelled");
        const p = Array.isArray(res) ? res[0] : res;
        if (p && p.ready === true) {
          // BELT — the server was asked for this turn. If it answers with a
          // different one, it is a stale row and must never be rendered.
          if (p.turn_id && p.turn_id !== turnId) {
            console.warn("get_result returned a different turn; ignoring", p.turn_id);
            continue;
          }
          // BRACES — a result older than this request cannot belong to it.
          // Slack covers clock skew and queueing. Keep polling rather than fail.
          const SLACK_MS = 10000;
          if (typeof p.age_seconds === "number"
              && p.age_seconds * 1000 > Date.now() - turnStartedAt + SLACK_MS) {
            console.warn("get_result returned a result older than this request; ignoring");
            continue;
          }
          return p.payload ?? p;
        }
      } catch (e) {
        if ((e as Error)?.message === "PollCancelled") throw e;
        // transient network error — keep polling
        console.warn("get_result poll error, retrying:", e);
      }
    }
    throw new Error("PollTimeout");
  };

  // --- Resume a pending analyze_pdf turn when a conversation is opened ---
  // The backend stores the finished result indefinitely; without this, leaving the
  // page (unmount, new conversation, sidebar select, reload) loses it forever.
  const renderResumedResult = (data: any, cid: string) => {
    const { message, responseText, meta } = buildAssistantMessage(data);
    if (activeConversationRef.current === cid) {
      setMessages((prev) => [...prev, message]);
    }
    persistMessage("ai", responseText, meta, cid);
    try { localStorage.removeItem("pending-turn:" + cid); } catch { /* ignore */ }
    if (historyEnabled) loadConversations();
  };

  resumePendingTurnRef.current = (cid: string) => {
    let raw: string | null = null;
    try { raw = localStorage.getItem("pending-turn:" + cid); } catch { /* ignore */ }
    if (!raw) return; // normal case — no network request at all
    let pending: { turnId?: string; turnStartedAt?: number; action?: string; fileName?: string | null } | null = null;
    try { pending = JSON.parse(raw); } catch { /* ignore */ }
    const turnId = pending?.turnId;
    const turnStartedAt = typeof pending?.turnStartedAt === "number" ? pending!.turnStartedAt! : 0;
    const ageMs = Date.now() - turnStartedAt;
    if (!turnId || !turnStartedAt || ageMs > 30 * 60 * 1000) {
      try { localStorage.removeItem("pending-turn:" + cid); } catch { /* ignore */ }
      return;
    }

    (async () => {
      let res: any;
      try {
        res = await invokeChatProxy(
          { action: "get_result", sessionId: cid, target_action: pending?.action || "analyze_pdf",
            turn_id: turnId, client_turn_id: turnId },
          30000,
        );
      } catch (e) {
        console.warn("resume get_result failed:", e);
        return; // keep the key; try again next time the conversation is opened
      }
      const p = Array.isArray(res) ? res[0] : res;
      if (p && p.ready === true && (!p.turn_id || p.turn_id === turnId)) {
        renderResumedResult(p.payload ?? p, cid);
        return;
      }
      // Not ready. Younger than ~6 minutes → keep waiting; older → give up.
      if (ageMs > 6 * 60 * 1000) {
        try { localStorage.removeItem("pending-turn:" + cid); } catch { /* ignore */ }
        return;
      }
      if (activeConversationRef.current !== cid) return;
      // No progress text: the three-dot typing indicator is the only signal.
      setIsLoading(true);
      try {
        // The stored turn id MUST be reused — a fresh one could never match.
        const data = await pollForResult(cid, pending?.action || "analyze_pdf", turnId, turnStartedAt, () => {});
        if (activeConversationRef.current === cid) setIsLoading(false);
        renderResumedResult(data, cid);
      } catch (e) {
        if (activeConversationRef.current === cid) setIsLoading(false);
        if ((e as Error)?.message === "PollTimeout") {
          try { localStorage.removeItem("pending-turn:" + cid); } catch { /* ignore */ }
        }
        // PollCancelled → keep the key so the turn can be resumed again later.
      }
    })();
  };



  const sendMessage = async (
    content: string,
    files?: File[] | null,
    attachIntent?: 'schreiben' | 'quelle',
    opts?: { forceAction?: string; rerunOf?: string; replaceMessageId?: string },
  ) => {
    // Retry / "Stattdessen …": the new answer takes the old one's place instead of
    // being appended, and the old one is dropped from the persisted history.
    const replaceMessageId = opts?.replaceMessageId;
    const replacedMessage = replaceMessageId
      ? messages.find((m) => m.id === replaceMessageId)
      : undefined;
    // sessionId sent to n8n is ALWAYS the current conversationId.
    const sessionId = conversationId || crypto.randomUUID();
    // The conversation this send belongs to. Answers must be stored here even if
    // the user navigates away, and must NOT be rendered into another thread.
    const sendConversationId = conversationId;
    if (sessionId !== localStorage.getItem("chat-session-id")) {
      localStorage.setItem("chat-session-id", sessionId);
    }

    // One id per user ACTION. sessionId is the CONVERSATION, so it is identical for
    // letter A and letter B — which is why a poll for B matched A's stored result.
    // This variable is captured by the closure and used for BOTH the upload and the
    // poll, so the two can never diverge.
    const turnId = crypto.randomUUID();
    const turnStartedAt = Date.now();

    const hasFiles = Array.isArray(files) && files.length > 0;
    const firstFile = hasFiles ? files![0] : null;

    const displayContent = hasFiles
      ? (content
          ? `📎 [${files!.map((f) => f.name).join(", ")}] — ${content}`
          : `📎 [${files!.map((f) => f.name).join(", ")}]`)
      : content;

    if (!replaceMessageId) {
      const userMessage: Message = {
        id: crypto.randomUUID(),
        content: displayContent,
        role: "user",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMessage]);
      persistMessage("user", displayContent, undefined, sendConversationId);
    } else {
      // The replaced answer is dropped from the stored history right away; on
      // screen it stays until the new one takes its exact place.
      deletePersistedMessage(replacedMessage?.historyId);
    }

    /** Append, or put the new answer exactly where the replaced one stood. */
    const placeAssistantMessage = (msg: Message) => {
      setMessages((prev) => {
        if (!replaceMessageId) return [...prev, msg];
        const idx = prev.findIndex((m) => m.id === replaceMessageId);
        if (idx === -1) return [...prev, msg];
        const next = [...prev];
        next.splice(idx, 1, msg);
        return next;
      });
    };
    setIsLoading(true);

    let payload: Record<string, unknown> = {
      sessionId,
      timestamp: new Date().toISOString(),
      
      // One-click correction of a wrong routing decision.
      ...(opts?.forceAction ? { force_action: opts.forceAction } : {}),
      ...(opts?.rerunOf ? { rerun_of: opts.rerunOf } : {}),
    };

    if (hasFiles) {
      try {
        const encoded = await Promise.all(
          files!.map(async (f) => ({ file_name: f.name, file_base64: await toBase64(f) })),
        );
        payload = {
          ...payload,
          // The router decides analysis vs. source ingest. Never pre-decide here.
          action: "auto",
          files: encoded,
          // Back-compat: also send first file top-level (n8n may still read either)
          file_name: firstFile!.name,
          file_base64: encoded[0].file_base64,
          additional_question: content || null,
          client_turn_id: turnId,
          turn_id: turnId,
          attach_intent: attachIntent ?? 'schreiben',
        };
        const typed = (content || "").trim();
        if (typed) {
          payload.message = typed;
          // Kept for the analysis branch, which reads the objective by name.
          payload.ziel = typed;
        }
      } catch (err) {
        console.error("PDF konnte nicht gelesen werden:", err);
        toast.error("Datei konnte nicht gelesen werden.");
        setIsLoading(false);
        return;
      }
    } else {
      // ROUTING: the backend router decides. `action` must be sent EXPLICITLY —
      // chat-proxy defaults a missing action to "question", which bypasses R0.
      payload = { ...payload, message: content, action: "auto" };
    }

    const startTime = performance.now();
    // Flat ceiling: Supabase kills a request at ~150s idle, so anything longer is
    // unreachable and only turns a German backend error into a network error.
    const timeoutMs = 145000;
    try {
      let data = await invokeChatProxy(payload, timeoutMs);
      console.log("n8n Antwort:", data);

      // --- ASYNC REQUEST-REPLY ---
      // Detect on BODY (chat-proxy normalises status codes to 200).
      const initial = Array.isArray(data) ? data[0] : data;
      if (
        initial && typeof initial === "object" &&
        (initial.status === "accepted" || initial.poll === true)
      ) {
        // Under `auto` the client cannot know the action — the 202 body carries it.
        const pollAction: string = initial.action ?? "analyze_pdf";
        // No progress text while the analysis runs — the three-dot typing
        // indicator (driven by isLoading) is the only signal.
        // Record the turn durably so it can be resumed after navigation/reload.
        try {
          localStorage.setItem("pending-turn:" + sendConversationId, JSON.stringify({
            turnId, turnStartedAt, action: pollAction, fileName: firstFile?.name ?? null,
          }));
        } catch { /* ignore */ }
        data = await pollForResult(sessionId, pollAction, turnId, turnStartedAt, () => {});
        // The result is in hand — the turn no longer needs resuming.
        try { localStorage.removeItem("pending-turn:" + sendConversationId); } catch { /* ignore */ }
      }

      // An error envelope must never become an assistant message, and must never be
      // written to chat history. Throw so the German error path below runs.
      const parsedFinal = Array.isArray(data) ? data[0] : data;
      if (
        parsedFinal && typeof parsedFinal === "object" &&
        typeof parsedFinal.error === "string" &&
        !parsedFinal.antwort && !parsedFinal.action && !parsedFinal.entwurf_stellungnahme &&
        !parsedFinal.antwortschreiben_entwurf && !parsedFinal.projekt_und_sachverhalt
      ) {
        throw new Error(`BackendError: ${parsedFinal.error}`);
      }

      const { message: assistantMessage, responseText, meta } =
        buildAssistantMessage(data, performance.now() - startTime);


      if (activeConversationRef.current === sendConversationId) {
        placeAssistantMessage(assistantMessage);
      }
      // The user may have switched away. The answer belongs to sendConversationId;
      // persist it there — resume-on-open surfaces it when they return.
      persistMessage("ai", responseText, meta, sendConversationId).then((rowId) => {
        if (!rowId) return;
        setMessages((prev) => prev.map((m) =>
          m.id === assistantMessage.id ? { ...m, historyId: rowId } : m,
        ));
      });
      if (historyEnabled) loadConversations();

    } catch (error) {
      console.error("Fehler beim Senden:", error);
      const errName = (error as Error)?.name;
      const errMsgStr = (error as Error)?.message || "";
      if (errMsgStr === "PollCancelled") {
        // User navigated away / started a new conversation. Silent.
        return;
      }
      const isAbort = errName === "AbortError";
      const isPollTimeout = errMsgStr === "PollTimeout";
      const isBackendError = errMsgStr.startsWith("BackendError:");
      // A 4xx that carried a German message from the backend is shown verbatim.
      const backendMessage = errMsgStr.startsWith("BackendMessage:")
        ? errMsgStr.slice("BackendMessage:".length).trim()
        : "";
      const msg = backendMessage
        ? backendMessage
        : isPollTimeout
        ? "Die Analyse dauert länger als 5 Minuten. Bitte erneut versuchen — das Ergebnis wird beim nächsten Versuch normalerweise sofort geladen."
        : isAbort
        ? "Zeitüberschreitung. Die Analyse dauert länger als erwartet. Bitte erneut versuchen."
        : isBackendError
        ? "Die Anfrage konnte nicht verarbeitet werden — der Server hat einen Fehler gemeldet. Bitte versuchen Sie es erneut. Wenn der Fehler erneut auftritt, melden Sie ihn bitte."
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
      if (activeConversationRef.current === sendConversationId) {
        // A failed retry shows the error card in the replaced answer's position.
        placeAssistantMessage(errorMessage);
      }
      // Definitive failure — nothing left to resume.
      try { localStorage.removeItem("pending-turn:" + sendConversationId); } catch { /* ignore */ }
      // Preserve the user's input in the composer so they can retry
      if (content && activeConversationRef.current === sendConversationId) setInputValue(content);
    } finally {
      if (activeConversationRef.current === sendConversationId) setIsLoading(false);
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
      // chat-proxy now answers non-2xx when the backend did not confirm the write.
      if (error) return { error: "Speichern fehlgeschlagen — der Server hat den Vorgang nicht bestätigt." };
      const parsed = Array.isArray(data) ? data[0] : data;
      const saved = parsed && (parsed.saved === true || parsed.status === "success");
      if (!saved) return { error: parsed?.error || "Speichern fehlgeschlagen — keine Bestätigung vom Server." };
      setMessages((prev) => prev.map((m) => {
        if (m.id !== messageId) return m;
        try {
          const trimmed = (m.content || "").trim();
          if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return m;
          const parsedMsg = JSON.parse(trimmed);
          if (Array.isArray(parsedMsg)) {
            parsedMsg[0] = { ...parsedMsg[0], entwurf_stellungnahme: newText };
            return { ...m, content: JSON.stringify(parsedMsg) };
          }
          return { ...m, content: JSON.stringify({ ...parsedMsg, entwurf_stellungnahme: newText }) };
        } catch { return m; }
      }));
      return true;
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  };


  // Rehydrate sessionId on mount so a reload preserves the thread, and purge
  // any project refs stored by the withdrawn "Projekt verknüpfen" feature.
  useEffect(() => {
    if (!localStorage.getItem("chat-session-id")) {
      localStorage.setItem("chat-session-id", crypto.randomUUID());
    }
    purgeStoredProjectRefs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // Server-verified admin check
  useEffect(() => {
    const checkAdmin = async () => {
      const email = getUserEmail();

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

  /**
   * One-click correction: resend the text of the user turn this answer replies to,
   * with force_action + rerun_of so the router redecides instead of guessing again.
   */
  const handleCorrect = (assistantMessageId: string, alternative: string, rerunOf?: string) => {
    if (isLoading) return;
    const idx = messages.findIndex((m) => m.id === assistantMessageId);
    if (idx === -1) return;
    let original = "";
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === "user") { original = messages[i].content; break; }
    }
    // Strip the attachment prefix the bubble adds: "📎 [a.pdf, b.pdf] — text".
    const text = original.replace(/^\s*📎\s*\[[^\]]*\]\s*(—\s*)?/, "").trim();
    if (!text) {
      toast.error("Der ursprüngliche Text ist nicht mehr verfügbar.");
      return;
    }
    sendMessage(text, null, undefined, {
      forceAction: alternative || undefined,
      // rerun_of identifies the answer being replaced.
      rerunOf: rerunOf || assistantMessageId,
      replaceMessageId: assistantMessageId,
    });
  };

  // What the conversation currently holds, per the most recent router report.
  const zustand = (() => {
    // A file that was re-filed as "Unterlage" must stop counting as "Schreiben",
    // even when the last state report still came from its earlier analysis.
    let reclassified = false;
    for (let i = messages.length - 1; i >= 0; i--) {
      const v = messages[i].verstanden;
      if (v?.typ === "upload_source" && v?.grund === "unterlage_umgewidmet") {
        reclassified = true;
      }
      if (v?.zustand) {
        if (!reclassified) return v.zustand;
        const count = typeof v.zustand.source_count === "number" ? v.zustand.source_count : 0;
        return {
          ...v.zustand,
          subject_file: null,
          has_sources: true,
          source_count: Math.max(1, count),
        };
      }
    }
    if (reclassified) return { subject_file: null, has_sources: true, source_count: 1 };
    return null;
  })();

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
          identityMissing={!currentUserEmail}
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
              <EmptyState />
            ) : (
              <div className="py-4">
                {messages.map((message) => (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    onFeedback={handleFeedback}
                    isAdmin={isAdmin}
                    onSaveStatement={handleSaveStatement}
                    onCorrect={handleCorrect}
                    correctionDisabled={isLoading}
                  />
                ))}
                <AnimatePresence>{isLoading && <TypingIndicator />}</AnimatePresence>
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        </main>

        <Gespraechsleiste zustand={zustand} />

        <ChatInput
          onSendMessage={(msg, files, attachIntent) => {
            sendMessage(msg, files, attachIntent);
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

