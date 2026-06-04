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
  if (typeof q === 'string') return q;
  if (q.display && q.display.trim()) return q.display.trim();
  return [q.paragraph, q.source_file || q.file, q.state, q.document_type || q.type]
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

  // Filter validated === false, build labels, dedupe by label
  const seen = new Set<string>();
  const items: string[] = [];
  for (const q of arr) {
    if (typeof q !== 'string' && q && q.validated === false) continue;
    const label = labelFor(q);
    if (!label) continue;
    if (seen.has(label)) continue;
    seen.add(label);
    items.push(label);
  }

  if (items.length === 0) return null;

  return (
    <div
      className={cn(
        variant === 'inline' ? 'flex flex-wrap gap-1.5' : 'flex flex-col gap-1.5',
        className,
      )}
    >
      {items.map((label, i) => (
        <span
          key={i}
          className="inline-flex items-start self-start rounded-md border border-border bg-muted/40 px-2.5 py-1 text-[11px] leading-snug text-foreground"
        >
          {label}
        </span>
      ))}
    </div>
  );
};
