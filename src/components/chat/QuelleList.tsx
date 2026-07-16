import { cn } from '@/lib/utils';
import { ExternalLink } from 'lucide-react';

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
  [key: string]: unknown;
}

const labelFor = (q: string | Quelle): string => {
  if (typeof q === 'string') return q.trim();
  if (q.display && q.display.trim()) return q.display.trim();
  // Fallback: structured citation paragraph · source_file · state
  return [q.paragraph, q.source_file || q.file, q.state]
    .filter(Boolean)
    .join(' · ');
};

interface QuelleListProps {
  quellen?: Array<string | Quelle> | string | null;
  className?: string;
  variant?: 'stacked' | 'inline';
}

export const QuelleList = ({ quellen, className, variant = 'stacked' }: QuelleListProps) => {
  const arr: Array<string | Quelle> = Array.isArray(quellen)
    ? quellen
    : typeof quellen === 'string' && quellen.trim()
    ? [quellen]
    : [];

  const seen = new Set<string>();
  const items: Array<{ label: string; url: string | null }> = [];
  for (const q of arr) {
    if (typeof q !== 'string' && q && q.validated === false) continue;
    const label = labelFor(q);
    if (!label) continue;
    if (seen.has(label)) continue;
    seen.add(label);
    const url = typeof q !== 'string' ? (q.source_url ?? null) : null;
    items.push({ label, url });
  }

  if (items.length === 0) return null;

  return (
    <div
      className={cn(
        variant === 'inline' ? 'flex flex-wrap gap-1.5' : 'flex flex-col gap-1.5',
        className,
      )}
    >
      {items.map((item, i) => (
        <span
          key={i}
          className="inline-flex items-start self-start rounded-md border border-border bg-muted/40 px-2.5 py-1 text-[11px] leading-snug text-foreground"
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
            item.label
          )}
        </span>
      ))}
    </div>
  );
};
