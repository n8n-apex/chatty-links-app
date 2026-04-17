import { jsPDF } from 'jspdf';
import type { StructuredPayload } from '@/components/chat/StructuredResponse';

const MARGIN_X = 15;
const MARGIN_TOP = 20;
const PAGE_HEIGHT = 297;
const PAGE_WIDTH = 210;
const FOOTER_Y = PAGE_HEIGHT - 12;
const CONTENT_BOTTOM = PAGE_HEIGHT - 18;

const stringifyValue = (val: unknown): string => {
  if (val == null) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) return val.map(stringifyValue).filter(Boolean).join(', ');
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    return Object.values(obj).map(stringifyValue).filter(Boolean).join(' · ');
  }
  return '';
};

class PdfBuilder {
  doc: jsPDF;
  y: number;

  constructor() {
    this.doc = new jsPDF({ unit: 'mm', format: 'a4' });
    this.y = MARGIN_TOP;
  }

  ensureSpace(needed: number) {
    if (this.y + needed > CONTENT_BOTTOM) {
      this.addFooter();
      this.doc.addPage();
      this.y = MARGIN_TOP;
    }
  }

  addFooter() {
    this.doc.setFont('helvetica', 'italic');
    this.doc.setFontSize(8);
    this.doc.setTextColor(120);
    this.doc.text(
      'Erstellt mit Baurecht GPT — kein Rechtsrat',
      PAGE_WIDTH / 2,
      FOOTER_Y,
      { align: 'center' }
    );
    this.doc.setTextColor(0);
  }

  heading(text: string) {
    this.ensureSpace(10);
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(12);
    this.doc.setTextColor(178, 34, 52);
    this.doc.text(text, MARGIN_X, this.y);
    this.doc.setTextColor(0);
    this.y += 6;
  }

  paragraph(text: string) {
    if (!text) return;
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(10);
    const lines = this.doc.splitTextToSize(text, PAGE_WIDTH - MARGIN_X * 2);
    for (const line of lines) {
      this.ensureSpace(5);
      this.doc.text(line, MARGIN_X, this.y);
      this.y += 5;
    }
    this.y += 2;
  }

  bullets(items: string[]) {
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(10);
    items.forEach((item, i) => {
      const lines = this.doc.splitTextToSize(`${i + 1}. ${item}`, PAGE_WIDTH - MARGIN_X * 2 - 4);
      for (const line of lines) {
        this.ensureSpace(5);
        this.doc.text(line, MARGIN_X + 2, this.y);
        this.y += 5;
      }
    });
    this.y += 2;
  }
}

export const exportResponseToPdf = (data: StructuredPayload, plainText?: string) => {
  const builder = new PdfBuilder();
  const { doc } = builder;

  // Header
  doc.setFillColor(178, 34, 52);
  doc.rect(0, 0, PAGE_WIDTH, 14, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Baurecht GPT', MARGIN_X, 9);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    new Date().toLocaleString('de-DE', { dateStyle: 'long', timeStyle: 'short' }),
    PAGE_WIDTH - MARGIN_X,
    9,
    { align: 'right' }
  );
  doc.setTextColor(0);
  builder.y = MARGIN_TOP;

  if (data.antwort) {
    builder.heading('Antwort');
    builder.paragraph(data.antwort);
  }
  if (data.sachverhalt) {
    builder.heading('Sachverhalt');
    builder.paragraph(data.sachverhalt);
  }
  if (data.zusammenfassung) {
    builder.heading('Zusammenfassung');
    builder.paragraph(data.zusammenfassung);
  }
  if (data.gesamtbeurteilung) {
    builder.heading('Gesamtbeurteilung');
    builder.paragraph(data.gesamtbeurteilung);
  }
  if (Array.isArray(data.rechtsgrundlage) && data.rechtsgrundlage.length > 0) {
    builder.heading('Rechtsgrundlage');
    builder.bullets(
      data.rechtsgrundlage.map((r) =>
        [r.paragraph, r.quelle].filter(Boolean).join(' — ') || stringifyValue(r)
      )
    );
  } else if (typeof data.rechtsgrundlage === 'string') {
    builder.heading('Rechtsgrundlage');
    builder.paragraph(data.rechtsgrundlage);
  }
  if (Array.isArray(data.kernargumente) && data.kernargumente.length > 0) {
    builder.heading('Kernargumente');
    builder.bullets(
      data.kernargumente.map((arg) => {
        if (typeof arg === 'string') return arg;
        return [arg.punkt, arg.argument, arg.rechtsgrundlage].filter(Boolean).join(' — ');
      })
    );
  }
  if (Array.isArray(data.analyse_der_forderungen) && data.analyse_der_forderungen.length > 0) {
    builder.heading('Analyse der Forderungen');
    data.analyse_der_forderungen.forEach((f, i) => {
      builder.paragraph(
        `${i + 1}. ${f.forderung || ''}${f.bewertung ? ` [${f.bewertung}]` : ''}\n${f.begruendung || ''}`
      );
    });
  }
  if (data.ergebnis) {
    builder.heading('Ergebnis');
    builder.paragraph(data.ergebnis);
  }
  if (data.naechste_schritte) {
    builder.heading('Nächste Schritte');
    const items = Array.isArray(data.naechste_schritte) ? data.naechste_schritte : [data.naechste_schritte];
    builder.bullets(items);
  }
  if (data.fehlende_informationen) {
    builder.heading('Fehlende Informationen');
    builder.paragraph(data.fehlende_informationen);
  }
  if (data.wichtiger_hinweis) {
    builder.heading('Wichtiger Hinweis');
    builder.paragraph(data.wichtiger_hinweis);
  }
  if (data.entwurf_stellungnahme) {
    builder.heading('Entwurf Stellungnahme');
    builder.paragraph(data.entwurf_stellungnahme);
  }
  if (data.antwortschreiben_entwurf) {
    builder.heading('Antwortschreiben Entwurf');
    builder.paragraph(data.antwortschreiben_entwurf);
  }
  const quellen = Array.isArray(data.quellen) ? data.quellen : [];
  if (quellen.length > 0) {
    builder.heading('Quellen');
    builder.bullets(quellen.map((q) => stringifyValue(q)));
  }

  // If nothing rendered, fall back to plain text
  if (builder.y === MARGIN_TOP && plainText) {
    builder.heading('Antwort');
    builder.paragraph(plainText);
  }

  builder.addFooter();

  const filename = `baurecht-gpt-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.pdf`;
  doc.save(filename);
};

export const countSources = (data: StructuredPayload | null): number => {
  if (!data) return 0;
  let count = 0;
  if (Array.isArray(data.quellen)) count += data.quellen.length;
  else if (typeof data.quellen === 'string' && data.quellen.trim()) count += 1;
  if (Array.isArray(data.rechtsgrundlage)) count += data.rechtsgrundlage.length;
  else if (typeof data.rechtsgrundlage === 'string' && data.rechtsgrundlage.trim()) count += 1;
  return count;
};
