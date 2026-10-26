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
  const weak = [S('2026-10-01', 'a', [w(50, 7, 9.5)]), S('2026-10-02', 'a', [w(50, 7, 9.5)]), S('2026-10-03', 'a', [w(50, 6, 10)])];
  const f = suggest(weak, 'a', [8, 12], false, 2.5).suggestion!;
  assert.deepEqual([f.kg, f.reps], [47.5, 8], 'upadek poniżej zakresu (bez wyraźnie lepszych treningów wcześniej): −krok');
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

test('dopasowanie: trzy przebite cele → szybciej, dwa nietrafione → wolniej', () => {
  const T = (kg: number, reps: number): [number, number, null, number] => [kg, reps, null, 8];
  const beat = [
    { ...S('2026-10-01', 'a', [w(50, 11, 8)]), t: T(50, 9) },
    { ...S('2026-10-08', 'a', [w(52.5, 11, 8)]), t: T(52.5, 9) },
    { ...S('2026-10-15', 'a', [w(55, 12, 8)]), t: T(55, 9) },
  ];
  const f = suggest(beat, 'a', [8, 12], false, 2.5).suggestion!;
  assert.equal(f.pace, 'fast'); assert.deepEqual(f.outcomes, ['beat', 'beat', 'beat']);
  assert.equal(f.kg, 60, '55 × 12 na górze zakresu: zamiast +2,5 kg → +5 kg (≤ 10% ciężaru)');
  const miss = [
    { ...S('2026-10-01', 'a', [w(50, 10, 8)]), t: T(50, 10) },
    { ...S('2026-10-08', 'a', [w(52.5, 7, 9)]), t: T(52.5, 8) },
    { ...S('2026-10-15', 'a', [w(52.5, 8, 9)]), t: T(52.5, 9) },
  ];
  const sl = suggest(miss, 'a', [8, 12], false, 2.5).suggestion!;
  assert.equal(sl.pace, 'slow'); assert.deepEqual([sl.kg, sl.reps], [52.5, 8], 'zapas 1, poniżej góry zakresu: powtórz wynik');
  const sl2 = suggest([...miss.slice(0, 2), { ...S('2026-10-15', 'a', [w(52.5, 9, 8)]), t: T(52.5, 10) }], 'a', [8, 12], false, 2.5).suggestion!;
  assert.equal(sl2.pace, 'slow'); assert.equal(sl2.reps, 9, 'zapas 2 normalnie +1 powtórzenie; przy wolniejszym tempie powtórz');
});

test('dopasowanie: słabszy dzień – cel z przedostatniego treningu', () => {
  const h = [S('2026-10-01', 'a', [w(80, 10, 8)]), S('2026-10-08', 'a', [w(80, 11, 8)]), S('2026-10-15', 'a', [w(80, 7, 9)])];
  const g = suggest(h, 'a', [8, 12], false, 2.5).suggestion!;
  assert.equal(g.from.d, '2026-10-08'); assert.deepEqual([g.kg, g.reps], [80, 12]); assert.equal(g.warn, null);
  assert.match(g.reason, /słabszy/);
});

test('dopasowanie: korekta skali trudności z serii do upadku', async () => {
  const { calibrateRir } = await import('../src/shared/trainer');
  // użytkownik ocenia „2 w zapasie”, a upadek kilka dni później pokazuje, że zostawało ok. 4
  const ss = (d: string, x: HSet) => S(d, 'a', [x]);
  const byEx = {
    bench: [ss('2026-10-01', w(80, 8, 8)), ss('2026-10-04', w(80, 12, 10)), ss('2026-10-08', w(80, 8, 8)), ss('2026-10-11', w(80, 12, 10))],
    row: [ss('2026-10-02', w(60, 8, 8)), ss('2026-10-05', w(60, 12, 10)), ss('2026-10-09', w(60, 8, 8))],
  };
  const c = calibrateRir(byEx);
  assert.ok(c.pairs >= 4, `porównań: ${c.pairs}`);
  assert.equal(c.offset, 1.5, 'zostaje ok. 4 zamiast 2 → korekta ograniczona do +1,5');
  assert.deepEqual(calibrateRir({ bench: byEx.bench.slice(0, 2) }), { offset: 0, pairs: 1 }, 'za mało porównań – bez korekty');
  // z korektą „2 w zapasie” traktowane jak 3,5 → za lekko → +2 powtórzenia zamiast +1
  const h = [ss('2026-10-01', w(80, 9, 8)), ss('2026-10-08', w(80, 9, 8)), ss('2026-10-15', w(80, 9, 8))];
  assert.equal(suggest(h, 'a', [8, 12], false, 2.5).suggestion!.reps, 10);
  const g = suggest(h, 'a', [8, 12], false, 2.5, { rirOffset: 1.5 }).suggestion!;
  assert.equal(g.reps, 11); assert.match(g.reason, /Korekta Twojej skali/);
});

test('zwarta historia przenosi cel trenera', () => {
  const h = { bench: [{ ...S('2026-10-15', 'p1', [[60, 10, 8, 0]], 'Klata'), t: [62.5, 8, null, 8] as [number, number, null, number] }] };
  assert.deepEqual(unpackHistory(packHistory(h)), h);
});

test('telefon: cel trenera zapisany przy ćwiczeniu i wysyłany do komputera', async () => {
  const { emptyState, startWorkout, toTransfer } = await import('../src/phone/state');
  const s = { ...emptyState(), hist: { press: [S('2026-10-01', 'P1', [w(60, 10, 8)]), S('2026-10-08', 'P1', [w(60, 11, 8)]), S('2026-10-15', 'P1', [w(60, 12, 8)])] } };
  const wk = startWorkout(s, { id: 'P1', name: 'Klata', exercises: [{ exerciseId: 'press', sets: 2, repsMin: 8, repsMax: 12, restSec: 90, notes: '' }, { exerciseId: 'nowe', sets: 1, repsMin: 8, repsMax: 12, restSec: 90, notes: '' }] });
  assert.deepEqual(wk.exercises[0].tgt, [62.5, 8, null, 8]);
  assert.equal(wk.exercises[1].tgt, null, 'bez historii brak celu');
  assert.equal(wk.exercises[0].sets[0].kg, 60, 'serie startują od ostatniego wyniku w tym planie');
  wk.exercises[0].sets[0].doneAt = Date.now(); wk.endedAt = Date.now();
  const t = toTransfer(wk);
  assert.deepEqual(t.exercises[0].t, [62.5, 8, null, 8]); assert.equal(t.planId, 'P1');
});
