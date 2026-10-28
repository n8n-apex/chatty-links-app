/**
 * Overlap handling at a forced dictation cut. Both segments share ~2 s of
 * audio, but each edge is cut mid-word, so the shared words sit between
 * fragments. We find the longest run (>= 2 words) present in the last 15
 * words of the earlier text AND the first 15 words of the next text.
 */

const WINDOW = 15;
const normWord = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

export interface OverlapRun {
  /** index in prev words where the run starts */
  prevStart: number;
  /** index in next words where the run starts */
  nextStart: number;
  length: number;
}

export const findOverlapRun = (prev: string, next: string): OverlapRun | null => {
  const p = words(prev);
  const n = words(next);
  const pOff = Math.max(0, p.length - WINDOW);
  const pt = p.slice(pOff).map(normWord);
  const nt = n.slice(0, WINDOW).map(normWord);
  let best: OverlapRun | null = null;
  for (let i = 0; i < pt.length; i++) {
    for (let j = 0; j < nt.length; j++) {
      let k = 0;
      while (i + k < pt.length && j + k < nt.length && pt[i + k] && pt[i + k] === nt[j + k]) k++;
      if (k < 2) continue;
      // longer wins; equal length: the one nearer the end of prev
      if (!best || k > best.length || (k === best.length && pOff + i > best.prevStart)) {
        best = { prevStart: pOff + i, nextStart: j, length: k };
      }
    }
  }
  return best;
};

/** Split at the run: prev up to the run, next from the run on. No run: unchanged. */
export const joinOverlap = (prev: string, next: string): { prev: string; next: string } => {
  const run = findOverlapRun(prev, next);
  if (!run) return { prev: prev.trim(), next: next.trim() };
  return {
    prev: words(prev).slice(0, run.prevStart).join(' '),
    next: words(next).slice(run.nextStart).join(' '),
  };
};

/**
 * Put `next` into the box. If the box still ends with `inserted` (the earlier
 * text this recording put there), rejoin at the run start. If the user typed
 * after it, leave the box as it is and append next from the end of the run.
 */
export const mergeIntoBox = (box: string, inserted: string, next: string): string => {
  const run = findOverlapRun(inserted, next);
  const sep = (a: string, b: string) => (!a ? b : !b ? a : `${a} ${b}`);
  if (!run) return sep(box.trimEnd(), next.trim());
  const ins = inserted.trim();
  const b = box.trimEnd();
  if (ins && b.endsWith(ins)) {
    const head = b.slice(0, b.length - ins.length).trimEnd();
    const j = joinOverlap(ins, next);
    return sep(sep(head, j.prev), j.next);
  }
  return sep(b, words(next).slice(run.nextStart + run.length).join(' '));
};
