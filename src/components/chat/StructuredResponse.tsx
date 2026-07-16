import { useState } from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { ChevronDown, ChevronRight, FileText, Check, ExternalLink, Copy, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { QuelleList, parseDisplay } from './QuelleList';
import { BehoerdenAnalysis, type BehoerdenAnalysisData } from './BehoerdenAnalysis';

interface RechtsgrundlageItem {
  paragraph?: string;
  quelle?: string;
  [key: string]: unknown;
}

interface Rechtsprechung {
  display?: string;
  kernaussage?: string;
  gericht?: string;
  datum?: string;
  aktenzeichen?: string;
  entscheidungstyp?: string;
  herkunft?: string;
  fundstelle?: string | null;
  slug?: string;
  oldp_id?: number;
  verifiziert?: boolean;
  inhaltlich_geprueft?: boolean;
  grounding_status?: string | null;
  [key: string]: unknown;
}

interface ForderungAnalyse {
  forderung?: string;
  bewertung?: string;
  begruendung?: string;
  [key: string]: unknown;
}

export interface StructuredPayload {
  // B1/B2 - Rechtsfrage
  antwort?: string;
  rechtsgrundlage?: Array<string | RechtsgrundlageItem> | string;
  fehlende_informationen?: string | null;
  naechste_schritte?: string | string[] | null;
  wichtiger_hinweis?: string | null;
  quellen?: Array<string | { file?: string; source_file?: string; state?: string; type?: string; document_type?: string; paragraph?: string; display?: string; [key: string]: unknown }> | string;
  rechtsprechung?: Rechtsprechung[];
  konfidenz?: 'hoch' | 'mittel' | 'niedrig' | 'unzureichend' | string;
  action?: string;
  // B4 - Behördenschreiben Analyse
  zusammenfassung?: string;
  gesamtbeurteilung?: string;
  analyse_der_forderungen?: ForderungAnalyse[];
  antwortschreiben_entwurf?: string;
  // B6 - Stellungnahme
  sachverhalt?: string;
  kernargumente?: Array<string | { punkt?: string; argument?: string; rechtsgrundlage?: string; [key: string]: unknown }>;
  ergebnis?: string;
  entwurf_stellungnahme?: string;
  // B6 - new structure
  projekt_und_sachverhalt?: string;
  rechtliche_beurteilungsgrundlage?: string;
  rechtliche_wuerdigung?: string;
  beurteilung_der_einzelfakten?: Array<string | { fakt?: string; beurteilung?: string; punkt?: string; argument?: string; rechtsgrundlage?: string; [key: string]: unknown }>;
  schlussfolgerung?: string;
  kontext_ausreichend?: boolean;
  fehlende_information?: string | null;
  needs_clarification?: boolean;
  rechtsgrundlage_unverifiziert?: string[];
  bundesland?: string;
  thema?: string;
  art?: string;
  rechtsprechung_grounding_disabled?: boolean;
}

// Small markdown wrapper for long text fields (paragraphs, lists, bold).
const Md = ({ children, className }: { children: string; className?: string }) => (
  <div className={cn('prose prose-sm max-w-none dark:prose-invert prose-p:my-1.5 prose-p:leading-relaxed prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-li:text-foreground prose-li:my-0.5 prose-ol:list-decimal prose-ul:list-disc', className)}>
    <ReactMarkdown
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0 whitespace-pre-line">{children}</p>,
        ul: ({ children }) => <ul className="mb-2 ml-4 list-disc last:mb-0">{children}</ul>,
        ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal last:mb-0">{children}</ol>,
        li: ({ children }) => <li className="mb-1">{children}</li>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">{children}</a>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  </div>
);


export const structuredToPlainText = (data: StructuredPayload): string => {
  const parts: string[] = [];

  const pushSection = (label: string, value?: string | null) => {
    const v = (value ?? '').toString().trim();
    if (v) parts.push(`${label}:\n${v}`);
  };

  // B1/B2
  if (data.antwort) parts.push(data.antwort.trim());

  // B6
  const b6Sachverhalt = data.projekt_und_sachverhalt || data.sachverhalt;
  const b6Beurteilungsgrundlage = data.rechtliche_beurteilungsgrundlage || data.rechtliche_wuerdigung;
  const b6Items = data.beurteilung_der_einzelfakten || data.kernargumente;
  const b6Schluss = data.schlussfolgerung || data.ergebnis;
  if (b6Sachverhalt) pushSection('1. Projekt und Sachverhalt', b6Sachverhalt);
  if (b6Beurteilungsgrundlage) pushSection('2. Rechtliche Beurteilungsgrundlage', b6Beurteilungsgrundlage);
  if (Array.isArray(b6Items) && b6Items.length > 0) {
    const lines = b6Items.map((k, i) => {
      if (typeof k === 'string') return `${i + 1}. ${k}`;
      const title = (k as { fakt?: string; punkt?: string }).fakt || (k as { punkt?: string }).punkt || '';
      const desc = (k as { beurteilung?: string; argument?: string }).beurteilung || (k as { argument?: string }).argument || '';
      const rg = (k as { rechtsgrundlage?: string }).rechtsgrundlage ? ` (${(k as { rechtsgrundlage?: string }).rechtsgrundlage})` : '';
      return `${i + 1}. ${title}${desc ? ` — ${desc}` : ''}${rg}`;
    });
    parts.push(`3. Beurteilung der Einzelfakten:\n${lines.join('\n')}`);
  }
  if (b6Schluss) pushSection('4. Schlussfolgerung', b6Schluss);
  if (data.entwurf_stellungnahme) pushSection('Entwurf Stellungnahme', data.entwurf_stellungnahme);

  // B4
  if (data.zusammenfassung) pushSection('Zusammenfassung', data.zusammenfassung);
  if (data.gesamtbeurteilung) pushSection('Gesamtbeurteilung', data.gesamtbeurteilung);
  if (Array.isArray(data.analyse_der_forderungen) && data.analyse_der_forderungen.length > 0) {
    const lines = data.analyse_der_forderungen.map((f, i) => {
      const forderung = f.forderung || '';
      const bewertung = f.bewertung ? ` [${f.bewertung}]` : '';
      const begr = f.begruendung ? `\n   Begründung: ${f.begruendung}` : '';
      return `${i + 1}. ${forderung}${bewertung}${begr}`;
    });
    parts.push(`Analyse der Forderungen:\n${lines.join('\n')}`);
  }
  if (data.antwortschreiben_entwurf) pushSection('Antwortschreiben (Entwurf)', data.antwortschreiben_entwurf);

  // Common extras
  if (data.fehlende_informationen) pushSection('Fehlende Informationen', data.fehlende_informationen);
  if (data.naechste_schritte) {
    const ns = Array.isArray(data.naechste_schritte)
      ? data.naechste_schritte.map((s, i) => `${i + 1}. ${s}`).join('\n')
      : data.naechste_schritte;
    pushSection('Nächste Schritte', ns);
  }
  if (data.wichtiger_hinweis) pushSection('Wichtiger Hinweis', data.wichtiger_hinweis);

  if (Array.isArray(data.rechtsgrundlage) && data.rechtsgrundlage.length > 0) {
    const lines = data.rechtsgrundlage.map((r) => {
      if (typeof r === 'string') return `- ${r}`.trim();
      const p = r.paragraph || '';
      const q = r.quelle ? ` (${r.quelle})` : '';
      return `- ${p}${q}`.trim();
    });
    parts.push(`Rechtsgrundlage:\n${lines.join('\n')}`);
  } else if (typeof data.rechtsgrundlage === 'string' && data.rechtsgrundlage.trim()) {
    pushSection('Rechtsgrundlage', data.rechtsgrundlage);
  }

  if (Array.isArray(data.quellen) && data.quellen.length > 0) {
    const lines = data.quellen.map((q) => {
      if (typeof q === 'string') return `- ${q}`;
      const file = q.file || '';
      const state = q.state ? ` (${q.state})` : '';
      return `- ${file}${state}`.trim();
    });
    parts.push(`Quellen:\n${lines.join('\n')}`);
  } else if (typeof data.quellen === 'string' && data.quellen.trim()) {
    pushSection('Quellen', data.quellen);
  }

  return parts.join('\n\n').trim();
};

export const tryParseStructured = (content: string): StructuredPayload | null => {
  if (!content || typeof content !== 'string') return null;
  const trimmed = content.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    const obj = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!obj || typeof obj !== 'object') return null;
    if (
      obj.antwort ||
      obj.zusammenfassung ||
      obj.entwurf_stellungnahme ||
      obj.projekt_und_sachverhalt ||
      obj.beurteilung_der_einzelfakten ||
      obj.schlussfolgerung ||
      obj.analyse_der_forderungen ||
      obj.antwortschreiben_entwurf ||
      obj.action === 'question' ||
      obj.action === 'analyze_pdf' ||
      obj.action === 'draft_statement'
    ) {
      return obj as StructuredPayload;
    }
    return null;
  } catch {
    return null;
  }
};

const getBeurteilungVariant = (text?: string): string => {
  if (!text) return 'bg-muted/50 text-muted-foreground border-border';
  const t = text.toLowerCase();
  if (t.includes('nicht begründet') || t.includes('unbegründet') || t.includes('abzulehnen')) {
    return 'bg-transparent text-red-500 border-red-500/40';
  }
  if (t.includes('begründet') || t.includes('zulässig')) {
    return 'bg-transparent text-green-600 border-green-600/40';
  }
  return 'bg-transparent text-yellow-600 border-yellow-600/40';
};

const containerVariants = {
  hidden: { opacity: 1 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.12,
      delayChildren: 0.05,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
};

const Section = ({ children }: { children: React.ReactNode }) => (
  <motion.div variants={itemVariants}>{children}</motion.div>
);

const ParagraphBadge = ({ paragraph, quelle }: { paragraph?: string; quelle?: string }) => {
  const [copied, setCopied] = useState(false);
  const fullRef = [paragraph, quelle].filter(Boolean).join(' — ');

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!fullRef) return;
    try {
      await navigator.clipboard.writeText(fullRef);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="group/badge relative inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-foreground transition-colors hover:bg-muted cursor-pointer"
      title={`Kopieren: ${fullRef}`}
    >
      <span className="font-medium">{paragraph}</span>
      {quelle && <span className="text-muted-foreground">· {quelle}</span>}
      {copied && (
        <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
          <Check className="h-2.5 w-2.5" />
          Kopiert!
        </span>
      )}
    </button>
  );
};

const Collapsible = ({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border bg-background/40">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-foreground hover:bg-muted/30 transition-colors"
      >
        <span className="flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          {title}
        </span>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2 text-xs leading-relaxed text-foreground whitespace-pre-wrap">
          {children}
        </div>
      )}
    </div>
  );
};

export interface DraftEditorProps {
  isEditing: boolean;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}

const DraftEditor = ({ value, onChange, onSave, onCancel, saving, error }: DraftEditorProps) => (
  <div className="flex flex-col gap-2">
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={12}
      disabled={saving}
      className="w-full min-h-[240px] resize-y rounded-md border border-border bg-background/60 p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
    />
    {error && <p className="text-xs text-destructive">{error}</p>}
    <div className="flex justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 disabled:opacity-50"
      >
        Abbrechen
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving || value.trim().length === 0}
        className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? 'Speichert…' : 'Speichern'}
      </button>
    </div>
  </div>
);

const DraftLetter = ({ text, editor }: { text: string; editor?: DraftEditorProps }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* noop */ }
  };
  if (editor?.isEditing) return <DraftEditor {...editor} />;
  return (
    <div className="relative rounded-lg border border-border bg-background p-5">
      <button
        type="button"
        onClick={copy}
        className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-border bg-background/80 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="Entwurf kopieren"
      >
        {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
        {copied ? 'Kopiert' : 'Kopieren'}
      </button>
      <div className="font-serif">
        <Md>{text}</Md>
      </div>
    </div>
  );
};

export const StructuredResponse = ({ data, draftEditor }: { data: StructuredPayload; draftEditor?: DraftEditorProps }) => {
  // Clarification path — no sources, question in `antwort`, missing info list.
  if (data.needs_clarification === true) {
    const missing = typeof data.fehlende_informationen === 'string' ? data.fehlende_informationen.trim() : '';
    const missingItems = missing ? missing.split(',').map((s) => s.trim()).filter(Boolean) : [];
    return (
      <motion.div className="flex flex-col gap-3" variants={containerVariants} initial="hidden" animate="show">
        {data.antwort && (
          <Section>
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-yellow-600">
                <AlertCircle className="h-3.5 w-3.5" />
                Rückfrage
              </div>
              <div className="text-sm text-foreground"><Md>{data.antwort}</Md></div>
            </div>
          </Section>
        )}
        {missingItems.length > 0 && (
          <Section>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Benötigte Angaben</div>
            <ul className="ml-4 list-disc space-y-0.5 text-sm text-foreground">
              {missingItems.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          </Section>
        )}
      </motion.div>
    );
  }

  // B4 — Behördenschreiben analysis (full structured view)
  const isB4 =
    data.action === 'analyze_pdf' ||
    !!(data as BehoerdenAnalysisData).analyse_der_forderungen ||
    !!(data as BehoerdenAnalysisData).antwortschreiben_entwurf ||
    !!(data as BehoerdenAnalysisData).gesamtbeurteilung;
  if (isB4) {
    return <BehoerdenAnalysis data={data as BehoerdenAnalysisData} />;
  }

  const b6Sachverhalt = data.projekt_und_sachverhalt || data.sachverhalt;
  const b6Beurteilungsgrundlage = data.rechtliche_beurteilungsgrundlage || data.rechtliche_wuerdigung;
  const b6Items = (data.beurteilung_der_einzelfakten || data.kernargumente) as
    | Array<string | { fakt?: string; beurteilung?: string; punkt?: string; argument?: string; rechtsgrundlage?: string }>
    | undefined;
  const b6Schluss = data.schlussfolgerung || data.ergebnis;

  const hasB6Items = Array.isArray(b6Items) && b6Items.length > 0;
  const hasB6Schluss = !!(b6Schluss && String(b6Schluss).trim());
  const hasEntwurfStellung = !!(data.entwurf_stellungnahme && String(data.entwurf_stellungnahme).trim());
  const hasAnalyseForderungen = Array.isArray(data.analyse_der_forderungen) && data.analyse_der_forderungen.length > 0;
  const hasAntwortEntwurf = !!(data.antwortschreiben_entwurf && String(data.antwortschreiben_entwurf).trim());
  const hasGesamtbeurteilung = !!(data.gesamtbeurteilung && String(data.gesamtbeurteilung).trim());

  // B6 - Stellungnahme
  if (hasEntwurfStellung || hasB6Items || hasB6Schluss) {
    return (
      <motion.div className="flex flex-col gap-3" variants={containerVariants} initial="hidden" animate="show">
        {(data.thema || data.art || data.bundesland) && (
          <Section>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {data.art && <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-muted-foreground">{data.art}</span>}
              {data.thema && <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-foreground">{data.thema}</span>}
              {data.bundesland && <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-muted-foreground">{data.bundesland}</span>}
            </div>
          </Section>
        )}
        {b6Sachverhalt && (
          <Section>
            <div className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">1. Projekt und Sachverhalt</div>
            <Md>{b6Sachverhalt}</Md>
          </Section>
        )}
        {b6Beurteilungsgrundlage && (
          <Section>
            <div className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">2. Rechtliche Beurteilungsgrundlage</div>
            <Md>{b6Beurteilungsgrundlage}</Md>
          </Section>
        )}
        {hasB6Items && (
          <Section>
            <div className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">3. Beurteilung der Einzelfakten</div>
            <ol className="ml-4 list-decimal space-y-2 text-sm text-foreground">
              {b6Items!.map((arg, i) => {
                if (typeof arg === 'string') return <li key={i} className="leading-relaxed">{arg}</li>;
                const title = arg.fakt || arg.punkt;
                const desc = arg.beurteilung || arg.argument;
                return (
                  <li key={i} className="leading-relaxed">
                    {title && <div className="font-medium">{title}</div>}
                    {desc && <div className="text-muted-foreground"><Md>{desc}</Md></div>}
                    {arg.rechtsgrundlage && <div className="mt-1 text-xs text-primary">{arg.rechtsgrundlage}</div>}
                  </li>
                );
              })}
            </ol>
          </Section>
        )}
        {b6Schluss && (
          <Section>
            <div className="border-l-2 border-border pl-3 py-1">
              <div className="mb-0.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">4. Schlussfolgerung</div>
              <Md>{b6Schluss}</Md>
            </div>
          </Section>
        )}
        {data.entwurf_stellungnahme && (
          <Section>
            <div className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Entwurf Stellungnahme</div>
            <DraftLetter text={data.entwurf_stellungnahme} editor={draftEditor} />
          </Section>
        )}
        {data.fehlende_information && (
          <Section>
            <div className="border-l-2 border-yellow-500/40 pl-3 py-1">
              <div className="mb-0.5 text-xs font-semibold text-yellow-600 uppercase tracking-wide">⚠️ Fehlende Information</div>
              <div className="text-sm text-foreground">{data.fehlende_information}</div>
            </div>
          </Section>
        )}
        <Section>{renderRechtsfrageExtras(data)}</Section>
      </motion.div>
    );
  }


  // B4 - Behördenschreiben Analyse: only enter if there's actual B4 content beyond zusammenfassung
  if (hasAnalyseForderungen || hasAntwortEntwurf || hasGesamtbeurteilung) {
    return (
      <motion.div className="flex flex-col gap-3" variants={containerVariants} initial="hidden" animate="show">
        {data.zusammenfassung && (
          <Section>
            <p className="text-sm leading-relaxed text-foreground">{data.zusammenfassung}</p>
          </Section>
        )}
        {data.gesamtbeurteilung && (
          <Section>
            <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium', getBeurteilungVariant(data.gesamtbeurteilung))}>
              {data.gesamtbeurteilung}
            </span>
          </Section>
        )}
        {Array.isArray(data.analyse_der_forderungen) && data.analyse_der_forderungen.length > 0 && (
          <Section>
            <div className="flex flex-col gap-2">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Analyse der Forderungen</div>
              {data.analyse_der_forderungen.map((f, i) => (
                <div key={i} className="rounded-lg border border-border bg-transparent p-3">
                  {f.forderung && <div className="mb-1 text-sm font-medium text-foreground">{f.forderung}</div>}
                  {f.bewertung && (
                    <span className={cn('mb-1.5 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium', getBeurteilungVariant(f.bewertung))}>
                      {f.bewertung}
                    </span>
                  )}
                  {f.begruendung && <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{f.begruendung}</p>}
                </div>
              ))}
            </div>
          </Section>
        )}
        {data.antwortschreiben_entwurf && (
          <Section>
            <Collapsible title="Antwortschreiben Entwurf">{data.antwortschreiben_entwurf}</Collapsible>
          </Section>
        )}
        <Section>{renderCommonExtras(data)}</Section>
      </motion.div>
    );
  }

  // Plain fallback: only a sachverhalt or zusammenfassung text, no other structured content
  if (!data.antwort && (data.sachverhalt || data.zusammenfassung)) {
    return (
      <motion.div className="flex flex-col gap-3" variants={containerVariants} initial="hidden" animate="show">
        <Section>
          <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
            {data.sachverhalt || data.zusammenfassung}
          </p>
        </Section>
        <Section>{renderCommonExtras(data)}</Section>
      </motion.div>
    );
  }

  // B1/B2 - Rechtsfrage (default with antwort)
  return (
    <motion.div className="flex flex-col gap-3" variants={containerVariants} initial="hidden" animate="show">
      {data.antwort && (
        <Section>
          <div className="text-sm text-foreground"><Md>{data.antwort}</Md></div>
        </Section>
      )}
      {/* Rechtsgrundlage, Quellen und Rechtsprechung werden unten gerendert */}
      {data.fehlende_informationen && (
        <Section>
          <div className="border-l-2 border-border pl-3 py-1">
            <div className="mb-0.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">⚠️ Fehlende Informationen</div>
            <div className="text-sm text-foreground">{data.fehlende_informationen}</div>
          </div>
        </Section>
      )}
      {data.naechste_schritte && (
        <Section>
          <div className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Nächste Schritte</div>
          {Array.isArray(data.naechste_schritte) ? (
            <ol className="ml-4 list-decimal space-y-1 text-sm text-foreground">
              {data.naechste_schritte.map((s, i) => <li key={i} className="leading-relaxed">{s}</li>)}
            </ol>
          ) : (
            <ol className="ml-4 list-decimal text-sm text-foreground">
              <li className="leading-relaxed">{data.naechste_schritte}</li>
            </ol>
          )}
        </Section>
      )}
      {data.wichtiger_hinweis && (
        <Section>
          <div className="border-l-2 border-border pl-3 py-1">
            <div className="mb-0.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">ℹ️ Wichtiger Hinweis</div>
            <div className="text-sm text-foreground">{data.wichtiger_hinweis}</div>
          </div>
        </Section>
      )}
      <Section>{renderRechtsfrageExtras(data)}</Section>
    </motion.div>
  );
};

const konfidenzStyle = (k?: string): { dot: string; label: string } | null => {
  if (!k) return null;
  const v = k.toLowerCase();
  if (v === 'hoch') return { dot: 'bg-green-500', label: 'Konfidenz: hoch' };
  if (v === 'mittel') return { dot: 'bg-yellow-500', label: 'Konfidenz: mittel' };
  if (v === 'niedrig') return { dot: 'bg-red-500', label: 'Konfidenz: niedrig' };
  if (v === 'unzureichend') return { dot: 'bg-muted-foreground', label: 'Konfidenz: unzureichend' };
  return { dot: 'bg-muted-foreground', label: `Konfidenz: ${k}` };
};

const renderCommonExtras = (data: StructuredPayload) => {
  const konf = konfidenzStyle(data.konfidenz);

  // Build paragraph list (rechtsgrundlage takes precedence; else derive from quellen[].paragraph)
  let paragraphs: Array<{ paragraph?: string; quelle?: string }> = [];
  if (Array.isArray(data.rechtsgrundlage) && data.rechtsgrundlage.length > 0) {
    paragraphs = data.rechtsgrundlage.map((r) =>
      typeof r === 'string' ? { paragraph: r } : { paragraph: r.paragraph, quelle: r.quelle as string | undefined },
    );
  } else if (typeof data.rechtsgrundlage === 'string' && data.rechtsgrundlage.trim()) {
    paragraphs = [{ paragraph: data.rechtsgrundlage }];
  } else if (Array.isArray(data.quellen)) {
    const seen = new Set<string>();
    for (const q of data.quellen) {
      if (typeof q === 'string') continue;
      if ((q as { validated?: boolean }).validated === false) continue;
      const p = q.paragraph;
      if (!p || seen.has(p)) continue;
      seen.add(p);
      paragraphs.push({ paragraph: p });
    }
  }
  // Dedupe paragraphs
  const seenP = new Set<string>();
  paragraphs = paragraphs.filter((p) => {
    const key = `${p.paragraph || ''}|${p.quelle || ''}`;
    if (!p.paragraph || seenP.has(key)) return false;
    seenP.add(key);
    return true;
  });

  const quellenArr = Array.isArray(data.quellen)
    ? data.quellen
    : typeof data.quellen === 'string' && data.quellen
    ? [data.quellen]
    : [];
  const visibleQuellen = quellenArr.filter(
    (q) => typeof q === 'string' || (q as { validated?: boolean }).validated !== false,
  );

  if (paragraphs.length === 0 && visibleQuellen.length === 0 && !konf) return null;

  return (
    <div className="mt-1 flex flex-col gap-3 border-t border-border pt-2">
      {(paragraphs.length > 0 || visibleQuellen.length > 0) && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Rechtsgrundlage</div>
          {paragraphs.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {paragraphs.map((p, i) => (
                <ParagraphBadge key={i} paragraph={p.paragraph} quelle={p.quelle} />
              ))}
            </div>
          )}
          {visibleQuellen.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Quellen</div>
              <QuelleList quellen={data.quellen as Parameters<typeof QuelleList>[0]['quellen']} />
            </div>
          )}
        </div>
      )}
      {konf && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={cn('h-2 w-2 rounded-full', konf.dot)} />
          <span>{konf.label}</span>
        </div>
      )}
    </div>
  );
};

const renderRechtsfrageExtras = (data: StructuredPayload) => {
  const konf = konfidenzStyle(data.konfidenz);

  const rechtsgrundlageArr = Array.isArray(data.rechtsgrundlage)
    ? data.rechtsgrundlage
    : typeof data.rechtsgrundlage === 'string' && data.rechtsgrundlage.trim()
    ? [data.rechtsgrundlage]
    : [];
  const rechtsgrundlageChips = rechtsgrundlageArr
    .map((r) => (typeof r === 'string' ? r.trim() : r.paragraph))
    .filter((p): p is string => !!p);

  const quellenArr = Array.isArray(data.quellen)
    ? data.quellen
    : typeof data.quellen === 'string' && data.quellen
    ? [data.quellen]
    : [];
  const visibleQuellen = quellenArr.filter(
    (q) => typeof q === 'string' || (q as { validated?: boolean }).validated !== false,
  );

  const hasRechtsprechung = Array.isArray(data.rechtsprechung) && data.rechtsprechung.length > 0;

  if (rechtsgrundlageChips.length === 0 && visibleQuellen.length === 0 && !hasRechtsprechung && !konf) {
    return null;
  }

  return (
    <div className="mt-1 flex flex-col gap-3 border-t border-border pt-2">
      {rechtsgrundlageChips.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Rechtsgrundlage</div>
          <div className="flex flex-wrap gap-1.5">
            {rechtsgrundlageChips.map((p, i) => (
              <span
                key={i}
                className="inline-flex items-center rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-foreground"
              >
                {p}
              </span>
            ))}
          </div>
        </div>
      )}
      {visibleQuellen.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Quellen</div>
          <QuelleList quellen={data.quellen as Parameters<typeof QuelleList>[0]['quellen']} variant="inline" />
        </div>
      )}
      {hasRechtsprechung && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Rechtsprechung</div>
          <div className="flex flex-col gap-2">
            {data.rechtsprechung!.map((r, i) => (
              <div key={i} className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <div className="flex flex-col gap-1">
                  {r.display && (
                    <div className="font-medium text-foreground">
                      {r.fundstelle ? (
                        <a
                          href={r.fundstelle}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline"
                        >
                          {r.display}
                        </a>
                      ) : (
                        r.display
                      )}
                    </div>
                  )}
                  {r.kernaussage && (
                    <div className="leading-relaxed text-foreground/90">{r.kernaussage}</div>
                  )}
                  {r.fundstelle && !r.display && (
                    <a
                      href={r.fundstelle}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      Quelle ansehen
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {konf && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={cn('h-2 w-2 rounded-full', konf.dot)} />
          <span>{konf.label}</span>
        </div>
      )}
    </div>
  );
};

