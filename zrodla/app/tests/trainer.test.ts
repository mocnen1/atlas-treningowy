import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggest, contextKey, weightStep, type HSession, type HSet } from '../src/shared/trainer';
import { packHistory, unpackHistory } from '../src/shared/transfer';

const S = (d: string, c: string, sets: HSet[], n = c): HSession => ({ d, c, n, s: sets });
const w = (kg: number | null, reps: number, rpe: number | null, alt?: number): HSet => (alt == null ? [kg, reps, rpe, 0] : [kg, reps, rpe, 0, alt]);

test('trener: bez 3 ocenionych treningów nie podpowiada, liczy postęp osobno dla planu i innych', () => {
  const r = suggest([S('2026-10-01', 'klata', [w(60, 10, 8)]), S('2026-10-03', 'plecy', [w(70, 10, 8)])], 'klata', [8, 12], false, 2.5);
  assert.equal(r.suggestion, null); assert.equal(r.ctxRated, 1); assert.equal(r.otherRated, 1);
});

test('trener: z tego planu – podwójna progresja w zakresie i krok ciężaru z historii', () => {
  const hist = [
    S('2026-10-01', 'klata', [w(60, 10, 8), w(60, 9, 9)]),
    S('2026-10-08', 'klata', [w(60, 11, 8), w(60, 10, 9)]),
    S('2026-10-15', 'klata', [w(62.5, 12, 8), w(62.5, 11, 9)]),
    S('2026-10-17', 'plecy', [w(70, 12, 7)]), // inny plan: nie wpływa
  ];
  const r = suggest(hist, 'klata', [8, 12], false, 5).suggestion!;
  assert.equal(r.level, 'plan');
  assert.equal(r.kg, 65, '62,5 × 12 przy zapasie 2 na górze zakresu → +2,5 kg (krok z historii, nie domyślne 5)');
  assert.equal(r.reps, 8);
  assert.equal(r.from.d, '2026-10-15');
});

test('trener: reguły wg zapasu powtórzeń', () => {
  const mk = (top: HSet) => [S('2026-10-01', 'a', [w(50, 8, 8)]), S('2026-10-02', 'a', [w(50, 8, 8)]), S('2026-10-03', 'a', [top])];
  const g = (top: HSet) => suggest(mk(top), 'a', [8, 12], false, 2.5).suggestion!;
  assert.deepEqual([g(w(50, 9, 7)).kg, g(w(50, 9, 7)).reps], [50, 11], 'za lekko: +2 powtórzenia');
  assert.deepEqual([g(w(50, 9, 8)).kg, g(w(50, 9, 8)).reps], [50, 10], 'zapas 2: +1 powtórzenie');
  assert.deepEqual([g(w(50, 9, 9)).kg, g(w(50, 9, 9)).reps], [50, 9], 'zapas 1: powtórz');
  assert.deepEqual([g(w(50, 12, 9)).kg, g(w(50, 12, 9)).reps], [52.5, 8], 'zapas 1 na górze zakresu: +krok');
  assert.deepEqual([g(w(50, 6, 10)).kg, g(w(50, 6, 10)).reps], [47.5, 8], 'upadek poniżej zakresu: −krok');
});

test('trener: 1–2 treningi z tego planu → wstępnie, na podstawie ostatniego z tego planu', () => {
  const hist = [S('2026-10-01', 'plecy', [w(70, 10, 8)]), S('2026-10-05', 'plecy', [w(70, 11, 8)]), S('2026-10-08', 'klata', [w(55, 10, 8)])];
  const r = suggest(hist, 'klata', [8, 12], false, 2.5).suggestion!;
  assert.equal(r.level, 'mixed'); assert.equal(r.kg, 55); assert.equal(r.reps, 11);
});

test('trener: szacunek z innego planu z korektą między planami', () => {
  const hist = [
    S('2026-10-01', 'plecy', [w(70, 10, 8)], 'Plecy'), S('2026-10-08', 'plecy', [w(70, 10, 8)], 'Plecy'), S('2026-10-15', 'plecy', [w(70, 11, 8)], 'Plecy'),
    S('2026-10-10', 'klata', [w(56, 10, null)], 'Klata'), // w planie klatki był raz, bez oceny: ok. 80% wyników z pleców
  ];
  const r = suggest(hist, 'klata', [8, 12], false, 2.5).suggestion!;
  assert.equal(r.level, 'other');
  assert.ok(r.factor! > 0.75 && r.factor! < 0.85, `współczynnik ${r.factor}`);
  assert.ok(r.kg! >= 55 && r.kg! <= 57.5, `cel ${r.kg}`);
  assert.match(r.reason, /Plecy/);
  const r2 = suggest(hist.slice(0, 3), 'nowy', [8, 12], false, 2.5).suggestion!;
  assert.equal(r2.factor, 1); assert.equal(r2.kg, 70); assert.match(r2.reason, /bez korekty/);
});

test('trener: spadek formy na dwóch treningach blokuje podnoszenie ciężaru', () => {
  const hist = [S('2026-10-01', 'a', [w(100, 10, 8)]), S('2026-10-08', 'a', [w(100, 9, 8)]), S('2026-10-15', 'a', [w(100, 12, 9.5)])];
  // ostatni (15.10) jest najlepszy → bez ostrzeżenia
  assert.equal(suggest(hist, 'a', [8, 12], false, 2.5).suggestion!.warn, null);
  const down = [S('2026-10-01', 'a', [w(100, 12, 8)]), S('2026-10-08', 'a', [w(100, 11, 8.5)]), S('2026-10-15', 'a', [w(100, 12, 10)])];
  const r = suggest([...down.slice(0, 2), S('2026-10-15', 'a', [w(100, 9, 8)])], 'a', [8, 9], false, 2.5).suggestion!;
  assert.ok(r.warn); assert.equal(r.kg, 100);
});

test('trener: masa ciała i dwa warianty – progres w pełnych powtórzeniach', () => {
  const hist = [S('2026-10-01', 'b', [w(null, 1, 9, 9)]), S('2026-10-08', 'b', [w(null, 2, 8, 8)]), S('2026-10-15', 'b', [w(null, 4, 8, 6)])];
  const r = suggest(hist, 'b', [10, 10], true, 2.5).suggestion!;
  assert.equal(r.kg, null); assert.equal(r.reps, 5); assert.equal(r.repsAlt, 5, 'łącznie 10 jak ostatnio, ale 5 pełnych');
});

test('kontekst: plan, a bez planu plan o tej samej nazwie albo nazwa', () => {
  const plans = [{ id: 'p1', name: 'Nogi' }];
  assert.equal(contextKey('p9', 'Nogi', plans), 'p9');
  assert.equal(contextKey(null, ' nogi ', plans), 'p1');
  assert.equal(contextKey(null, 'Dupa', plans), 'n:dupa');
  assert.equal(contextKey(null, '', plans), 'x');
});

test('krok ciężaru i zwarta historia do kodów QR', () => {
  assert.equal(weightStep([S('2026-01-01', 'a', [w(40, 8, 8), w(42, 8, 8), w(45, 8, 8)])], 2.5), 2);
  assert.equal(weightStep([S('2026-01-01', 'a', [w(40, 8, 8)])], 2.5), 2.5);
  const h = { bench: [S('2026-10-15', 'p1', [[60, 10, 8, 0], [20, 10, null, 1], [null, 1, 9, 0, 9]], 'Klata')] };
  assert.deepEqual(unpackHistory(packHistory(h)), h);
});
