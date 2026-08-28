import { toStringList } from '@/lib/safeText';

/**
 * Provisions the backend judged legally relevant but could NOT tie to a
 * retrieved source. Always visible, never badged as verified, never collapsed.
 */
export const UnverifizierteNormen = ({ value }: { value: unknown }) => {
  const items = toStringList(value);
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Nicht in den abgerufenen Quellen belegt
      </div>
      <p className="text-[11px] italic leading-snug text-muted-foreground">
        Diese Normen sind rechtlich einschlägig, konnten aber nicht gegen einen abgerufenen
        Gesetzestext geprüft werden. Bitte im geltenden Gesetz nachschlagen, bevor Sie sie zitieren.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((r, i) => (
          <span
            key={i}
            className="inline-block max-w-full whitespace-normal break-words rounded-md border border-dashed border-border bg-muted/20 px-2 py-1 text-left align-top text-[11px] italic leading-snug text-muted-foreground"
          >
            {r}
          </span>
        ))}
      </div>
    </div>
  );
};
