// Streams the answer text straight from n8n (the edge function cannot hold a
// stream on the current plan). The checked answer still comes from get_result.

export const STREAM_URL = "https://server.umnutzung.de/webhook/building-law-gpt-stream";
const FLAG_KEY = "lawgpt-stream";

/** Rollout switch: ?stream=1 turns streaming on, ?stream=0 off; remembered for iframe reloads. */
export function isStreamEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const p = new URLSearchParams(window.location.search).get("stream");
    if (p === "1") localStorage.setItem(FLAG_KEY, "1");
    else if (p === "0") localStorage.removeItem(FLAG_KEY);
    return localStorage.getItem(FLAG_KEY) === "1";
  } catch {
    return new URLSearchParams(window.location.search).get("stream") === "1";
  }
}

// Same key list as chat-proxy's forwardPayload — the stream body must be identical.
const PASSTHROUGH_KEYS = [
  "file_id", "file_base64", "file_name", "files",
  "state", "question", "topic", "statement_type",
  "ziel", "mode", "source_type", "upload_type",
  "chunk_id", "target_action",
  "turn_id", "client_turn_id",
  "force_action", "attach_intent", "rerun_of",
];

export function buildForwardBody(body: Record<string, unknown>): Record<string, unknown> {
  const action = (body.action as string) || "question";
  const out: Record<string, unknown> = {
    action,
    message: typeof body.message === "string" ? body.message : "",
    sessionId: body.sessionId || null,
    timestamp: body.timestamp || new Date().toISOString(),
  };
  // chat-proxy extracts a Drive file id from the message; mirror it.
  const m = typeof body.message === "string" ? body.message.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/) : null;
  const src: Record<string, unknown> = { ...body };
  if (m && !src.file_id) src.file_id = m[1].split("/")[0].split("?")[0];
  for (const k of PASSTHROUGH_KEYS) if (src[k] !== undefined) out[k] = src[k];
  if (action === "draft_statement" && out.statement_type === undefined) out.statement_type = "Stellungnahme";
  return out;
}

/**
 * Number source pointers [[lc:12345 L4-L9]] as [n] while streaming, following
 * the backend rule: n by first appearance of each source, consecutive
 * duplicates of the same source collapsed. `num` is per-turn state so numbers
 * stay stable across chunks; the finished answer then differs only by the
 * checks, not by freshly appearing markers.
 */
function numberPointers(t: string, num: Map<string, number>): string {
  const out = t.replace(/\[\[([^\]]*)\]\]/g, (_m, inner: string) => {
    const key = inner.trim().split(/\s+/)[0] || inner.trim();
    let n = num.get(key);
    if (n === undefined) { n = num.size + 1; num.set(key, n); }
    return `[${n}]`;
  });
  // Consecutive duplicates of the same source: "[2] [2]" / "[2],[2]" → "[2]".
  return out.replace(/(\[\d{1,3}\])([\s,]*\1)+/g, "$1");
}

/** Raw text before the checks → what may be shown. */
export function cleanStreamText(raw: string, advisorEnded = false, num?: Map<string, number>): { text: string; draft: string | null; checking: boolean } {
  let s = raw;
  const caseIdx = s.search(/^\s*<<<CASE/m);
  const checking = advisorEnded || caseIdx !== -1;
  if (caseIdx !== -1) s = s.slice(0, caseIdx);
  // A marker still arriving at the very end: hide the partial "<<<…" line.
  s = s.replace(/(^|\n)\s*<{1,3}[A-Z]*\s*$/, "$1");
  let draft: string | null = null;
  const open = s.match(/^[ \t]*<<<DRAFT[^\n]*(\n|$)/m);
  if (open && open.index !== undefined) {
    const after = s.slice(open.index + open[0].length);
    const close = after.match(/^[ \t]*DRAFT>>>[^\n]*$/m);
    draft = close && close.index !== undefined ? after.slice(0, close.index) : after.replace(/(^|\n)[ \t]*D?R?A?F?T?>{0,3}$/, "$1");
    s = s.slice(0, open.index) + (close && close.index !== undefined ? after.slice(close.index + close[0].length) : "");
  }
  const strip = (t: string) => {
    const numbered = num ? numberPointers(t, num) : t.replace(/[ \t]?\[\[[^\]]*\]\]/g, "");
    return numbered.replace(/\[\[[^\]]*$/, "").replace(/[ \t]+([.,;:])/g, "$1");
  };
  return { text: dashes(strip(s)).trim(), draft: draft ? dashes(strip(draft)).trim() || null : null, checking };
}

/** Punctuation dashes → ", "; line-start dash → "- ". Number ranges stay. */
export function dashes(t: string): string {
  return t
    .replace(/^([ \t]*)[–—][ \t]+/gm, "$1- ")
    .replace(/[ \t]+[–—][ \t]+/g, ", ")
    .replace(/,\s*,/g, ",");
}

/** Split into the complete lines (Markdown) and the unfinished last line (plain). */
export function splitComplete(t: string, finished = false): { done: string; tail: string } {
  if (finished) return { done: t, tail: "" };
  const i = t.lastIndexOf("\n");
  if (i === -1) return { done: "", tail: t.replace(/^#{1,6}\s*|^\s*[-*]\s+|\*\*|__/g, "") };
  return { done: t.slice(0, i), tail: t.slice(i + 1).replace(/^#{1,6}\s*|^\s*[-*]\s+|\*\*|__/g, "") };
}

export interface StreamHandlers {
  onAccepted: (info: { turnId?: string; action?: string }) => void;
  onText: (raw: string) => void;
  /** The Advisor node finished writing (checks still running). */
  onAdvisorEnd?: () => void;
}

export type StreamOutcome = "done" | "failed";

/** Reads the NDJSON stream. Resolves "done" on Respond Done, else "failed". */
export async function streamAnswer(
  body: Record<string, unknown>,
  handlers: StreamHandlers,
  signal: AbortSignal,
  idleMs = 180000,
): Promise<StreamOutcome> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal.addEventListener("abort", onAbort);
  let idle: ReturnType<typeof setTimeout> | undefined;
  const arm = () => { clearTimeout(idle); idle = setTimeout(() => ctrl.abort(), idleMs); };
  try {
    arm();
    const res = await fetch(STREAM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (res.status !== 200 || !res.body) return "failed";
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let text = "";
    const handle = (line: string): boolean => {
      const t = line.trim();
      if (!t) return false;
      let ev: any;
      try { ev = JSON.parse(t); } catch { return false; }
      const node = ev?.metadata?.nodeName;
      if (node === "Advisor") {
        if (ev.type === "begin") { text = ""; handlers.onText(""); }
        else if (ev.type === "item" && typeof ev.content === "string") { text += ev.content; handlers.onText(text); }
        // n8n ends the Advisor after every research round; only a round that wrote text is the answer.
        else if (ev.type === "end" && text) handlers.onAdvisorEnd?.();
        return false;
      }
      if (node === "Respond Accepted" && ev.type === "item") {
        try {
          const c = typeof ev.content === "string" ? JSON.parse(ev.content) : ev.content;
          handlers.onAccepted({ turnId: c?.turn_id, action: c?.action });
        } catch { handlers.onAccepted({}); }
        return false;
      }
      if ((node === "Respond Done" || node === "Respond Error Done") && ev.type === "item") return true;
      return false;
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      arm();
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (handle(line)) { reader.cancel().catch(() => {}); return "done"; }
      }
    }
    if (buf && handle(buf)) return "done";
    return "failed";
  } catch {
    return "failed";
  } finally {
    clearTimeout(idle);
    signal.removeEventListener("abort", onAbort);
  }
}
