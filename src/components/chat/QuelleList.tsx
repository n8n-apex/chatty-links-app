import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { ExternalLink, Loader2, Copy, ChevronDown, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { copyPlainText, UNVERIFIED_SUFFIX } from '@/lib/copyText';
import { toStringList } from '@/lib/safeText';


export interface Quelle {
  paragraph?: string;
  source_file?: string;
  file?: string;
  state?: string;
  document_type?: string;
  type?: string;
  chunk_id?: string | null;
  drive_file_id?: string | null;
  source_url?: string | null;
  display?: string;
  validated?: boolean;
  article_ref?: string;
  [key: string]: unknown;
}

const labelFor = (q: string | Quelle): string => {
  if (typeof q === 'string') return q.trim();
  if (q.display && q.display.trim()) return q.display.trim();
  return [q.paragraph, q.source_file || q.file, q.state]
    .filter(Boolean)
    .join(' · ');
};

interface QuelleListProps {
  quellen?: Array<string | Quelle> | string | null;
  className?: string;
  variant?: 'stacked' | 'inline';
  /** Provisions without a retrieved source — appended to "Alle Quellen kopieren". */
  unverifiziert?: unknown;
  /** Court decisions cited by the answer, for the count in the closed row. */
  decisions?: Array<{ status?: unknown }> | null;
}

/** Open/closed per answer, kept only while the page is open. */
const openState = new Map<string, boolean>();
/** Identity of the answer (turn_id, else message id) that owns this list. */
export const AnswerKeyContext = createContext<string>('');
export const CITE_EVENT = 'lawgpt-cite';


interface ChunkResponse {
  ok?: boolean;
  article_ref?: string;
  source_file?: string;
  state?: string;
  full_text?: string;
  incomplete?: boolean;
  parts_returned?: number;
  parts_expected?: number;
  error?: string;
}

interface ModalState {
  open: boolean;
  loading: boolean;
  data: ChunkResponse | null;
  error: boolean;
  fallbackLabel: string;
}

export const QuelleList = ({ quellen, className, variant = 'stacked', unverifiziert, decisions }: QuelleListProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const answerKey = useContext(AnswerKeyContext);
  const keyRef = useRef<string>('');
  const [open, setOpenState] = useState(false);
  const [flash, setFlash] = useState<number | null>(null);
  const setOpen = (o: boolean) => { openState.set(keyRef.current, o); setOpenState(o); };
  const [modal, setModal] = useState<ModalState>({
    open: false,
    loading: false,
    data: null,
    error: false,
    fallbackLabel: '',
  });
  const [loadingChunkId, setLoadingChunkId] = useState<string | null>(null);

  const arr: Array<string | Quelle> = Array.isArray(quellen)
    ? quellen
    : typeof quellen === 'string' && quellen.trim()
    ? [quellen]
    : [];

  const seen = new Set<string>();
  const items: Array<{ label: string; url: string | null; chunk_id: string | null; source: string | Quelle }> = [];
  for (const q of arr) {
    if (typeof q !== 'string' && q && q.validated === false) continue;
    const label = labelFor(q);
    if (!label) continue;
    if (seen.has(label)) continue;
    seen.add(label);
    const url = typeof q !== 'string' ? (q.source_url ?? null) : null;
    const chunk_id = typeof q !== 'string' ? (q.chunk_id ?? null) : null;
    items.push({ label, url, chunk_id, source: q });
  }

  // One answer can hold more than one list (e.g. analysis + answer); the index keeps them apart.
  keyRef.current = answerKey ? `${answerKey}#${variant}` : `anon:${items.map((i) => i.label).join('|')}`;
  useEffect(() => {
    if (openState.get(keyRef.current)) setOpenState(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyRef.current]);

  useEffect(() => {
    const host = rootRef.current?.closest('.group') ?? rootRef.current?.parentElement;
    if (!host) return;
    const onCite = (e: Event) => {
      const n = (e as CustomEvent<number>).detail;
      if (!n || n < 1 || n > items.length) return;
      e.stopPropagation();
      openState.set(keyRef.current, true);
      setOpenState(true);
      setFlash(n);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        rootRef.current?.querySelector(`[data-quelle="${n}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }));
      window.setTimeout(() => setFlash((f) => (f === n ? null : f)), 2000);
      const it = items[n - 1];
      if (it?.url) window.open(it.url, '_blank', 'noopener,noreferrer');
      else if (it?.chunk_id) openChunk(it.chunk_id, it.label);
    };
    host.addEventListener(CITE_EVENT, onCite);
    return () => host.removeEventListener(CITE_EVENT, onCite);
  });

  if (items.length === 0) return null;
  const decList = Array.isArray(decisions) ? decisions : [];
  const decAllVerified = decList.length > 0 && decList.every((d) => d?.status === 'verified');

  const openChunk = async (chunkId: string, label: string) => {
    if (loadingChunkId) return;
    setLoadingChunkId(chunkId);
    const sessionId =
      (typeof window !== 'undefined' && localStorage.getItem('chat-session-id')) || '';
    try {
      const { data, error } = await supabase.functions.invoke('chat-proxy', {
        body: { action: 'get_chunk', chunk_id: chunkId, sessionId },
      });
      if (error || !data || (data as ChunkResponse).ok === false) {
        setModal({ open: true, loading: false, data: null, error: true, fallbackLabel: label });
      } else {
        setModal({
          open: true,
          loading: false,
          data: data as ChunkResponse,
          error: false,
          fallbackLabel: label,
        });
      }
    } catch {
      setModal({ open: true, loading: false, data: null, error: true, fallbackLabel: label });
    } finally {
      setLoadingChunkId(null);
    }
  };

  const modalData = modal.data;
  const header = modalData
    ? [modalData.article_ref, modalData.source_file, modalData.state].filter(Boolean).join(' · ') ||
      modal.fallbackLabel
    : modal.fallbackLabel;
  const paragraphs = modalData?.full_text
    ? modalData.full_text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean)
    : [];

  const unverifiedList = toStringList(unverifiziert);
  const copyAllText = [
    ...items.map((it) => it.label),
    ...unverifiedList.map((u) => `${u}${UNVERIFIED_SUFFIX}`),
  ].join('\n');

  return (
    <>
      <div ref={rootRef} className="flex min-w-0 max-w-full flex-col gap-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="inline-flex w-fit max-w-full flex-wrap items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <span>Quellen ({items.length})</span>
        {decList.length > 0 && (
          <span className={cn(
            'inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
            decAllVerified
              ? 'border-green-600/40 bg-green-600/10 text-green-700 dark:text-green-400'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
          )}>
            {decList.length} {decList.length === 1 ? 'Entscheidung' : 'Entscheidungen'}
          </span>
        )}
      </button>
      {open && <>
      <div
        className={cn(
          variant === 'inline' ? 'flex flex-wrap gap-1.5' : 'flex flex-col gap-1.5',
          className,
        )}
      >
        {items.map((item, i) => {
          const isLoading = loadingChunkId === item.chunk_id && item.chunk_id;
          const clickable = !!item.chunk_id && !item.url;
          return (
            <span
              key={i}
              data-quelle={i + 1}
              onClick={
                clickable
                  ? (e) => {
                      e.stopPropagation();
                      if (item.chunk_id) openChunk(item.chunk_id, item.label);
                    }
                  : undefined
              }
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              onKeyDown={
                clickable
                  ? (e) => {
                      if ((e.key === 'Enter' || e.key === ' ') && item.chunk_id) {
                        e.preventDefault();
                        openChunk(item.chunk_id, item.label);
                      }
                    }
                  : undefined
              }
              className={cn(
                'inline-flex max-w-full items-start self-start whitespace-normal break-words rounded-md border border-border bg-muted/40 px-2.5 py-1 text-[11px] leading-snug text-foreground transition-colors',
                clickable &&
                  'cursor-pointer hover:bg-muted hover:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary',
                flash === i + 1 && 'border-primary ring-2 ring-primary/60 bg-primary/10',
              )}
              title={clickable ? 'Quellentext anzeigen' : undefined}
            >
              {item.url ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {item.label}
                  <ExternalLink className="h-2.5 w-2.5 opacity-70" />
                </a>
              ) : (
                <span className="inline-flex items-center gap-1">
                  {item.label}
                  {isLoading && <Loader2 className="h-3 w-3 animate-spin opacity-70" />}
                </span>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  copyPlainText(item.label, 'Quelle kopiert');
                }}
                className="ml-1.5 shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Quellenangabe kopieren"
                aria-label="Quellenangabe kopieren"
              >
                <Copy className="h-2.5 w-2.5" />
              </button>
            </span>
          );
        })}
      </div>
      {copyAllText.trim() && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            copyPlainText(copyAllText, 'Alle Quellen kopiert');
          }}
          className="inline-flex w-fit items-center gap-1 rounded-md border border-border bg-background/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Copy className="h-3 w-3" />
          Alle Quellen kopieren
        </button>
      )}
      </>}
      </div>


      <Dialog
        open={modal.open}
        onOpenChange={(o) => {
          if (!o) setModal((m) => ({ ...m, open: false }));
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm font-medium">{header}</DialogTitle>
          </DialogHeader>
          {modal.error ? (
            <p className="text-sm text-muted-foreground">Quelle konnte nicht geladen werden.</p>
          ) : (
            <div className="space-y-3">
              {modalData?.incomplete && (
                <p className="text-xs text-muted-foreground italic">
                  Hinweis: {modalData.parts_returned ?? '?'} von {modalData.parts_expected ?? '?'} Textteilen gefunden.
                </p>
              )}
              {paragraphs.length > 0 ? (
                <div className="space-y-3 font-serif text-[15px] leading-relaxed text-foreground whitespace-pre-wrap">
                  {paragraphs.map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Kein Text verfügbar.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
