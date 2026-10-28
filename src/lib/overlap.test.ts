import { expect, test } from 'bun:test';
import { joinOverlap, mergeIntoBox } from './overlap';

test('mid-word fragments with no shared run of 2: nothing removed', () => {
  const r = joinOverlap('… dass wir das Bauamt fra', 'amt fragen sollten, ob …');
  expect(r).toEqual({ prev: '… dass wir das Bauamt fra', next: 'amt fragen sollten, ob …' });
});

test('2 s overlap joins at the shared run', () => {
  const r = joinOverlap('… dass wir das Bauamt fragen sol', 'Bauamt fragen sollten, ob …');
  expect(`${r.prev} ${r.next}`).toBe('… dass wir das Bauamt fragen sollten, ob …');
});

test('user typed after the earlier text: box kept, only shared words dropped', () => {
  const box = '… dass wir das Bauamt fragen sol Notiz';
  const out = mergeIntoBox(box, '… dass wir das Bauamt fragen sol', 'Bauamt fragen sollten, ob …');
  expect(out).toBe('… dass wir das Bauamt fragen sol Notiz sollten, ob …');
});
