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
  assert.deepEqual([wk.exercises[0].sets[0].kg, wk.exercises[0].sets[0].reps], [62.5, 8], 'pewny cel (3 treningi z tego planu) od razu w seriach');
  const { setsAtTarget, fillSets } = await import('../src/phone/state');
  assert.ok(setsAtTarget(wk.exercises[0]));
  const back = { ...wk.exercises[0], sets: fillSets(wk.exercises[0], [60, 12, null]) };
  assert.ok(!setsAtTarget(back)); assert.equal(back.sets[1].reps, 12);
  const s2 = { ...s, hist: { press: s.hist.press.slice(0, 2) } };
  const w2 = startWorkout(s2, { id: 'P1', name: 'Klata', exercises: [{ exerciseId: 'press', sets: 1, repsMin: 8, repsMax: 12, restSec: 90, notes: '' }] });
  assert.equal(w2.exercises[0].sets[0].kg, 60, 'bez pewnego celu serie zostają z ostatnim wynikiem w tym planie');
  wk.exercises[0].sets[0].doneAt = Date.now(); wk.endedAt = Date.now();
  const t = toTransfer(wk);
  assert.deepEqual(t.exercises[0].t, [62.5, 8, null, 8]); assert.equal(t.planId, 'P1');
});

test('seria po serii: każda seria porównana z tą samą serią poprzednio', () => {
  const sess = (d: string, sets: HSet[]) => S(d, 'a', sets);
  const h = [
    sess('2026-10-01', [w(60, 11, 8), w(60, 9, 9), w(60, 7, 10)]),
    sess('2026-10-08', [w(60, 12, 8), w(60, 10, 9), w(60, 8, 10)]),
    sess('2026-10-15', [w(60, 12, 8), w(60, 10, 9), w(60, 8, 10)]),
  ];
  const g = suggest(h, 'a', [8, 12], false, 2.5).suggestion!;
  assert.deepEqual(g.sets.map(x => [x.kg, x.reps]), [[62.5, 8], [60, 10], [60, 8]],
    'seria 1 na górze zakresu przy zapasie 2 → +2,5 kg; seria 2 przy zapasie 1 → powtórz; seria 3 do upadku, ale w normie dla 3. serii → powtórz');
  assert.equal(g.kg, 62.5); assert.equal(g.reps, 8);
  const g4 = suggest(h, 'a', [8, 12], false, 2.5, { nSets: 4 }).suggestion!;
  assert.equal(g4.sets.length, 4);
  assert.ok(g4.sets[3].was.estimated); assert.deepEqual([g4.sets[3].kg, g4.sets[3].reps], [60, 6], 'czwarta seria: szacunek z typowego spadku (2 powt.)');
  const g2 = suggest(h, 'a', [8, 12], false, 2.5, { nSets: 2 }).suggestion!;
  assert.equal(g2.sets.length, 2);
});

test('seria po serii: seria bez oceny dostaje trudność z sąsiedniej (+0,5 na serię)', () => {
  const h = [S('2026-10-01', 'a', [w(50, 10, 8), w(50, 9, null)]), S('2026-10-08', 'a', [w(50, 10, 8), w(50, 9, null)]), S('2026-10-15', 'a', [w(50, 10, 8), w(50, 9, null)])];
  const g = suggest(h, 'a', [8, 12], false, 2.5).suggestion!;
  assert.equal(g.sets[1].was.rpe, 8.5); assert.equal(g.sets[1].reps, 10, 'zapas 1,5 → +1 powtórzenie');
});

test('seria po serii: wynik względem celów liczony dla każdej serii', async () => {
  const { outcome, setOutcome } = await import('../src/shared/trainer');
  const t1: [number, number, null, number] = [62.5, 8, null, 8], t2: [number, number, null, number] = [60, 10, null, 9];
  const ok = { ...S('2026-10-22', 'a', [w(62.5, 8, 8), w(60, 10, 9)]), ts: [t1, t2] };
  assert.equal(outcome(ok), 'hit');
  // seria 2 słabsza niż kiedykolwiek, ale stara metoda (najlepsza seria vs jeden cel) uznałaby to za trafienie
  const weak2 = { ...S('2026-10-22', 'a', [w(62.5, 8, 8), w(60, 6, 10)]), ts: [t1, t2] };
  assert.equal(setOutcome(weak2.s[1], t2), 'miss');
  assert.equal(outcome(weak2), 'miss');
  assert.equal(outcome({ ...weak2, ts: undefined, t: t1 }), 'hit');
});

test('zwarta historia przenosi cele dla serii', () => {
  const h = { bench: [{ ...S('2026-10-15', 'p1', [[60, 10, 8, 0], [60, 9, 9, 0]], 'Klata'), t: [62.5, 8, null, 8] as [number, number, null, number], ts: [[62.5, 8, null, 8], [60, 10, null, 9]] as [number, number, null, number][] }],
    row: [{ ...S('2026-10-15', 'p1', [[60, 10, 8, 0]], 'Klata'), ts: [[62.5, 8, null, 8]] as [number, number, null, number][] }] };
  assert.deepEqual(unpackHistory(packHistory(h)), h);
});

test('telefon: serie startują seria po serii, cele dla każdej serii idą do komputera', async () => {
  const { emptyState, startWorkout, toTransfer, fillSets, setsAtTarget, lastSetsInContext } = await import('../src/phone/state');
  const three = (d: string): HSession => S(d, 'P1', [[20, 10, null, 1], w(60, 12, 8), w(60, 10, 9), w(60, 8, 10)]);
  const s = { ...emptyState(), hist: { press: [three('2026-10-01'), three('2026-10-08'), three('2026-10-15')] } };
  const wk = startWorkout(s, { id: 'P1', name: 'Klata', exercises: [{ exerciseId: 'press', sets: 3, repsMin: 8, repsMax: 12, restSec: 90, notes: '' }] });
  const e = wk.exercises[0];
  assert.deepEqual(e.tgts, [[62.5, 8, null, 8], [60, 10, null, 9], [60, 8, null, 9]]);
  assert.deepEqual(e.sets.map(x => [x.kg, x.reps]), [[62.5, 8], [60, 10], [60, 8]], 'każda seria swój cel');
  assert.ok(setsAtTarget(e));
  const last = lastSetsInContext(s, 'press', 'P1')!.sets;
  const back = { ...e, sets: fillSets(e, last) };
  assert.deepEqual(back.sets.map(x => [x.kg, x.reps]), [[60, 12], [60, 10], [60, 8]], 'powrót: seria 1 = seria 1 poprzednio itd. (rozgrzewka pominięta)');
  // trening bez pewnych celów: serie startują od tych samych serii poprzednio
  const s1 = { ...s, hist: { press: [three('2026-10-15')] } };
  const w1 = startWorkout(s1, { id: 'P1', name: 'Klata', exercises: [{ exerciseId: 'press', sets: 4, repsMin: 8, repsMax: 12, restSec: 90, notes: '' }] });
  assert.deepEqual(w1.exercises[0].sets.map(x => [x.kg, x.reps]), [[60, 12], [60, 10], [60, 8], [60, 8]]);
  e.sets[0].doneAt = Date.now(); wk.endedAt = Date.now();
  assert.deepEqual(toTransfer(wk).exercises[0].ts, e.tgts);
});
