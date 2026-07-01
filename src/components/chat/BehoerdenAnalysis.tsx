import { useState } from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { Copy, Check, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { QuelleList, type Quelle } from './QuelleList';

interface Rechtsprechung {
  display?: string;
  kernaussage?: string;
  fundstelle?: string;
  [key: string]: unknown;
}

const Md = ({ children }: { children: string }) => (
  <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1.5 prose-p:leading-relaxed prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-li:text-foreground prose-li:my-0.5 prose-ol:list-decimal prose-ul:list-disc">
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

type Beurteilung = 'Begründet' | 'Teilweise begründet' | 'Nicht begründet' | 'Unklar' | string;
type Risiko = 'Hoch' | 'Mittel' | 'Gering' | string;
type Konfidenz = 'hoch' | 'mittel' | 'niedrig' | string;

export interface BehoerdenAnalysisData {
  status?: string;
  action?: string;
  sessionId?: string;
  dateiname?: string;

  projekt_und_sachverhalt?: string;
  rechtliche_beurteilungsgrundlage?: string;
  beurteilung_der_einzelfakten?: Array<{
    fakt?: string;
    beurteilung?: Beurteilung;
    rechtsgrundlage?: string;
  }>;
  schlussfolgerung?: string;

  zusammenfassung?: string;
  gesamtbeurteilung?: Beurteilung;
  analyse_der_forderungen?: Array<{
    forderung?: string;
    beurteilung?: Beurteilung;
    bewertung?: string;
    begruendung_mit_quelle?: string;
    begruendung?: string;
    fehlende_information?: string | null;
    gegenargument?: string | null;
  }>;
  rechtsgrundlage?: string[] | string;
  naechste_schritte?: string[] | string | null;
  antwortschreiben_entwurf?: string;
  risikobewertung?: Risiko;
  konfidenz?: Konfidenz;
  genehmigungsfiktion?: {
    anwendbar?: boolean;
    vorschrift?: string | null;
    frist_tage?: number | null;
    eingetreten?: boolean;
    begruendung?: string;
  };

  bundesland?: string;
  absender_behoerde?: string | null;
  aktenzeichen?: string | null;
  antragsteller?: string | null;
  bauvorhaben?: string | null;
  ziel_des_nutzers?: string | null;

  quellen?: Quelle[] | string;
  rechtsprechung?: Rechtsprechung[];
  rechtsgrundlage_unverifiziert?: string[];
  naechste_optionen?: string[] | string | null;
  fehlende_information?: string | null;
  ziel_erfuellt?: boolean;
  kontext_ausreichend?: boolean;
  retrieval_summary?: string | null;
  model_used?: string;
  timestamp?: string;
}

const beurteilungClass = (v?: string): string => {
  if (!v) return 'border-border bg-muted/40 text-muted-foreground';
  const t = v.toLowerCase();
  // For Behördenschreiben: "Nicht begründet" is GOOD for the client (green)
  if (t.includes('nicht begründet') || t.includes('unbegründet')) {
    return 'border-green-500/40 bg-green-500/10 text-green-500';
  }
  if (t.includes('teilweise')) {
    return 'border-yellow-500/40 bg-yellow-500/10 text-yellow-500';
  }
  if (t.includes('begründet') || t.includes('zulässig')) {
    return 'border-red-500/40 bg-red-500/10 text-red-500';
  }
  return 'border-border bg-muted/40 text-muted-foreground';
};

const risikoClass = (v?: string): string => {
  const t = (v || '').toLowerCase();
  if (t === 'gering') return 'border-green-500/40 bg-green-500/10 text-green-500';
  if (t === 'mittel') return 'border-yellow-500/40 bg-yellow-500/10 text-yellow-500';
  if (t === 'hoch') return 'border-red-500/40 bg-red-500/10 text-red-500';
  return 'border-border bg-muted/40 text-muted-foreground';
};

const konfidenzClass = (v?: string): string => {
  const t = (v || '').toLowerCase();
  if (t === 'hoch') return 'border-green-500/40 bg-green-500/10 text-green-500';
  if (t === 'mittel') return 'border-yellow-500/40 bg-yellow-500/10 text-yellow-500';
  if (t === 'niedrig') return 'border-red-500/40 bg-red-500/10 text-red-500';
  return 'border-border bg-muted/40 text-muted-foreground';
};

const Pill = ({ label, className }: { label: string; className?: string }) => (
  <span
    className={cn(
      'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
      className,
    )}
  >
    {label}
  </span>
);

const SectionHeading = ({ children }: { children: React.ReactNode }) => (
  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</div>
);

const SubHeading = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</div>
);

const containerVariants = {
  hidden: { opacity: 1 },
  show: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' as const } },
};
const Sec = ({ children }: { children: React.ReactNode }) => (
  <motion.div variants={itemVariants} className="flex flex-col gap-2">{children}</motion.div>
);

const DetailRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
    <span className="text-sm text-foreground">{value}</span>
  </div>
);

export const BehoerdenAnalysis = ({ data }: { data: BehoerdenAnalysisData }) => {
  const [copied, setCopied] = useState(false);

  const beurteilung = data.beurteilung_der_einzelfakten || [];
  const forderungen = data.analyse_der_forderungen || [];
  const rechtsgrundlageArr = Array.isArray(data.rechtsgrundlage)
    ? data.rechtsgrundlage
    : typeof data.rechtsgrundlage === 'string' && data.rechtsgrundlage
    ? [data.rechtsgrundlage]
    : [];
  const naechsteSchritteArr = Array.isArray(data.naechste_schritte)
    ? data.naechste_schritte
    : typeof data.naechste_schritte === 'string' && data.naechste_schritte
    ? [data.naechste_schritte]
    : [];

  const detailFields: Array<{ label: string; value: string | null | undefined }> = [
    { label: 'Absender (Behörde)', value: data.absender_behoerde },
    { label: 'Aktenzeichen', value: data.aktenzeichen },
    { label: 'Antragsteller', value: data.antragsteller },
    { label: 'Bauvorhaben', value: data.bauvorhaben },
    { label: 'Bundesland', value: data.bundesland },
  ];
  if (data.ziel_des_nutzers) {
    detailFields.push({ label: 'Ziel des Nutzers', value: data.ziel_des_nutzers });
  }
  const showDetails = detailFields.some((f) => f.value !== undefined && f.value !== null && String(f.value).trim() !== '');

  const handleCopyLetter = async () => {
    if (!data.antwortschreiben_entwurf) return;
    try {
      await navigator.clipboard.writeText(data.antwortschreiben_entwurf);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const formattedTimestamp = (() => {
    if (!data.timestamp) return null;
    try {
      return new Date(data.timestamp).toLocaleString('de-DE');
    } catch {
      return data.timestamp;
    }
  })();

  const genFiktion = data.genehmigungsfiktion;
  const showGenFiktion = !!(genFiktion && genFiktion.anwendbar === true);

  const [detailOpen, setDetailOpen] = useState(false);

  const hasLegacyDetail =
    !!data.zusammenfassung ||
    forderungen.length > 0 ||
    rechtsgrundlageArr.length > 0 ||
    naechsteSchritteArr.length > 0 ||
    showGenFiktion;

  return (
    <motion.div
      className="flex flex-col gap-5"
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      {/* Header */}
      <Sec>
        <div className="rounded-xl border border-border bg-background/40 p-4">
          <div className="text-base font-semibold text-foreground">Behördenschreiben Analyse</div>
          {data.dateiname && (
            <div className="mt-0.5 text-xs text-muted-foreground">{data.dateiname}</div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {data.gesamtbeurteilung && (
              <Pill label={`Gesamt: ${data.gesamtbeurteilung}`} className={beurteilungClass(data.gesamtbeurteilung)} />
            )}
            {data.risikobewertung && (
              <Pill label={`Risiko: ${data.risikobewertung}`} className={risikoClass(data.risikobewertung)} />
            )}
            {data.konfidenz && (
              <Pill label={`Konfidenz: ${data.konfidenz}`} className={konfidenzClass(data.konfidenz)} />
            )}
          </div>
        </div>
      </Sec>

      {/* Dokumentdetails */}
      {showDetails && (
        <Sec>
          <SectionHeading>Dokumentdetails</SectionHeading>
          <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-background/30 p-3 md:grid-cols-2">
            {detailFields.map((f) => (
              <DetailRow key={f.label} label={f.label} value={f.value && String(f.value).trim() ? f.value : '—'} />
            ))}
          </div>
        </Sec>
      )}

      {/* 1. Projekt und Sachverhalt */}
      {data.projekt_und_sachverhalt && (
        <Sec>
          <SectionHeading>1. Projekt und Sachverhalt</SectionHeading>
          <p className="text-sm leading-relaxed text-foreground whitespace-pre-line">
            {data.projekt_und_sachverhalt}
          </p>
        </Sec>
      )}

      {/* 2. Rechtliche Beurteilungsgrundlage */}
      {data.rechtliche_beurteilungsgrundlage && (
        <Sec>
          <SectionHeading>2. Rechtliche Beurteilungsgrundlage</SectionHeading>
          <p className="text-sm leading-relaxed text-foreground whitespace-pre-line">
            {data.rechtliche_beurteilungsgrundlage}
          </p>
        </Sec>
      )}

      {/* 3. Beurteilung der Einzelfakten */}
      {beurteilung.length > 0 && (
        <Sec>
          <SectionHeading>3. Beurteilung der Einzelfakten</SectionHeading>
          <div className="flex flex-col gap-2">
            {beurteilung.map((item, i) => (
              <div key={i} className="rounded-md border border-border bg-background/40 p-3">
                {item.fakt && (
                  <div className="text-sm">
                    <span className="font-semibold text-muted-foreground">Fakt: </span>
                    <span className="text-foreground">{item.fakt}</span>
                  </div>
                )}
                {item.beurteilung && (
                  <div className="mt-1 flex items-baseline gap-2 text-sm">
                    <span className="font-semibold text-muted-foreground">Beurteilung:</span>
                    <Pill label={item.beurteilung} className={beurteilungClass(item.beurteilung)} />
                  </div>
                )}
                {item.rechtsgrundlage && (
                  <div className="mt-1 text-sm">
                    <span className="font-semibold text-muted-foreground">Rechtsgrundlage: </span>
                    <span className="text-foreground">{item.rechtsgrundlage}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Sec>
      )}

      {/* 4. Schlussfolgerung */}
      {data.schlussfolgerung && (
        <Sec>
          <SectionHeading>4. Schlussfolgerung</SectionHeading>
          <div className="rounded-md border-l-2 border-primary bg-primary/5 px-3 py-2">
            <p className="text-sm font-medium leading-relaxed text-foreground whitespace-pre-line">
              {data.schlussfolgerung}
            </p>
          </div>
        </Sec>
      )}

      {/* Detailanalyse — collapsible legacy */}
      {hasLegacyDetail && (
        <Sec>
          <div className="rounded-lg border border-border bg-background/30">
            <button
              type="button"
              onClick={() => setDetailOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted/30"
            >
              <span>Detailanalyse anzeigen</span>
              {detailOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
            {detailOpen && (
              <div className="flex flex-col gap-4 border-t border-border p-3">
                {data.zusammenfassung && (
                  <div>
                    <SubHeading>Zusammenfassung</SubHeading>
                    <p className="mt-1 text-sm leading-relaxed text-foreground whitespace-pre-line">{data.zusammenfassung}</p>
                  </div>
                )}
                {forderungen.length > 0 && (
                  <div>
                    <SubHeading>Analyse der Forderungen</SubHeading>
                    <div className="mt-2 flex flex-col gap-2">
                      {forderungen.map((f, i) => {
                        const beurt = (f.beurteilung || f.bewertung) as string | undefined;
                        const begr = f.begruendung_mit_quelle || f.begruendung;
                        return (
                          <div key={i} className="rounded-md border border-border bg-background/40 p-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              {f.forderung && <div className="text-sm font-semibold text-foreground">{f.forderung}</div>}
                              {beurt && <Pill label={beurt} className={beurteilungClass(beurt)} />}
                            </div>
                            {begr && <p className="mt-1.5 text-xs leading-relaxed text-foreground/90">{begr}</p>}
                            {f.fehlende_information && (
                              <p className="mt-1.5 text-xs text-muted-foreground">
                                <span className="font-semibold">Fehlende Information:</span> {f.fehlende_information}
                              </p>
                            )}
                            {f.gegenargument && (
                              <div className="mt-2 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1.5">
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-primary">Gegenargument</div>
                                <p className="mt-0.5 text-xs leading-relaxed text-foreground">{f.gegenargument}</p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {rechtsgrundlageArr.length > 0 && (
                  <div>
                    <SubHeading>Rechtsgrundlage</SubHeading>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {rechtsgrundlageArr.map((r, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-foreground"
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {showGenFiktion && (
                  <div>
                    <SubHeading>Genehmigungsfiktion</SubHeading>
                    <div className="mt-1.5 grid grid-cols-1 gap-3 rounded-lg border border-border bg-background/30 p-3 md:grid-cols-2">
                      {genFiktion!.vorschrift && <DetailRow label="Vorschrift" value={genFiktion!.vorschrift} />}
                      {genFiktion!.frist_tage != null && <DetailRow label="Frist (Tage)" value={String(genFiktion!.frist_tage)} />}
                      <DetailRow
                        label="Eingetreten"
                        value={
                          <span className="inline-flex items-center gap-1.5">
                            <span className={cn('h-2 w-2 rounded-full', genFiktion!.eingetreten ? 'bg-green-500' : 'bg-red-500')} />
                            {genFiktion!.eingetreten ? 'Ja' : 'Nein'}
                          </span>
                        }
                      />
                      {genFiktion!.begruendung && <DetailRow label="Begründung" value={genFiktion!.begruendung} />}
                    </div>
                  </div>
                )}
                {naechsteSchritteArr.length > 0 && (
                  <div>
                    <SubHeading>Nächste Schritte</SubHeading>
                    <ol className="ml-5 mt-1.5 list-decimal space-y-1 text-sm text-foreground">
                      {naechsteSchritteArr.map((s, i) => (
                        <li key={i} className="leading-relaxed">{s}</li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            )}
          </div>
        </Sec>
      )}

      {/* Antwortschreiben Entwurf */}
      {data.antwortschreiben_entwurf && (
        <Sec>
          <SectionHeading>Antwortschreiben-Entwurf</SectionHeading>
          <div className="relative rounded-lg border border-border bg-background p-5">
            <button
              type="button"
              onClick={handleCopyLetter}
              className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-border bg-background/80 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Antwortschreiben kopieren"
            >
              {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
              {copied ? 'Kopiert' : 'Kopieren'}
            </button>
            <div className="font-serif text-sm leading-relaxed text-foreground whitespace-pre-line">
              {data.antwortschreiben_entwurf}
            </div>
          </div>
        </Sec>
      )}

      {/* Quellen */}
      {Array.isArray(data.quellen) && data.quellen.length > 0 && (
        <Sec>
          <SectionHeading>Quellen</SectionHeading>
          <QuelleList quellen={data.quellen} />
        </Sec>
      )}

      {/* Footer */}
      {(data.retrieval_summary || formattedTimestamp) && (
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5 border-t border-border pt-2 text-[10px] text-muted-foreground">
          {data.retrieval_summary && <span>{data.retrieval_summary}</span>}
          {formattedTimestamp && <span>{formattedTimestamp}</span>}
        </div>
      )}
    </motion.div>
  );
};
