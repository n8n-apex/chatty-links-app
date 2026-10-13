import { useId, useState } from "react";
import { BookOpen, Search, Scale, Globe, RefreshCw, Pencil, Loader2, ChevronDown, ChevronRight, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface Arbeitsschritt {
  nr?: number;
  art?: string;
  titel: string;
  warum?: string | null;
  ergebnis?: string | null;
  laeuft?: boolean;
  durchgang?: string;
}

export interface Arbeitsbericht {
  schritte?: unknown;
  anzahl?: number;
  quellen?: number;
  sekunden?: number;
}

export const readArbeitsschritte = (value: unknown): Arbeitsschritt[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((step): step is Arbeitsschritt =>
    step !== null && typeof step === "object" && typeof step.titel === "string",
  );
};

const icons: Record<string, typeof BookOpen> = {
  read_section: BookOpen, read_case_material: BookOpen,
  search_law: Search, search_case_law: Search, find_in_text: Search,
  read_decision: Scale, web_research: Globe,
  refresh_official_text: RefreshCw, update_case_file: Pencil,
};

export const Arbeitsschritte = ({ steps }: { steps: Arbeitsschritt[] }) => {
  const research = steps.filter((step) => step.durchgang !== "Überarbeitung");
  const revisions = steps.filter((step) => step.durchgang === "Überarbeitung");
  const rows = (items: Arbeitsschritt[]) => items.map((step, index) => {
    const Icon = icons[step.art ?? ""] ?? ListChecks;
    return (
      <li key={`${step.nr ?? index}-${step.art ?? ""}`} className="flex min-w-0 gap-2 py-2">
        <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 break-words">
          <div className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1">
            <span className="min-w-0 text-sm text-foreground">{step.titel}</span>
            {step.laeuft === true ? (
              <Loader2 role="status" aria-label="Schritt läuft" className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none text-muted-foreground" />
            ) : typeof step.ergebnis === "string" && step.ergebnis && (
              <span className="min-w-0 break-words text-xs text-muted-foreground">{step.ergebnis}</span>
            )}
          </div>
          {typeof step.warum === "string" && step.warum && (
            <p className="mt-1 break-words text-xs text-muted-foreground">Warum: {step.warum}</p>
          )}
        </div>
      </li>
    );
  });
  return (
    <div className="min-w-0 px-2">
      <ol className="min-w-0">{rows(research)}</ol>
      {revisions.length > 0 && <>
        <div className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">Überarbeitung nach der Prüfung</div>
        <ol className="min-w-0">{rows(revisions)}</ol>
      </>}
    </div>
  );
};

export const RechercheBlock = ({ report }: { report?: Arbeitsbericht }) => {
  const [open, setOpen] = useState(false);
  const id = useId();
  const steps = readArbeitsschritte(report?.schritte);
  if (steps.length === 0) return null;
  const parts = ["Recherche und Prüfung"];
  const count = typeof report?.anzahl === "number" ? report.anzahl : steps.length;
  if (count > 0) parts.push(`${count} ${count === 1 ? "Schritt" : "Schritte"}`);
  if (typeof report?.quellen === "number" && report.quellen > 0) parts.push(`${report.quellen} ${report.quellen === 1 ? "Quelle" : "Quellen"}`);
  if (typeof report?.sekunden === "number" && report.sekunden > 0) parts.push(`${report.sekunden} s`);
  return (
    <div className="w-full min-w-0">
      <Button variant="ghost" size="sm" className="h-auto w-full justify-start whitespace-normal px-2 py-2 text-left text-xs text-muted-foreground" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
        <span className="min-w-0 break-words">{parts.join(" · ")}</span>
      </Button>
      {open && <div id={id}><Arbeitsschritte steps={steps} /></div>}
    </div>
  );
};