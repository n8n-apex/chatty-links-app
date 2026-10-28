/**
 * Segmented dictation. The recorder cuts one complete audio file per segment
 * (45–90 s, cut at a pause), stores every segment in IndexedDB BEFORE uploading
 * it, and deletes it only after the server answered status "transcribed".
 * A dictation of any length survives network loss and page reloads; the
 * server's safety net transcribes stored segments even if the browser closes.
 *
 * chat-proxy is NOT used for audio any more. The only chat-proxy call left here
 * is the client_error report for a segment that never got its text.
 */

import { supabase } from '@/integrations/supabase/client';

const SEGMENT_URL = 'https://server.umnutzung.de/webhook/lawgpt-dictation-segment';
const TRANSCRIPT_URL = 'https://server.umnutzung.de/webhook/lawgpt-dictation-transcript';

const DB_NAME = 'lawgpt-dictation';
const DB_VERSION = 1;

const SEG_MIN_MS = 30_000; // from here: cut at a pause of PAUSE_MS
const SEG_LATE_MS = 75_000; // from here: a shorter pause is enough
const SEG_MAX_MS = 120_000; // forced cut (with 1 s overlap) if no pause came
const PAUSE_MS = 300;
const PAUSE_LATE_MS = 150;
const OVERLAP_MS = 1_000;
const LEVEL_INTERVAL_MS = 50;
const LEVEL_WINDOW_MS = 10_000; // background/speech level measured over this window
const SILENCE_RMS = 0.012; // fallback threshold until the window has data
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000];
const STOP_GRACE_MS = 20_000; // after stop: wait this long before polling the transcript
const TRANSCRIPT_POLL_MS = 10_000;
const TRANSCRIPT_POLL_MAX_MS = 5 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- IndexedDB ----------

export interface StoredRecording {
  recording_id: string;
  startedAt: number;
  session_id: string;
  user_email: string;
  mime: string;
  nextSeq: number;
  stopped: boolean;
  done: boolean;
}

export interface StoredSegment {
  recording_id: string;
  seq: number;
  blob: Blob;
  mime: string;
  status: 'stored' | 'failed';
}

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('recordings')) {
        db.createObjectStore('recordings', { keyPath: 'recording_id' });
      }
      if (!db.objectStoreNames.contains('segments')) {
        db.createObjectStore('segments', { keyPath: ['recording_id', 'seq'] });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const idb = <T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
  openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const r = fn(t.objectStore(store));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        t.oncomplete = () => db.close();
        t.onerror = () => reject(t.error);
      }),
  );

const putRecording = (rec: StoredRecording) => idb('recordings', 'readwrite', (s) => s.put(rec));
const getRecording = (id: string) => idb('recordings', 'readonly', (s) => s.get(id) as IDBRequest<StoredRecording | undefined>);
const deleteRecording = (id: string) => idb('recordings', 'readwrite', (s) => s.delete(id));
const putSegment = (seg: StoredSegment) => idb('segments', 'readwrite', (s) => s.put(seg));
const getSegment = (id: string, seq: number) => idb('segments', 'readonly', (s) => s.get([id, seq]) as IDBRequest<StoredSegment | undefined>);
const deleteSegment = (id: string, seq: number) => idb('segments', 'readwrite', (s) => s.delete([id, seq]));
const getSegments = (id: string) =>
  idb('segments', 'readonly', (s) => s.getAll(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])) as IDBRequest<StoredSegment[]>);

const setSegmentStatus = async (id: string, seq: number, status: StoredSegment['status']) => {
  const seg = await getSegment(id, seq);
  if (seg) await putSegment({ ...seg, status });
};

/** The newest recording that never finished, if any. */
export const findUnfinishedRecording = async (): Promise<StoredRecording | null> => {
  const all = await idb('recordings', 'readonly', (s) => s.getAll() as IDBRequest<StoredRecording[]>);
  const open = all.filter((r) => !r.done).sort((a, b) => b.startedAt - a.startedAt);
  return open[0] ?? null;
};

/** Throw a recording away (user dismissed the restore offer). */
export const discardRecording = async (id: string) => {
  const segs = await getSegments(id);
  for (const seg of segs) await deleteSegment(id, seg.seq);
  await deleteRecording(id);
};

// ---------- MIME ----------

export const pickMime = (): string => {
  if (typeof MediaRecorder === 'undefined') return '';
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4'; // Safari
  return '';
};

// Strip Whisper ASR subtitle boilerplate that appears over silence.
const ARTIFACT_PATTERNS: RegExp[] = [
  /copyright\s+wdr(?:\s+\d{4})?\.?$/i,
  /untertitel(?:ung)?\s+(?:im\s+auftrag\s+des\s+|des\s+)?zdf[^.]*\.?$/i,
  /untertitel\s+von\s+stephanie\s+geiges\.?$/i,
  /(?:die\s+)?untertitel[- ]?community\.?$/i,
  /untertitel(?:ung)?\s+(?:der\s+)?amara\.org[- ]?community\.?$/i,
  /vielen\s+dank\s+f(?:ü|u)r'?s\s+zuschauen\.?$/i,
  /bis\s+zum\s+n(?:ä|a)chsten\s+mal\.?$/i,
  /mehr\s+infos\s+auf\s+\S+\.?$/i,
];
export const stripAsrArtifacts = (raw: string): string => {
  let s = (raw || '').trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const re of ARTIFACT_PATTERNS) {
      const next = s.replace(re, '').replace(/[\s\.,;:!?-]+$/, '').trim();
      if (next !== s) { s = next; changed = true; }
    }
  }
  return s;
};

// ---------- Overlap removal ----------

const normWord = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * After a forced cut the next segment repeats ~1 s of audio. Drop from the end
 * of `prev` the longest run (2..15 words) that equals the start of `next`,
 * ignoring case and punctuation.
 */
export const trimOverlap = (prev: string, next: string): string => {
  const p = prev.trim().split(/\s+/).filter(Boolean);
  const n = next.trim().split(/\s+/).filter(Boolean).slice(0, 15).map(normWord);
  const tail = p.slice(-15).map(normWord);
  for (let k = Math.min(tail.length, n.length); k >= 2; k--) {
    let ok = true;
    for (let i = 0; i < k; i++) if (!tail[tail.length - k + i] || tail[tail.length - k + i] !== n[i]) { ok = false; break; }
    if (ok) return p.slice(0, p.length - k).join(' ');
  }
  return prev.trim();
};

// ---------- Server calls ----------

const uploadSegmentOnce = async (seg: StoredSegment, rec: StoredRecording): Promise<string> => {
  const fd = new FormData();
  const ext = seg.mime.includes('mp4') ? 'm4a' : 'webm';
  fd.append('audio', new File([seg.blob], `abschnitt-${seg.seq}.${ext}`, { type: seg.mime }));
  fd.append('recording_id', seg.recording_id);
  fd.append('seq', String(seg.seq));
  fd.append('session_id', rec.session_id);
  fd.append('user_email', rec.user_email);
  fd.append('mime', seg.mime);
  const resp = await fetch(SEGMENT_URL, { method: 'POST', body: fd });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json().catch(() => null);
  if (!data || data.status !== 'transcribed' || typeof data.text !== 'string') {
    throw new Error(data?.error || data?.status || 'kein Text');
  }
  return stripAsrArtifacts(data.text);
};

export interface TranscriptResult {
  text: string;
  segments: { seq: number; status: string; text?: string }[];
  pending: number[];
  missing: number[];
}

export const fetchTranscript = async (recordingId: string): Promise<TranscriptResult | null> => {
  try {
    const resp = await fetch(TRANSCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recording_id: recordingId }),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as TranscriptResult;
  } catch {
    return null;
  }
};

// One alert per segment that never got its text, so we are notified by email.
// chat-proxy forwards only whitelisted keys, so the details ride in `message`.
const reportClientError = (recordingId: string, seq: number, err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  supabase.functions
    .invoke('chat-proxy', {
      body: {
        action: 'client_error',
        message: `Diktat: Abschnitt ${seq} der Aufnahme ${recordingId} konnte nicht umgewandelt werden (${msg}).`,
        sessionId: localStorage.getItem('chat-session-id') || null,
        timestamp: new Date().toISOString(),
      },
    })
    .catch(() => {});
};

// ---------- Recorder ----------

export interface DictationEvents {
  /** A segment's text arrived, in arrival order (the UI inserts in seq order). */
  onText: (seq: number, text: string) => void;
  /** How many segments are still waiting for their text. */
  onPendingChange: (pending: number) => void;
  /** How many segments could not be uploaded even after the retries. */
  onFailedChange: (failed: number) => void;
  /** After stop: every segment has its text. */
  onAllDone: () => void;
}

export class DictationRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private levels: { t: number; rms: number }[] = [];
  private overlapSeqs = new Set<number>(); // segments that start 1 s before the previous ended
  private texts = new Map<number, string>(); // arrived, not yet released to the UI
  private nextRelease = 0;
  private forcing = false;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelTimer: number | null = null;
  private segStartedAt = 0;
  private silenceSince: number | null = null;
  private stopping = false;
  private rec: StoredRecording | null = null;
  private queue: number[] = [];
  private activeUploads = 0;
  private pendingTexts = new Set<number>();
  private failedSeqs = new Set<number>();
  private delivered = new Set<number>();
  private pollTimer: number | null = null;
  private graceTimer: number | null = null;
  private mime = '';

  constructor(private opts: { sessionId: string; userEmail: string; events: DictationEvents }) {}

  get recordingId() {
    return this.rec?.recording_id ?? null;
  }

  async start() {
    this.mime = pickMime();
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec: StoredRecording = {
      recording_id: crypto.randomUUID(),
      startedAt: Date.now(),
      session_id: this.opts.sessionId,
      user_email: this.opts.userEmail,
      mime: this.mime,
      nextSeq: 0,
      stopped: false,
      done: false,
    };
    this.rec = rec;
    await putRecording(rec);
    try {
      this.audioCtx = new AudioContext();
      const src = this.audioCtx.createMediaStreamSource(this.stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 2048;
      src.connect(this.analyser);
    } catch {
      this.analyser = null; // no pause detection: hard cut at 90 s still applies
    }
    this.startSegment();
    this.levelTimer = window.setInterval(() => this.checkLevel(), LEVEL_INTERVAL_MS);
  }

  /** User pressed stop: finish the current segment, then wait for all texts. */
  stop() {
    this.stopping = true;
    if (this.levelTimer !== null) {
      clearInterval(this.levelTimer);
      this.levelTimer = null;
    }
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.stop(); // onstop → finishSegment → beginStopWait
    } else {
      this.beginStopWait();
    }
  }

  /** Re-upload every segment that failed after its retries. */
  retryFailed() {
    const seqs = [...this.failedSeqs];
    this.failedSeqs.clear();
    this.emitFailed();
    for (const seq of seqs) {
      if (this.rec) void setSegmentStatus(this.rec.recording_id, seq, 'stored');
      this.enqueue(seq);
    }
  }

  /** Download the failed segments' audio so nothing is lost. */
  async downloadFailedAudio() {
    if (!this.rec) return;
    for (const seq of [...this.failedSeqs].sort((a, b) => a - b)) {
      const seg = await getSegment(this.rec.recording_id, seq);
      if (!seg) continue;
      const ext = seg.mime.includes('mp4') ? 'm4a' : 'webm';
      const url = URL.createObjectURL(seg.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `diktat-abschnitt-${seq}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  dispose() {
    if (this.levelTimer !== null) clearInterval(this.levelTimer);
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    if (this.graceTimer !== null) clearTimeout(this.graceTimer);
    try {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    } catch { /* already stopped */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.audioCtx?.close().catch(() => {});
  }

  // --- segment lifecycle ---

  private startSegment(overlap = false) {
    if (!this.stream || !this.rec) return;
    const seq = this.rec.nextSeq;
    this.rec.nextSeq = seq + 1;
    void putRecording(this.rec);
    if (overlap) this.overlapSeqs.add(seq);
    const chunks: Blob[] = [];
    const mr = new MediaRecorder(this.stream, this.mime ? { mimeType: this.mime } : undefined);
    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    mr.onstop = () => void this.finishSegment(seq, chunks, mr);
    this.recorder = mr;
    this.segStartedAt = Date.now();
    this.silenceSince = null;
    mr.start(1000);
  }

  private checkLevel() {
    if (!this.recorder || this.recorder.state !== 'recording' || this.forcing) return;
    const now = Date.now();
    const elapsed = now - this.segStartedAt;
    if (elapsed >= SEG_MAX_MS) {
      this.forceCut();
      return;
    }
    if (!this.analyser) return;
    const buf = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    this.levels.push({ t: now, rms });
    while (this.levels.length && now - this.levels[0].t > LEVEL_WINDOW_MS) this.levels.shift();

    // Threshold relative to the room: background (p10) + 25 % of the gap to speech (p80).
    let threshold = SILENCE_RMS;
    if (this.levels.length >= 40) {
      const sorted = this.levels.map((l) => l.rms).sort((a, b) => a - b);
      const pct = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
      const bg = pct(0.1);
      const speech = pct(0.8);
      threshold = bg + 0.25 * Math.max(0, speech - bg);
    }

    if (rms < threshold) {
      if (this.silenceSince === null) this.silenceSince = now;
      const pause = now - this.silenceSince;
      const needed = elapsed >= SEG_LATE_MS ? PAUSE_LATE_MS : PAUSE_MS;
      if (elapsed >= SEG_MIN_MS && pause >= needed) this.cutSegment();
    } else {
      this.silenceSince = null;
    }
  }

  /** Cut in a pause: stop now, the next segment starts in onstop. */
  private cutSegment() {
    if (!this.recorder || this.recorder.state !== 'recording') return;
    this.recorder.stop();
  }

  /** No pause within the limit: start the next segment first, stop this one 1 s later. */
  private forceCut() {
    const old = this.recorder;
    if (!old || old.state !== 'recording') return;
    this.forcing = true;
    (old as MediaRecorder & { _overlapped?: boolean })._overlapped = true;
    this.startSegment(true);
    window.setTimeout(() => {
      this.forcing = false;
      if (old.state !== 'inactive') old.stop();
    }, OVERLAP_MS);
  }

  private async finishSegment(seq: number, chunks: Blob[], mr: MediaRecorder) {
    const rec = this.rec;
    if (!rec) return;
    const overlapped = (mr as MediaRecorder & { _overlapped?: boolean })._overlapped === true;
    const blob = new Blob(chunks, { type: this.mime || 'audio/webm' });
    const isCurrent = this.recorder === mr;
    if (isCurrent) {
      if (this.stopping) {
        this.stream?.getTracks().forEach((t) => t.stop());
        void this.audioCtx?.close().catch(() => {});
      } else if (!overlapped) {
        this.startSegment(); // pause cut: continue seamlessly
      }
    }
    if (blob.size > 0) {
      // Store BEFORE uploading: the segment survives a crash from here on.
      await putSegment({ recording_id: rec.recording_id, seq, blob, mime: this.mime || 'audio/webm', status: 'stored' });
      this.pendingTexts.add(seq);
      this.emitPending();
      this.enqueue(seq);
    } else {
      this.deliverText(seq, ''); // empty segment: nothing to wait for
    }
    if (this.stopping && isCurrent) this.beginStopWait();
  }

  // --- upload queue: in order, at most two at a time ---

  private enqueue(seq: number) {
    if (!this.queue.includes(seq) && !this.delivered.has(seq)) this.queue.push(seq);
    this.queue.sort((a, b) => a - b);
    void this.pump();
  }

  private async pump() {
    while (this.activeUploads < 2 && this.queue.length > 0) {
      const seq = this.queue.shift()!;
      if (this.delivered.has(seq)) continue;
      this.activeUploads++;
      void this.uploadWithRetries(seq).finally(() => {
        this.activeUploads--;
        void this.pump();
      });
    }
  }

  private async uploadWithRetries(seq: number) {
    const rec = this.rec;
    if (!rec) return;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (this.delivered.has(seq)) return;
      try {
        const seg = await getSegment(rec.recording_id, seq);
        if (!seg) return; // nothing stored, nothing we can do
        const text = await uploadSegmentOnce(seg, rec);
        this.deliverText(seq, text);
        return;
      } catch (e) {
        lastErr = e;
        if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
    // The browser gives up; the server's safety net continues if the segment reached it.
    this.failedSeqs.add(seq);
    await setSegmentStatus(rec.recording_id, seq, 'failed');
    this.emitFailed();
    reportClientError(rec.recording_id, seq, lastErr);
  }

  // --- stop flow: grace period, then transcript polling ---

  private beginStopWait() {
    if (this.rec) {
      this.rec.stopped = true;
      void putRecording(this.rec);
    }
    if (this.pendingTexts.size === 0) {
      this.finishAll();
      return;
    }
    this.graceTimer = window.setTimeout(() => this.startTranscriptPolling(), STOP_GRACE_MS);
  }

  private startTranscriptPolling() {
    const started = Date.now();
    const tick = async () => {
      if (!this.rec) return;
      const t = await fetchTranscript(this.rec.recording_id);
      if (t) {
        for (const s of t.segments || []) {
          if (s.status === 'transcribed' && typeof s.text === 'string' && !this.delivered.has(s.seq)) {
            this.deliverText(s.seq, stripAsrArtifacts(s.text));
          }
        }
        // Segments the server never got: upload them again from IndexedDB.
        for (const seq of [...(t.missing || []), ...(t.pending || [])]) {
          if (!this.delivered.has(seq)) this.enqueue(seq);
        }
      }
      if (this.pendingTexts.size === 0) {
        this.finishAll();
        return;
      }
      if (Date.now() - started < TRANSCRIPT_POLL_MAX_MS) {
        this.pollTimer = window.setTimeout(() => void tick(), TRANSCRIPT_POLL_MS);
      }
      // After 5 min the server's safety net still finishes; nothing more to do here.
    };
    void tick();
  }

  private deliverText(seq: number, text: string) {
    if (this.delivered.has(seq) || !this.rec) return;
    this.delivered.add(seq);
    this.pendingTexts.delete(seq);
    this.failedSeqs.delete(seq);
    void deleteSegment(this.rec.recording_id, seq);
    this.texts.set(seq, text);
    this.releaseTexts();
    this.emitPending();
    this.emitFailed();
    if (this.stopping && this.pendingTexts.size === 0) this.finishAll();
  }

  /**
   * Hand texts to the UI in seq order. A text whose successor overlaps waits
   * for that successor, so the repeated words can be cut from its end first.
   */
  private releaseTexts() {
    const total = this.rec?.nextSeq ?? 0;
    while (this.texts.has(this.nextRelease)) {
      const seq = this.nextRelease;
      let text = this.texts.get(seq)!;
      if (this.overlapSeqs.has(seq + 1)) {
        if (!this.texts.has(seq + 1)) {
          if (seq + 1 < total || !this.stopping) break; // successor still on its way
        } else {
          text = trimOverlap(text, this.texts.get(seq + 1)!);
        }
      }
      this.texts.delete(seq);
      this.nextRelease = seq + 1;
      if (text) this.opts.events.onText(seq, text);
    }
  }

  private finishAll() {
    this.releaseTexts();
    for (const [seq, text] of [...this.texts].sort((a, b) => a[0] - b[0])) {
      if (text) this.opts.events.onText(seq, text); // successor lost: release untrimmed
    }
    this.texts.clear();
    if (this.graceTimer !== null) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.rec) {
      this.rec.done = true;
      void putRecording(this.rec);
    }
    this.opts.events.onAllDone();
  }

  private emitPending() {
    this.opts.events.onPendingChange(this.pendingTexts.size);
  }

  private emitFailed() {
    this.opts.events.onFailedChange(this.failedSeqs.size);
  }
}

// ---------- Resume after reload or crash ----------

/**
 * Upload a recording's remaining segments and fetch its transcript.
 * Returns the joined text spoken so far. Segments whose text arrived are
 * deleted locally; anything still open stays in IndexedDB (and the recording
 * stays unfinished, so the restore offer appears again next load).
 */
export const resumeRecording = async (
  recordingId: string,
  onProgress?: (openSegments: number) => void,
): Promise<string> => {
  const rec = await getRecording(recordingId);
  if (!rec) return '';
  const segs = (await getSegments(recordingId)).sort((a, b) => a.seq - b.seq);
  // Idempotent on the server: an already transcribed segment is answered from storage.
  for (const seg of segs) {
    try {
      await uploadSegmentOnce(seg, rec);
    } catch {
      // transcript fetch below still picks up whatever the server has
    }
  }
  const deadline = Date.now() + 60_000;
  let full = '';
  let transcribedSeqs = new Set<number>();
  for (;;) {
    const t = await fetchTranscript(recordingId);
    if (t) {
      full = (t.text || '').trim();
      transcribedSeqs = new Set((t.segments || []).filter((s) => s.status === 'transcribed').map((s) => s.seq));
      const open = (t.pending?.length || 0) + (t.missing?.length || 0);
      onProgress?.(open);
      if (open === 0 || Date.now() > deadline) break;
    }
    if (Date.now() > deadline) break;
    await sleep(5_000);
  }
  for (const seq of transcribedSeqs) await deleteSegment(recordingId, seq);
  const remaining = await getSegments(recordingId);
  if (remaining.length === 0) {
    rec.done = true;
    await putRecording(rec);
  }
  return full;
};
