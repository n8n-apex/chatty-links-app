import { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, ChevronRight, FileText, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Rechtsgrundlage {
  paragraph?: string;
  quelle?: string;
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
  rechtsgrundlage?: Rechtsgrundlage[] | string;
  fehlende_informationen?: string | null;
  naechste_schritte?: string | string[] | null;
  wichtiger_hinweis?: string | null;
  quellen?: Array<string | { file?: string; state?: string; type?: string; [key: string]: unknown }> | string;
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
}

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
      obj.action === 'question'
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

export const StructuredResponse = ({ data }: { data: StructuredPayload }) => {
  const hasKernargumente = Array.isArray(data.kernargumente) && data.kernargumente.length > 0;
  const hasErgebnis = !!(data.ergebnis && String(data.ergebnis).trim());
  const hasEntwurfStellung = !!(data.entwurf_stellungnahme && String(data.entwurf_stellungnahme).trim());
  const hasAnalyseForderungen = Array.isArray(data.analyse_der_forderungen) && data.analyse_der_forderungen.length > 0;
  const hasAntwortEntwurf = !!(data.antwortschreiben_entwurf && String(data.antwortschreiben_entwurf).trim());
  const hasGesamtbeurteilung = !!(data.gesamtbeurteilung && String(data.gesamtbeurteilung).trim());

  // B6 - Stellungnahme: only enter this branch if there's actual B6 content beyond sachverhalt
  if (hasEntwurfStellung || hasKernargumente || hasErgebnis) {
    return (
      <motion.div className="flex flex-col gap-3" variants={containerVariants} initial="hidden" animate="show">
        {data.sachverhalt && (
          <Section>
            <p className="text-sm leading-relaxed text-foreground">{data.sachverhalt}</p>
          </Section>
        )}
        {hasKernargumente && (
          <Section>
            <div className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Kernargumente</div>
            <ol className="ml-4 list-decimal space-y-2 text-sm text-foreground">
              {data.kernargumente.map((arg, i) => {
                if (typeof arg === 'string') {
                  return <li key={i} className="leading-relaxed">{arg}</li>;
                }
                return (
                  <li key={i} className="leading-relaxed">
                    {arg.punkt && <div className="font-medium">{arg.punkt}</div>}
                    {arg.argument && <div className="text-muted-foreground">{arg.argument}</div>}
                    {arg.rechtsgrundlage && (
                      <div className="mt-1 text-xs text-primary">{arg.rechtsgrundlage}</div>
                    )}
                  </li>
                );
              })}
            </ol>
          </Section>
        )}
        {data.ergebnis && (
          <Section>
            <div className="border-l-2 border-border pl-3 py-1">
              <div className="mb-0.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">✅ Ergebnis</div>
              <div className="text-sm text-foreground">{data.ergebnis}</div>
            </div>
          </Section>
        )}
        {data.entwurf_stellungnahme && (
          <Section>
            <Collapsible title="Entwurf Stellungnahme">{data.entwurf_stellungnahme}</Collapsible>
          </Section>
        )}
        <Section>{renderCommonExtras(data)}</Section>
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
          <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{data.antwort}</p>
        </Section>
      )}
      {Array.isArray(data.rechtsgrundlage) && data.rechtsgrundlage.length > 0 && (
        <Section>
          <div className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Rechtsgrundlage</div>
          <div className="flex flex-wrap gap-1.5">
            {data.rechtsgrundlage.map((r, i) => (
              <ParagraphBadge key={i} paragraph={r.paragraph} quelle={r.quelle} />
            ))}
          </div>
        </Section>
      )}
      {typeof data.rechtsgrundlage === 'string' && (
        <Section>
          <div className="text-xs text-foreground">
            <span className="font-semibold text-muted-foreground uppercase tracking-wide">Rechtsgrundlage: </span>
            {data.rechtsgrundlage}
          </div>
        </Section>
      )}
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
      <Section>{renderCommonExtras(data)}</Section>
    </motion.div>
  );
};

const renderCommonExtras = (data: StructuredPayload) => {
  const quellen = Array.isArray(data.quellen)
    ? data.quellen
    : typeof data.quellen === 'string' && data.quellen
    ? [data.quellen]
    : [];
  if (quellen.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1.5 border-t border-border pt-2">
      {quellen.map((q, i) => {
        const label = typeof q === 'string'
          ? q
          : [q.file, q.state, q.type].filter(Boolean).join(' · ') || JSON.stringify(q);
        return (
          <span key={i} className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {label}
          </span>
        );
      })}
    </div>
  );
};
