import { expect, test } from 'bun:test';
import { DictationSend } from './dictationSend';

function setup(text = '', files: string[] = []) {
  const box = { text, files, intent: 'schreiben' };
  const sent: typeof box[] = [];
  let stops = 0;
  let errors = 0;
  const send = new DictationSend({
    changed: () => {},
    send: () => {
      if (!box.text.trim() && !box.files.length) return;
      sent.push({ ...box, files: [...box.files] });
      box.text = '';
      box.files = [];
    },
    incomplete: () => { errors++; },
  });
  const recorder = {
    stop: () => { stops++; },
    text: (text: string) => { box.text += `${box.text ? ' ' : ''}${text}`; },
    done: (failed = 0) => { send.complete(failed); send.flush(false); },
  };
  return { box, sent, send, recorder, stops: () => stops, errors: () => errors };
}

test('Send during recording stops once and sends only after all final words arrive', () => {
  const f = setup('Bitte prüfen:');
  f.send.request('recording', f.recorder.stop);
  f.send.request('converting', f.recorder.stop);
  expect(f.stops()).toBe(1);
  expect(f.sent).toHaveLength(0);
  f.recorder.text('das Bauamt und die letzten Worte');
  f.recorder.done();
  f.recorder.done();
  expect(f.sent.map(s => s.text)).toEqual(['Bitte prüfen: das Bauamt und die letzten Worte']);
  expect(f.box.text).toBe('');
});

test('typing, current attachment and choice during conversion are included', () => {
  const f = setup('Anfang');
  f.send.request('converting', f.recorder.stop);
  f.box.text += ' Notiz';
  f.box.files = ['brief.pdf'];
  f.box.intent = 'quelle';
  f.recorder.text('Schluss');
  f.recorder.done();
  expect(f.sent).toEqual([{ text: 'Anfang Notiz Schluss', files: ['brief.pdf'], intent: 'quelle' }]);
  expect(f.stops()).toBe(0);
});

test('Nicht senden keeps the text and sends nothing', () => {
  const f = setup('Bitte prüfen:');
  f.send.request('recording', f.recorder.stop);
  f.send.cancel();
  f.recorder.text('vollständiges Diktat');
  f.recorder.done();
  expect(f.sent).toHaveLength(0);
  expect(f.box.text).toBe('Bitte prüfen: vollständiges Diktat');
});

test('failed segment cancels automatic send and reports incomplete dictation', () => {
  const f = setup('Teiltext');
  f.send.request('converting', f.recorder.stop);
  f.recorder.done(1);
  expect(f.sent).toHaveLength(0);
  expect(f.errors()).toBe(1);
  expect(f.box.text).toBe('Teiltext');
  expect(f.send.pending).toBe(false);
});

test('silence without text or attachment sends nothing without error', () => {
  const f = setup();
  f.send.request('recording', f.recorder.stop);
  f.recorder.done();
  expect(f.sent).toHaveLength(0);
  expect(f.errors()).toBe(0);
  expect(f.send.pending).toBe(false);
});

test('normal Send is unchanged', () => {
  const f = setup('Normale Frage', ['datei.pdf']);
  f.send.request('idle', f.recorder.stop);
  expect(f.sent[0]?.text).toBe('Normale Frage');
  expect(f.sent[0]?.files).toEqual(['datei.pdf']);
  expect(f.stops()).toBe(0);
});

test('completion waits for attachment preparation or a full answer queue', () => {
  const f = setup('Frage');
  f.send.request('converting', f.recorder.stop);
  f.send.complete(0);
  f.send.flush(true);
  expect(f.sent).toHaveLength(0);
  f.send.flush(false);
  expect(f.sent).toHaveLength(1);
});