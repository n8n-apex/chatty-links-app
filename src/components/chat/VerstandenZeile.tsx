import { Verstanden } from "@/types/chat";

const TYP_TEXT: Record<string, string> = {
  question: "Als Rechtsfrage beantwortet.",
  analyze_pdf: "Als Behördenschreiben analysiert.",
  draft_statement: "Als Entwurf einer Stellungnahme bearbeitet.",
  upload_source: "Als Unterlage abgelegt.",
};

const ALT_LABEL: Record<string, string> = {
  question: "Stattdessen als Rechtsfrage beantworten",
  analyze_pdf: "Stattdessen als Behördenschreiben analysieren",
  draft_statement: "Stattdessen als Stellungnahme entwerfen",
  upload_source: "Stattdessen nur als Unterlage ablegen",
};

interface VerstandenZeileProps {
  verstanden?: Verstanden | null;
  /** Resend the same text with force_action + rerun_of. */
  onCorrect?: (alternative: string, rerunOf?: string) => void;
  disabled?: boolean;
}

/**
 * One quiet line above the answer stating what the router understood, plus
 * one-click correction. Renders nothing when the backend sent no `verstanden`
 * (older messages must never break).
 */
export const VerstandenZeile = ({ verstanden, onCorrect, disabled }: VerstandenZeileProps) => {
  if (!verstanden || typeof verstanden !== "object") return null;
  const typ = typeof verstanden.typ === "string" ? verstanden.typ : "";
  const label = TYP_TEXT[typ];
  if (!label) return null;

  // The user already corrected this turn — state it, offer no further switches.
  const forced = verstanden.grund === "erzwungen";
  const alternativen = !forced && Array.isArray(verstanden.alternativen)
    ? verstanden.alternativen.filter((a): a is string => typeof a === "string" && !!TYP_TEXT[a] && a !== typ)
    : [];

  return (
    <div className="mb-1 flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground">
        {label}
      </span>
      {alternativen.map((alt) => (
        <button
          key={alt}
          type="button"
          disabled={disabled || !onCorrect}
          onClick={() => onCorrect?.(alt, verstanden.client_turn_id)}
          className="inline-flex items-center rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {ALT_LABEL[alt]}
        </button>
      ))}
    </div>
  );
};
