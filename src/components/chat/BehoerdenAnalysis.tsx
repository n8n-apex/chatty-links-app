import { useState } from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { Copy, Check, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { QuelleList, type Quelle } from './QuelleList';
import { toText, toStringList } from '@/lib/safeText';
import { UnverifizierteNormen } from './UnverifizierteNormen';
import { toast } from 'sonner';



interface Rechtsprechung {
  display?: string;
  kernaussage?: string;
  fundstelle?: string;
  inhaltlich_geprueft?: boolean;
  [key: string]: unknown;
}

interface RechtsprechungFootnote {
  footnote_num?: number | null;
  status?: 'verified' | 'needs_verification' | string;
  gericht?: string;
  datum?: string;
  aktenzeichen?: string;
  entscheidungstyp?: string;
  display?: string;
  fundstelle?: string | null;
  kernaussage?: string;
}



// `children` is typed unknown on purpose: the backend is not schema-stable and
// react-markdown throws on non-string input, which would take down the tree.
const Md = ({ children }: { children: unknown }) => {
  const text = toText(children);
  if (!text.trim()) return null;
  return (
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
        {text}
      </ReactMarkdown>
    </div>
  );
};


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
  rechtsprechung_footnotes?: RechtsprechungFootnote[];
  rechtsprechung_grounding_disabled?: boolean;

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
      'inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-medium leading-snug max-w-full whitespace-normal break-words text-left align-top',
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

  const beurteilung = Array.isArray(data.beurteilung_der_einzelfakten) ? data.beurteilung_der_einzelfakten : [];
  const forderungen = Array.isArray(data.analyse_der_forderungen) ? data.analyse_der_forderungen : [];
  const rechtsgrundlageArr = toStringList(data.rechtsgrundlage);
  const naechsteSchritteArr = toStringList(data.naechste_schritte);

  const detailFields: Array<{ label: string; value: string }> = [
    { label: 'Absender (Behörde)', value: toText(data.absender_behoerde) },
    { label: 'Aktenzeichen', value: toText(data.aktenzeichen) },
    { label: 'Antragsteller', value: toText(data.antragsteller) },
    { label: 'Bauvorhaben', value: toText(data.bauvorhaben) },
    { label: 'Bundesland', value: toText(data.bundesland) },
  ];
  if (toText(data.ziel_des_nutzers).trim()) {
    detailFields.push({ label: 'Ziel des Nutzers', value: toText(data.ziel_des_nutzers) });
  }
  const showDetails = detailFields.some((f) => f.value.trim() !== '');

  const letterText = toText(data.antwortschreiben_entwurf);

  const handleCopyLetter = async () => {
    // The backend has shipped objects in this field before; never let a
    // "[object Object]" string reach the clipboard of a letter to an authority.
    if (typeof data.antwortschreiben_entwurf !== 'string' || !letterText.trim()) {
      toast.error('Der Entwurf konnte nicht kopiert werden (unerwartetes Format). Bitte den Text manuell markieren.');
      return;
    }
    try {
      await navigator.clipboard.writeText(letterText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      toast.error('Kopieren fehlgeschlagen. Bitte den Text manuell markieren und kopieren.');
      console.error('[BehoerdenAnalysis] clipboard write failed', e);
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
          {toText(data.dateiname).trim() && (
            <div className="mt-0.5 text-xs text-muted-foreground">{toText(data.dateiname)}</div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {toText(data.gesamtbeurteilung).trim() && (
              <Pill label={`Gesamt: ${toText(data.gesamtbeurteilung)}`} className={beurteilungClass(toText(data.gesamtbeurteilung))} />
            )}
            {toText(data.risikobewertung).trim() && (
              <Pill label={`Risiko: ${toText(data.risikobewertung)}`} className={risikoClass(toText(data.risikobewertung))} />
            )}
            {toText(data.konfidenz).trim() && (
              <Pill label={`Konfidenz: ${toText(data.konfidenz)}`} className={konfidenzClass(toText(data.konfidenz))} />
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
              <DetailRow key={f.label} label={f.label} value={f.value.trim() ? f.value : '—'} />
            ))}

          </div>
        </Sec>
      )}

      {/* 1. Projekt und Sachverhalt */}
      {data.projekt_und_sachverhalt && (
        <Sec>
          <SectionHeading>1. Projekt und Sachverhalt</SectionHeading>
          <Md>{data.projekt_und_sachverhalt}</Md>
        </Sec>
      )}

      {/* 2. Rechtliche Beurteilungsgrundlage */}
      {data.rechtliche_beurteilungsgrundlage && (
        <Sec>
          <SectionHeading>2. Rechtliche Beurteilungsgrundlage</SectionHeading>
          <Md>{data.rechtliche_beurteilungsgrundlage}</Md>
        </Sec>
      )}

      {/* 3. Beurteilung der Einzelfakten */}
      {beurteilung.length > 0 && (
        <Sec>
          <SectionHeading>3. Beurteilung der Einzelfakten</SectionHeading>
          <div className="flex flex-col gap-2">
            {beurteilung.map((item, i) => {
              const fakt = toText(item?.fakt);
              const beurt = toText(item?.beurteilung);
              const rg = toText(item?.rechtsgrundlage);
              return (
                <div key={i} className="rounded-md border border-border bg-background/40 p-3">
                  {fakt.trim() && (
                    <div className="text-sm">
                      <span className="font-semibold text-muted-foreground">Fakt: </span>
                      <span className="text-foreground">{fakt}</span>
                    </div>
                  )}
                  {beurt.trim() && (
                    <div className="mt-1 flex items-baseline gap-2 text-sm">
                      <span className="font-semibold text-muted-foreground">Beurteilung:</span>
                      <Pill label={beurt} className={beurteilungClass(beurt)} />
                    </div>
                  )}
                  {rg.trim() && (
                    <div className="mt-1 text-sm">
                      <span className="font-semibold text-muted-foreground">Rechtsgrundlage: </span>
                      <span className="text-foreground">{rg}</span>
                    </div>
                  )}
                </div>
              );
            })}

          </div>
        </Sec>
      )}

      {/* 4. Schlussfolgerung */}
      {data.schlussfolgerung && (
        <Sec>
          <SectionHeading>4. Schlussfolgerung</SectionHeading>
          <div className="rounded-md border-l-2 border-primary bg-primary/5 px-3 py-2">
            <Md>{data.schlussfolgerung}</Md>
          </div>
        </Sec>
      )}

      {/* Risikobewertung */}
      {toText(data.risikobewertung).trim() && (
        <Sec>
          <SectionHeading>Risikobewertung</SectionHeading>
          <Md>{data.risikobewertung}</Md>
        </Sec>
      )}

      {/* Genehmigungsfiktion (top-level, only if meaningful) */}
      {showGenFiktion && (
        <Sec>
          <SectionHeading>Genehmigungsfiktion</SectionHeading>
          <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-background/30 p-3 md:grid-cols-2">
            {toText(genFiktion!.vorschrift).trim() && <DetailRow label="Vorschrift" value={toText(genFiktion!.vorschrift)} />}
            {genFiktion!.frist_tage != null && <DetailRow label="Frist (Tage)" value={toText(genFiktion!.frist_tage)} />}
            <DetailRow
              label="Eingetreten"
              value={
                <span className="inline-flex items-center gap-1.5">
                  <span className={cn('h-2 w-2 rounded-full', genFiktion!.eingetreten ? 'bg-green-500' : 'bg-red-500')} />
                  {genFiktion!.eingetreten ? 'Ja' : 'Nein'}
                </span>
              }
            />
            {toText(genFiktion!.begruendung).trim() && <DetailRow label="Begründung" value={toText(genFiktion!.begruendung)} />}
          </div>
        </Sec>
      )}

      {/* Nächste Schritte */}
      {naechsteSchritteArr.length > 0 && (
        <Sec>
          <SectionHeading>Nächste Schritte</SectionHeading>
          <ol className="ml-5 list-decimal space-y-1 text-sm text-foreground">
            {naechsteSchritteArr.map((s, i) => (
              <li key={i} className="leading-relaxed">{s}</li>
            ))}
          </ol>
        </Sec>
      )}

      {/* Nächste Optionen */}
      {(() => {
        const items = toStringList(data.naechste_optionen);
        if (items.length === 0) return null;
        return (
          <Sec>
            <SectionHeading>Nächste Optionen</SectionHeading>
            <ul className="ml-5 list-disc space-y-1 text-sm text-foreground">
              {items.map((s, i) => <li key={i} className="leading-relaxed">{s}</li>)}
            </ul>
          </Sec>
        );
      })()}

      {/* Rechtsgrundlage (verifiziert) */}
      {rechtsgrundlageArr.length > 0 && (
        <Sec>
          <SectionHeading>Rechtsgrundlage</SectionHeading>
          <div className="flex flex-wrap gap-1.5">
            {rechtsgrundlageArr.map((r, i) => (
              <span key={i} className="inline-block rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] leading-snug text-foreground max-w-full whitespace-normal break-words text-left align-top">{r}</span>
            ))}
          </div>
        </Sec>
      )}

      {/* Rechtsgrundlage unverifiziert */}
      {toStringList(data.rechtsgrundlage_unverifiziert).length > 0 && (
        <Sec>
          <UnverifizierteNormen value={data.rechtsgrundlage_unverifiziert} />
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
                {toText(data.zusammenfassung).trim() && (
                  <div>
                    <SubHeading>Zusammenfassung</SubHeading>
                    <p className="mt-1 text-sm leading-relaxed text-foreground whitespace-pre-line">{toText(data.zusammenfassung)}</p>
                  </div>
                )}
                {forderungen.length > 0 && (
                  <div>
                    <SubHeading>Analyse der Forderungen</SubHeading>
                    <div className="mt-2 flex flex-col gap-2">
                      {forderungen.map((f, i) => {
                        const beurt = toText(f?.beurteilung ?? f?.bewertung);
                        const begr = toText(f?.begruendung_mit_quelle ?? f?.begruendung);
                        const forderung = toText(f?.forderung);
                        const fehlend = toText(f?.fehlende_information);
                        const gegen = toText(f?.gegenargument);
                        return (
                          <div key={i} className="rounded-md border border-border bg-background/40 p-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              {forderung.trim() && <div className="text-sm font-semibold text-foreground">{forderung}</div>}
                              {beurt.trim() && <Pill label={beurt} className={beurteilungClass(beurt)} />}
                            </div>
                            {begr.trim() && <p className="mt-1.5 text-xs leading-relaxed text-foreground/90">{begr}</p>}
                            {fehlend.trim() && (
                              <p className="mt-1.5 text-xs text-muted-foreground">
                                <span className="font-semibold">Fehlende Information:</span> {fehlend}
                              </p>
                            )}
                            {gegen.trim() && (
                              <div className="mt-2 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1.5">
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-primary">Gegenargument</div>
                                <p className="mt-0.5 text-xs leading-relaxed text-foreground">{gegen}</p>
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
                          className="inline-block rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] leading-snug text-foreground max-w-full whitespace-normal break-words text-left align-top"
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
                      {toText(genFiktion!.vorschrift).trim() && <DetailRow label="Vorschrift" value={toText(genFiktion!.vorschrift)} />}
                      {genFiktion!.frist_tage != null && <DetailRow label="Frist (Tage)" value={toText(genFiktion!.frist_tage)} />}
                      <DetailRow
                        label="Eingetreten"
                        value={
                          <span className="inline-flex items-center gap-1.5">
                            <span className={cn('h-2 w-2 rounded-full', genFiktion!.eingetreten ? 'bg-green-500' : 'bg-red-500')} />
                            {genFiktion!.eingetreten ? 'Ja' : 'Nein'}
                          </span>
                        }
                      />
                      {toText(genFiktion!.begruendung).trim() && <DetailRow label="Begründung" value={toText(genFiktion!.begruendung)} />}

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
      {letterText.trim() && (
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
            <div className="font-serif">
              <Md>{data.antwortschreiben_entwurf}</Md>
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

      {/* Rechtsprechung — new footnote model (preferred) */}
      {Array.isArray(data.rechtsprechung_footnotes) && data.rechtsprechung_footnotes.length > 0 ? (
        <Sec>
          <SectionHeading>Rechtsprechung</SectionHeading>
          <div className="flex flex-col gap-2">
            {data.rechtsprechung_footnotes.map((f, i) => {
              const isVerified = f.status === 'verified';
              const num = typeof f.footnote_num === 'number' ? f.footnote_num : null;
              const cite = toText(f?.display).trim();
              const href = typeof f?.fundstelle === 'string' && f.fundstelle.trim() ? f.fundstelle : null;
              return (
                <div
                  key={i}
                  id={num !== null ? `fn-${num}` : undefined}
                  className={cn(
                    'rounded-lg border p-3 text-sm flex gap-2',
                    isVerified ? 'border-border bg-muted/40' : 'border-border/60 bg-muted/20 opacity-75',
                  )}
                >
                  {num !== null && (
                    <span className="font-semibold text-foreground shrink-0 tabular-nums">{num}.</span>
                  )}
                  <div className="flex flex-col gap-1 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {cite && (
                        href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-primary hover:underline break-words"
                          >
                            {cite}
                          </a>
                        ) : (
                          <span className="font-medium text-foreground break-words">{cite}</span>
                        )
                      )}
                      {isVerified ? (
                        <span
                          className="inline-flex items-center rounded-full border border-green-600/40 bg-green-600/10 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400"
                          title="Kernaussage wurde gegen den Entscheidungstext geprüft"
                        >
                          geprüft
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
                          title="Fall ist real und korrekt zitiert; die Begründung wurde nicht gegen den Entscheidungstext geprüft"
                        >
                          nicht inhaltlich geprüft
                        </span>
                      )}
                    </div>
                    {toText(f?.kernaussage).trim() && (
                      <div className={cn('leading-relaxed', isVerified ? 'text-foreground/90' : 'text-muted-foreground')}>
                        {toText(f?.kernaussage)}
                      </div>
                    )}

                  </div>
                </div>
              );
            })}
          </div>
        </Sec>
      ) : (
        /* Rechtsprechung — legacy fallback */
        Array.isArray(data.rechtsprechung) && data.rechtsprechung.length > 0 && (
          <Sec>
            <SectionHeading>Rechtsprechung</SectionHeading>
            <div className="flex flex-col gap-2">
              {data.rechtsprechung.map((r, i) => {
                const display = toText(r?.display).trim();
                const kern = toText(r?.kernaussage).trim();
                const href = typeof r?.fundstelle === 'string' && r.fundstelle.trim() ? r.fundstelle : null;
                return (
                  <div key={i} className="rounded-md border border-border bg-background/40 p-2.5">
                    {display && (
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold text-foreground">{display}</div>
                        {r?.inhaltlich_geprueft === false && !data.rechtsprechung_grounding_disabled && (
                          <span className="inline-flex items-center rounded-full border border-yellow-500/40 bg-yellow-500/10 px-2 py-0.5 text-[10px] font-medium text-yellow-600">
                            nicht inhaltlich geprüft
                          </span>
                        )}
                      </div>
                    )}
                    {kern && <div className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{kern}</div>}
                    {href && (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" /> Quelle ansehen
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </Sec>
        )
      )}


      {/* Konfidenz */}
      {toText(data.konfidenz).trim() && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="uppercase tracking-wide">Konfidenz:</span>
          <span className={cn(
            'inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium leading-snug max-w-full whitespace-normal break-words text-left align-top',
            toText(data.konfidenz).toLowerCase() === 'hoch' && 'border-green-500/40 bg-green-500/10 text-green-600',
            toText(data.konfidenz).toLowerCase() === 'mittel' && 'border-yellow-500/40 bg-yellow-500/10 text-yellow-600',
            (toText(data.konfidenz).toLowerCase() === 'niedrig' || toText(data.konfidenz).toLowerCase() === 'unzureichend') && 'border-red-500/40 bg-red-500/10 text-red-600',
          )}>{toText(data.konfidenz)}</span>
        </div>
      )}

      {/* Footer */}
      {(toText(data.retrieval_summary).trim() || formattedTimestamp) && (
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5 border-t border-border pt-2 text-[10px] text-muted-foreground">
          {toText(data.retrieval_summary).trim() && <span>{toText(data.retrieval_summary)}</span>}
          {formattedTimestamp && <span>{formattedTimestamp}</span>}
        </div>
      )}

    </motion.div>
  );
};
