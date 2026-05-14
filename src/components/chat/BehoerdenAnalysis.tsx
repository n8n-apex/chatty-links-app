import { useState } from 'react';
import { motion } from 'framer-motion';
import { Copy, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { QuelleList, type Quelle } from './QuelleList';

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

  return (
    <motion.div
      className="flex flex-col gap-5"
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      {/* Section 1: Header */}
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

      {/* Section 2: Dokumentdetails */}
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

      {/* Section 3: Stellungnahme */}
      {(data.projekt_und_sachverhalt ||
        data.rechtliche_beurteilungsgrundlage ||
        beurteilung.length > 0 ||
        data.schlussfolgerung) && (
        <Sec>
          <SectionHeading>Stellungnahme</SectionHeading>
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-background/30 p-4">
            {data.projekt_und_sachverhalt && (
              <div>
                <SubHeading>3.1 Projekt und Sachverhalt</SubHeading>
                <p className="mt-1 text-sm leading-relaxed text-foreground whitespace-pre-line">
                  {data.projekt_und_sachverhalt}
                </p>
              </div>
            )}
            {data.rechtliche_beurteilungsgrundlage && (
              <div>
                <SubHeading>3.2 Rechtliche Beurteilungsgrundlage</SubHeading>
                <p className="mt-1 text-sm leading-relaxed text-foreground whitespace-pre-line">
                  {data.rechtliche_beurteilungsgrundlage}
                </p>
              </div>
            )}
            {beurteilung.length > 0 && (
              <div>
                <SubHeading>3.3 Beurteilung der Einzelfakten</SubHeading>
                <div className="mt-2 flex flex-col gap-2">
                  {beurteilung.map((item, i) => (
                    <div key={i} className="rounded-md border border-border bg-background/40 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        {item.fakt && <div className="text-sm font-semibold text-foreground">{item.fakt}</div>}
                        {item.beurteilung && (
                          <Pill label={item.beurteilung} className={beurteilungClass(item.beurteilung)} />
                        )}
                      </div>
                      {item.rechtsgrundlage && (
                        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{item.rechtsgrundlage}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {data.schlussfolgerung && (
              <div className="rounded-md border-l-2 border-primary bg-primary/5 px-3 py-2">
                <SubHeading>3.4 Schlussfolgerung</SubHeading>
                <p className="mt-1 text-sm font-medium leading-relaxed text-foreground whitespace-pre-line">
                  {data.schlussfolgerung}
                </p>
              </div>
            )}
          </div>
        </Sec>
      )}

      {/* Section 4: Zusammenfassung */}
      {data.zusammenfassung && (
        <Sec>
          <SectionHeading>Zusammenfassung</SectionHeading>
          <p className="text-sm leading-relaxed text-foreground whitespace-pre-line">{data.zusammenfassung}</p>
        </Sec>
      )}

      {/* Section 5: Detailanalyse */}
      {forderungen.length > 0 && (
        <Sec>
          <SectionHeading>Analyse der Forderungen</SectionHeading>
          <div className="flex flex-col gap-2">
            {forderungen.map((f, i) => {
              const beurt = (f.beurteilung || f.bewertung) as string | undefined;
              const begr = f.begruendung_mit_quelle || f.begruendung;
              return (
                <div key={i} className="rounded-md border border-border bg-background/30 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    {f.forderung && <div className="text-sm font-semibold text-foreground">{f.forderung}</div>}
                    {beurt && <Pill label={beurt} className={beurteilungClass(beurt)} />}
                  </div>
                  {begr && (
                    <p className="mt-1.5 text-xs leading-relaxed text-foreground/90">{begr}</p>
                  )}
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
        </Sec>
      )}

      {/* Section 6: Rechtsgrundlage */}
      {rechtsgrundlageArr.length > 0 && (
        <Sec>
          <SectionHeading>Rechtsgrundlage</SectionHeading>
          <div className="flex flex-wrap gap-1.5">
            {rechtsgrundlageArr.map((r, i) => (
              <span
                key={i}
                className="inline-flex items-center rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-foreground"
              >
                {r}
              </span>
            ))}
          </div>
        </Sec>
      )}

      {/* Section 7: Genehmigungsfiktion */}
      {showGenFiktion && (
        <Sec>
          <SectionHeading>Genehmigungsfiktion</SectionHeading>
          <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-background/30 p-3 md:grid-cols-2">
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
        </Sec>
      )}

      {/* Section 8: Antwortschreiben Entwurf */}
      {data.antwortschreiben_entwurf && (
        <Sec>
          <SectionHeading>Antwortschreiben (Entwurf)</SectionHeading>
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

      {/* Section 9: Nächste Schritte */}
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

      {/* Section 10: Quellen */}
      {Array.isArray(data.quellen) && data.quellen.length > 0 && (
        <Sec>
          <SectionHeading>Quellen</SectionHeading>
          <QuelleList quellen={data.quellen} />
        </Sec>
      )}

      {/* Section 11: Footer */}
      {(data.retrieval_summary || formattedTimestamp) && (
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5 border-t border-border pt-2 text-[10px] text-muted-foreground">
          {data.retrieval_summary && <span>{data.retrieval_summary}</span>}
          {formattedTimestamp && <span>{formattedTimestamp}</span>}
        </div>
      )}
    </motion.div>
  );
};
