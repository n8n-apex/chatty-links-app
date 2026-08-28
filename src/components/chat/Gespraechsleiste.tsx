import { VerstandenZustand } from "@/types/chat";

interface GespraechsleisteProps {
  zustand?: VerstandenZustand | null;
}

/**
 * Thin strip above the composer: what the conversation currently holds, straight
 * from the router's own `verstanden.zustand`. Renders nothing when empty.
 */
export const Gespraechsleiste = ({ zustand }: GespraechsleisteProps) => {
  if (!zustand || typeof zustand !== "object") return null;

  const chips: string[] = [];
  if (typeof zustand.subject_file === "string" && zustand.subject_file.trim()) {
    chips.push(`Schreiben: ${zustand.subject_file.trim()}`);
  }
  if (zustand.has_draft === true) {
    chips.push(zustand.draft_is_stale === true ? "Entwurf vorhanden (veraltet)" : "Entwurf vorhanden");
  }
  const count = typeof zustand.source_count === "number" ? zustand.source_count : 0;
  if (count > 0) chips.push(`${count} Unterlagen`);

  if (chips.length === 0) return null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-1.5 px-4 pt-2">
      {chips.map((c) => (
        <span
          key={c}
          className="inline-flex items-center rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground"
        >
          {c}
        </span>
      ))}
    </div>
  );
};
