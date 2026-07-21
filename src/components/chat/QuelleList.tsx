import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ExternalLink, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

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
}

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

export const QuelleList = ({ quellen, className, variant = 'stacked' }: QuelleListProps) => {
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

  if (items.length === 0) return null;

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

  return (
    <>
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
                'inline-flex items-start self-start rounded-md border border-border bg-muted/40 px-2.5 py-1 text-[11px] leading-snug text-foreground transition-colors',
                clickable &&
                  'cursor-pointer hover:bg-muted hover:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary',
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
            </span>
          );
        })}
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
