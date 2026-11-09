import { expect, test, spyOn } from 'bun:test';
import 'fake-indexeddb/auto';
import { DictationRecorder, findUnfinishedRecording } from './dictation';

interface RecorderInternals {
  rec: { recording_id: string; startedAt: number; session_id: string; user_email: string; mime: string; nextSeq: number; stopped: boolean; done: boolean };
  stopping: boolean;
  pendingTexts: Set<number>;
  texts: Map<number, string>;
  live: number;
  finishingSegments: number;
  beginStopWait: () => void;
  startTranscriptPolling: () => void;
  finishAll: () => void;
  deadlineTimer: number | null;
  pollTimer: number | null;
}

test('five-minute polling deadline releases received text in order, marks missing failed and exits converting once', async () => {
  const callbacks: { fn: () => void; ms: number }[] = [];
  const oldWindow = globalThis.window;
  Object.assign(globalThis, { window: globalThis });
  const timer = spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms: number) => {
    callbacks.push({ fn, ms });
    return callbacks.length;
  }) as typeof setTimeout);
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => {}));
  const texts: string[] = [];
  let failed = 0;
  let status = 'converting';
  let completions = 0;
  const recorder = new DictationRecorder({ sessionId: 'test', userEmail: '', events: {
    onText: (_seq, text) => texts.push(text),
    onPendingChange: () => {},
    onFailedChange: n => { failed = n; },
    onAllDone: () => { status = 'idle'; completions++; },
  } });
  const r = recorder as unknown as RecorderInternals;
  r.rec = { recording_id: crypto.randomUUID(), startedAt: Date.now(), session_id: 'test', user_email: '', mime: 'audio/webm', nextSeq: 3, stopped: true, done: false };
  r.stopping = true;
  r.pendingTexts = new Set([0]);
  r.texts = new Map([[2, 'letzte Worte'], [1, 'empfangener Anfang']]);
  try {
    r.startTranscriptPolling();
    const deadline = callbacks.find(c => c.ms === 5 * 60_000);
    expect(deadline).toBeDefined();
    expect(status).toBe('converting');
    deadline?.fn();
    expect(status).toBe('idle');
    expect(failed).toBe(1);
    expect(texts).toEqual(['empfangener Anfang', 'letzte Worte']);
    r.finishAll();
    expect(completions).toBe(1);
    expect(r.rec.done).toBe(false);
    await new Promise<void>(resolve => setImmediate(resolve));
    const unfinished = await findUnfinishedRecording();
    expect(unfinished?.recording_id).toBe(r.rec.recording_id);
  } finally {
    timer.mockRestore();
    fetchMock.mockRestore();
    Object.assign(globalThis, { window: oldWindow });
  }
});

test('stop completion waits for live overlap recorders and final local writes', () => {
  let done = 0;
  const recorder = new DictationRecorder({ sessionId: '', userEmail: '', events: {
    onText: () => {}, onPendingChange: () => {}, onFailedChange: () => {}, onAllDone: () => { done++; },
  } });
  const r = recorder as unknown as RecorderInternals;
  r.live = 1;
  r.beginStopWait();
  expect(done).toBe(0);
  r.live = 0;
  r.finishingSegments = 1;
  r.beginStopWait();
  expect(done).toBe(0);
  r.finishingSegments = 0;
  r.beginStopWait();
  r.beginStopWait();
  expect(done).toBe(1);
});