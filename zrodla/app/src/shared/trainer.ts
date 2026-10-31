// Trener: podpowiedź ciężaru i powtórzeń na kolejny trening, liczona osobno dla każdego planu treningowego.
//
// Dlaczego osobno: to samo ćwiczenie w innym planie robione jest po innych ćwiczeniach (np. wyciskanie na
// maszynie po klatce vs. na plecach), więc mięśnie są inaczej zmęczone i realny ciężar roboczy jest inny.
//
// Dane: sesje ćwiczenia (data, plan/kontekst, serie: kg, powtórzenia, trudność RPE, rozgrzewka, wariant łatwiejszy)
// oraz cel, który trener podał przed tym treningiem (jeśli był).
//
// Poziomy pewności:
//   'plan'  – co najmniej TRAINER_MIN_SESSIONS ocenionych treningów z tego planu,
//   'mixed' – 1–2 ocenione z tego planu (decyduje ostatni z nich), razem z innymi planami co najmniej próg,
//   'other' – brak ocenionych z tego planu; szacunek z innego planu przeliczony współczynnikiem między planami.
//
// Reguły podstawowe (autoregulacja wg zapasu powtórzeń + podwójna progresja w zakresie powtórzeń z planu):
//   zapas ≥ 3 (RPE ≤ 7)   – za lekko: +2 powtórzenia, a na górze zakresu +1 krok ciężaru,
//   zapas 2 (RPE ≤ 8,5)   – górna granica zakresu → +1 krok ciężaru i dół zakresu; inaczej +1 powtórzenie,
//   zapas 1 (RPE ≤ 9,5)   – górna granica → +1 krok; inaczej powtórz wynik,
//   upadek (RPE 10)       – poniżej dołu zakresu → −1 krok; inaczej powtórz wynik.
//
// Dopasowanie do osoby (włącza się samo, gdy jest dość danych):
//   0. Seria po serii: seria 1 porównywana z serią 1 poprzednio, seria 2 z serią 2 itd. (dalsze serie są słabsze
//      ze zmęczenia, więc mają własne cele). Gdy dziś jest więcej serii niż wtedy – szacunek z typowego spadku między seriami.
//   1. Tempo: wynik ostatnich 3 treningów z celem (przebity / trafiony / nietrafiony). 3 × przebity → szybciej
//      (podwójny krok ciężaru albo +1 powtórzenie więcej); 2 z 3 nietrafione → wolniej (bez dokładania, aż cel wejdzie).
//   2. Skala trudności: porównanie ocen „X w zapasie” z seriami do upadku tym samym ćwiczeniem w ciągu 14 dni.
//      Jeśli zwykle zostaje więcej (lub mniej) powtórzeń, niż oceniasz – korekta zapasu (od 4 porównań, maks. ±1,5).
//   3. Słabszy dzień: ostatni trening wyraźnie gorszy od dwóch poprzednich (≥ 5%) → cel liczony z przedostatniego.
//      Dwa spadki z rzędu (łącznie > 3%) to już trend: bez podnoszenia ciężaru i ostrzeżenie.
import { TRAINER_MIN_SESSIONS } from './effort';

/** Seria w historii: [kg, powtórzenia, RPE, rozgrzewka 0/1, powtórzenia w łatwiejszym wariancie] */
export type HSet = [kg: number | null, reps: number | null, rpe: number | null, warm: 0 | 1, repsAlt?: number | null];
/** Cel trenera podany przed treningiem: [kg, powtórzenia, powtórzenia łatwiejsze, docelowe RPE] */
export type HTarget = [kg: number | null, reps: number, repsAlt: number | null, rpe: number];
/** Jedno wykonanie ćwiczenia: data YYYY-MM-DD, klucz kontekstu (plan), nazwa kontekstu do wyświetlenia, serie, cel trenera */
export interface HSession {
  d: string; c: string; n: string; s: HSet[];
  /** Cel trenera dla najlepszej serii (starsze wersje) */
  t?: HTarget | null;
  /** Cele trenera dla kolejnych serii roboczych (seria 1, 2, 3…) */
  ts?: HTarget[] | null;
}

/** Klucz kontekstu treningu: identyfikator planu, a dla treningu bez planu – plan o tej samej nazwie albo sama nazwa. */
export function contextKey(planId: string | null | undefined, name: string, plans: { id: string; name: string }[] = []): string {
  if (planId) return planId;
  const n = normName(name);
  const p = n ? plans.find(x => normName(x.name) === n) : undefined;
  return p ? p.id : n ? 'n:' + n : 'x';
}
export const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

const work = (s: HSession) => s.s.filter(x => !x[3] && ((x[1] ?? 0) > 0 || (x[4] ?? 0) > 0));
const isRated = (s: HSession) => work(s).some(x => x[2] != null);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const median = (a: number[]) => { const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };

/**
 * Szacowany 1RM z uwzględnieniem zapasu powtórzeń (bez oceny zakładamy zapas 1); `off` = korekta skali (+ = zwykle zostaje więcej).
 * Dla masy ciała: powtórzenia + zapas. Łatwiejszy wariant liczy się za pół powtórzenia.
 */
export function capacity(x: HSet, off = 0): number {
  const rir = x[2] != null ? Math.max(0, 10 - x[2] + off) : 1;
  const reps = (x[1] ?? 0) + (x[4] ?? 0) * 0.5;
  return x[0] ? x[0] * (1 + (reps + rir) / 30) : reps + rir;
}
const sessionCap = (s: HSession, off = 0) => Math.max(0, ...work(s).map(x => capacity(x, off)));
const targetCap = (t: HTarget) => capacity([t[0], t[1], t[3], 0, t[2]]);

/** Krok ciężaru: najmniejsza różnica między użytymi ciężarami (0,5–10 kg), inaczej wartość domyślna. */
export function weightStep(sessions: HSession[], fallback: number): number {
  const kg = [...new Set(sessions.flatMap(s => work(s).map(x => x[0]).filter((v): v is number => !!v)))].sort((a, b) => a - b);
  let step = Infinity;
  for (let i = 1; i < kg.length; i++) { const d = Math.round((kg[i] - kg[i - 1]) * 100) / 100; if (d >= 0.5 && d < step) step = d; }
  return step <= 10 ? step : fallback;
}

export type Outcome = 'beat' | 'hit' | 'miss';
const verdict = (r: number): Outcome => (r >= 1.03 ? 'beat' : r <= 0.98 ? 'miss' : 'hit');
/** Wynik pojedynczej serii względem jej celu (seria bez oceny trudności: zakładamy zapas 1). */
export function setOutcome(x: HSet | undefined, t: HTarget | undefined, off = 0): Outcome | null {
  if (!x || !t) return null;
  return verdict(capacity(x, off) / targetCap(t));
}
/**
 * Jak poszło względem celów trenera. Przy celach dla serii: średnia z porównań seria 1 ↔ cel 1, seria 2 ↔ cel 2…
 * (szacowany 1RM z uwzględnieniem zapasu, próg ±2–3%). Starszy zapis: najlepsza seria ↔ jeden cel.
 */
export function outcome(s: HSession, off = 0): Outcome | null {
  const ws = work(s);
  if (!ws.some(x => x[2] != null)) return null;
  if (s.ts?.length) {
    const r = s.ts.map((t, i) => (ws[i] ? capacity(ws[i], off) / targetCap(t) : null)).filter((v): v is number => v != null);
    return r.length ? verdict(r.reduce((a, b) => a + b, 0) / r.length) : null;
  }
  if (!s.t) return null;
  return verdict(sessionCap(s, off) / targetCap(s.t));
}

/**
 * Korekta skali trudności: dla serii z oceną (zapas 0,5–4) i serii do upadku tym samym ćwiczeniem w ciągu 14 dni
 * porównujemy zapas oceniony z wynikającym z upadku. Mediana różnic, gdy jest co najmniej 4 porównań.
 */
export function calibrateRir(byEx: Record<string, HSession[]>): { offset: number; pairs: number } {
  const diffs: number[] = [];
  const day = (d: string) => Date.parse(d + 'T12:00:00Z') / 86_400_000;
  for (const ss of Object.values(byEx)) {
    const fails: { d: number; e: number }[] = [];
    for (const s of ss) for (const x of work(s)) if (x[2] === 10 && x[0] && x[1] && x[1] <= 12) fails.push({ d: day(s.d), e: x[0] * (1 + x[1] / 30) });
    if (!fails.length) continue;
    for (const s of ss) {
      const d0 = day(s.d);
      // tylko pierwsza oceniona seria robocza przed upadkiem w tej sesji (świeża, porównywalna z upadkiem z innego dnia)
      const x = work(s).find(y => y[2] != null && y[2] >= 6 && y[2] <= 9.5 && y[0] && y[1] && y[1] <= 12);
      if (!x) continue;
      const near = fails.filter(f => f.d !== d0 && Math.abs(f.d - d0) <= 14);
      if (!near.length) continue;
      const e = median(near.map(f => f.e));
      const trueRir = 30 * (e / x[0]! - 1) - x[1]!;
      diffs.push(trueRir - (10 - x[2]!));
    }
  }
  if (diffs.length < 4) return { offset: 0, pairs: diffs.length };
  const m = clamp(median(diffs), -1.5, 1.5);
  return { offset: Math.abs(m) < 0.5 ? 0 : Math.round(m * 2) / 2, pairs: diffs.length };
}

export type TrainerLevel = 'plan' | 'mixed' | 'other';
export type TrainerPace = 'fast' | 'normal' | 'slow';
export interface Suggestion {
  level: TrainerLevel;
  kg: number | null;
  reps: number;
  /** Przy dwóch wariantach: `reps` = pełne, `repsAlt` = łatwiejsze (cel łącznie co najmniej jak ostatnio) */
  repsAlt: number | null;
  /** Docelowa trudność ostatniej serii (RPE) */
  rpe: number;
  reason: string;
  /** Na czym oparto: data, kontekst, najlepsza seria */
  from: { d: string; n: string; kg: number | null; reps: number | null; repsAlt: number | null; rpe: number | null };
  /** Współczynnik przeliczenia z innego planu (tylko 'other') */
  factor: number | null;
  ctxRated: number; otherRated: number;
  warn: string | null;
  pace: TrainerPace;
  /** Ostatnie wyniki względem celów (od najnowszego) */
  outcomes: Outcome[];
  rirOffset: number;
  /** Cele dla kolejnych serii roboczych (seria 1 = kg/reps powyżej) */
  sets: SetTarget[];
}
export interface SetTarget {
  kg: number | null; reps: number; repsAlt: number | null; rpe: number;
  /** Ta sama seria poprzednio (albo szacunek, gdy wtedy było mniej serii) */
  was: { kg: number | null; reps: number | null; repsAlt: number | null; rpe: number | null; estimated: boolean };
  why: string;
}
export interface TrainerState { suggestion: Suggestion | null; ctxRated: number; otherRated: number }
export interface TrainerOpts {
  rirOffset?: number;
  /** Ile serii roboczych ma ćwiczenie dziś (z planu albo z treningu); domyślnie tyle, ile ostatnio */
  nSets?: number;
}

const fmt = (n: number) => n.toLocaleString('pl-PL', { maximumFractionDigits: 2 });
/** Cel trenera w postaci do zapisu przy ćwiczeniu */
export const toTarget = (g: Suggestion): HTarget => [g.kg, g.reps, g.repsAlt, g.rpe];
/** Cele dla serii w postaci do zapisu */
export const toTargets = (g: Suggestion): HTarget[] => g.sets.map(x => [x.kg, x.reps, x.repsAlt, x.rpe]);

/**
 * Podpowiedź na kolejny trening.
 * @param sessions wszystkie wykonania ćwiczenia (dowolne plany), kolejność dowolna
 * @param ctx klucz kontekstu bieżącego treningu
 * @param range zakres powtórzeń z planu (null = brak planu dla ćwiczenia)
 * @param alt czy ćwiczenie liczy powtórzenia w dwóch wariantach
 * @param defaultStep krok ciężaru, gdy nie da się go odczytać z historii
 */
export function suggest(sessions: HSession[], ctx: string, range: [number | null, number | null] | null, alt: boolean, defaultStep: number, opts: TrainerOpts = {}): TrainerState {
  const off = opts.rirOffset ?? 0;
  const all = [...sessions].filter(s => work(s).length).sort((a, b) => b.d.localeCompare(a.d));
  const ctxS = all.filter(s => s.c === ctx), othS = all.filter(s => s.c !== ctx);
  const ctxR = ctxS.filter(isRated), othR = othS.filter(isRated);
  const ctxRated = ctxR.length, otherRated = othR.length;
  let level: TrainerLevel | null = null;
  if (ctxRated >= TRAINER_MIN_SESSIONS) level = 'plan';
  else if (ctxRated >= 1 && ctxRated + otherRated >= TRAINER_MIN_SESSIONS) level = 'mixed';
  else if (ctxRated === 0 && otherRated >= TRAINER_MIN_SESSIONS) level = 'other';
  if (!level) return { suggestion: null, ctxRated, otherRated };

  const srcRated = level === 'other' ? othR.filter(s => s.c === othR[0].c) : ctxR;
  const series = level === 'other' ? othS.filter(s => s.c === othR[0].c) : ctxS;
  const notes: string[] = [];

  // słabszy dzień / trend (na ocenionych treningach źródła)
  let base = srcRated[0];
  let trend = false;
  const caps = srcRated.slice(0, 3).map(s => sessionCap(s, off));
  if (caps.length === 3) {
    if (caps[0] < caps[1] && caps[1] < caps[2] && caps[0] < caps[2] * 0.97) trend = true;
    else if (caps[0] < 0.95 * (caps[1] + caps[2]) / 2) {
      base = srcRated[1];
      notes.push(`Trening z ${base.d.slice(8, 10)}.${base.d.slice(5, 7)} był wyraźnie słabszy niż dwa wcześniejsze – cel liczony z przedostatniego (jeden gorszy dzień się zdarza).`);
    }
  }

  const ws = work(base);
  const step = weightStep(all, defaultStep);
  // typowy spadek powtórzeń między kolejnymi seriami tym samym ciężarem (ostatnie treningi źródła), domyślnie 1
  const drops: number[] = [];
  for (const s of series.slice(0, 6)) {
    const w = work(s);
    for (let i = 1; i < w.length; i++) if (w[i][0] === w[i - 1][0] && w[i - 1][1] != null && w[i][1] != null) drops.push(w[i - 1][1]! - w[i][1]!);
  }
  const drop = drops.length ? clamp(Math.round(median(drops)), 0, 3) : 1;
  const n = Math.max(1, opts.nSets ?? ws.length);

  /** Seria nr i poprzednio: ta sama seria; bez oceny – trudność z najbliższej ocenionej (+0,5 na każdą serię dalej);
   *  gdy wtedy było mniej serii – ostatnia seria z typowym spadkiem powtórzeń. */
  const prevSet = (i: number): { x: HSet; est: boolean } => {
    if (ws[i]) {
      const x = ws[i];
      if (x[2] != null) return { x, est: false };
      let j = -1, dist = 99;
      ws.forEach((y, k) => { if (y[2] != null && Math.abs(k - i) < dist) { dist = Math.abs(k - i); j = k; } });
      return { x: [x[0], x[1], clamp(ws[j][2]! + 0.5 * (i - j), 5, 10), 0, x[4]], est: false };
    }
    const li = ws.length - 1, p = prevSet(li).x, extra = i - li;
    return { x: [p[0], Math.max(1, (p[1] ?? 0) - drop * extra), clamp((p[2] ?? 9) + 0.5 * extra, 5, 10), 0, p[4]], est: true };
  };

  // tempo: wyniki ostatnich treningów z celem (to ćwiczenie, dowolny plan)
  const outcomes = all.map(s => outcome(s, off)).filter((o): o is Outcome => o != null).slice(0, 3);
  const pace: TrainerPace = outcomes.length === 3 && outcomes.every(o => o === 'beat') ? 'fast'
    : outcomes.length >= 2 && outcomes.filter(o => o === 'miss').length >= 2 ? 'slow' : 'normal';

  // przeliczenie z innego planu: stosunek mediany szacowanego 1RM w tym planie i w planie źródłowym
  let factor: number | null = null;
  if (level === 'other') {
    const here = ctxS.slice(0, 3).map(s => sessionCap(s, off)), there = series.slice(0, 3).map(s => sessionCap(s, off));
    factor = here.length && there.length ? clamp(median(here) / median(there), 0.75, 1.15) : 1;
    notes.push(here.length
      ? `Przeliczone z planu „${base.n}” (w tym planie zwykle ${fmt(Math.round(factor * 100))}% tamtych wyników).`
      : `Szacunek z planu „${base.n}” – w tym planie brak jeszcze ocenionych treningów, bez korekty.`);
  } else if (level === 'mixed') {
    notes.push(`Wstępnie: ${ctxRated} z ${TRAINER_MIN_SESSIONS} ocenionych treningów w tym planie.`);
  }

  const paceNote = { fast: '', slow: '' };
  const sets: SetTarget[] = [];
  for (let i = 0; i < n; i++) {
    const { x, est } = prevSet(i);
    const rpeRaw = x[2]!;
    const rpe = clamp(rpeRaw - off, 4, 10); // trudność po korekcie skali
    const k = x[0] && x[0] > 0 ? x[0] : null, r = x[1] ?? 0, ra = alt ? x[4] ?? 0 : null;
    let lo = range?.[0] ?? null, hi = range?.[1] ?? null;
    if (lo == null && hi == null) { lo = r; hi = r + 2; } else { lo ??= hi!; hi ??= lo; }
    if (hi! < lo!) [lo, hi] = [hi, lo];
    // dolna granica dla zmniejszania ciężaru: dalsze serie mogą naturalnie wypaść niżej (zmęczenie)
    const loDec = Math.max(1, lo! - drop * i);

    let kg = k, reps = r, why = '', aim = 8;
    let change: 'kg+' | 'reps+' | 'same' | 'kg-' = 'same';
    const rir = Math.max(0, 10 - rpeRaw);
    const zap = rir >= 5 ? '5+' : fmt(rir);
    const was = `${est ? 'szacunek ' : ''}${k != null ? fmt(k) + ' kg × ' : ''}${alt ? `${r} + ${ra}` : r} przy ${zap === '0' ? 'upadku' : `zapasie ${zap}`}`;
    if (alt || k == null) {
      // masa ciała / dwa warianty: progres w powtórzeniach (przy wariantach – w pełnych)
      if (rpe <= 7) { reps = r + 2; change = 'reps+'; why = `Ostatnio ${was} – za lekko, +2 ${alt ? 'pełne' : 'powtórzenia'}.`; }
      else if (rpe <= 8.5) { reps = r + 1; change = 'reps+'; why = `Ostatnio ${was} – +1 ${alt ? 'pełne' : 'powtórzenie'}.`; }
      else if (rpe <= 9.5) { aim = 9; why = `Ostatnio ${was} – powtórz wynik, celuj w ten sam lub o 1 lepszy.`; }
      else { aim = 9; why = `Ostatnio ${was} – powtórz wynik, bez dokładania.`; }
    } else if (rpe <= 7) {
      if (r < hi!) { reps = Math.min(hi!, r + 2); change = 'reps+'; why = `Ostatnio ${was} – za lekko, +2 powtórzenia.`; }
      else { kg = k + step; reps = lo!; change = 'kg+'; why = `Ostatnio ${was} na górze zakresu – +${fmt(step)} kg.`; }
    } else if (rpe <= 8.5) {
      if (r >= hi!) { kg = k + step; reps = lo!; change = 'kg+'; why = `Ostatnio ${was} na górze zakresu ${lo}–${hi} – +${fmt(step)} kg i od dołu zakresu.`; }
      else { reps = r + 1; change = 'reps+'; why = `Ostatnio ${was} – ten sam ciężar, +1 powtórzenie.`; }
    } else if (rpe <= 9.5) {
      aim = 9;
      if (r >= hi!) { kg = k + step; reps = lo!; aim = 8; change = 'kg+'; why = `Ostatnio ${was} na górze zakresu – +${fmt(step)} kg i od dołu zakresu.`; }
      else { why = `Ostatnio ${was} – powtórz wynik; jeśli pójdzie lżej, dołóż powtórzenie.`; }
    } else if (r < loDec) {
      kg = Math.max(step, k - step); reps = lo!; change = 'kg-'; why = `Ostatnio ${was}, wyraźnie poniżej zakresu – −${fmt(step)} kg.`;
    } else { aim = 9; why = `Ostatnio ${was} – powtórz wynik zanim dołożysz.`; }

    // tempo dopasowane do Ciebie
    if (pace === 'fast' && !trend) {
      if (change === 'kg+' && k != null && 2 * step <= Math.max(step, k * 0.1)) { kg = k + 2 * step; paceNote.fast = `Trzy ostatnie cele przebite – szybciej (podwójny krok ciężaru albo +1 powtórzenie więcej).`; }
      else if (change === 'reps+') { reps += 1; if (!alt && k != null) reps = Math.min(reps, hi! + 1); paceNote.fast = `Trzy ostatnie cele przebite – szybciej (podwójny krok ciężaru albo +1 powtórzenie więcej).`; }
      else paceNote.fast ||= 'Trzy ostatnie cele przebite.';
    } else if (pace === 'slow') {
      if (change === 'kg+' && rpe > 8) { kg = k; reps = r; change = 'same'; }
      else if (change === 'reps+') reps = Math.max(r, reps - 1);
      paceNote.slow = 'Ostatnie cele nie weszły – wolniej: mniejsze kroki, aż wynik będzie pewny.';
    }
    if (trend && kg != null && k != null && kg > k) { kg = k; reps = r; why = `Ostatnio ${was}. Bez podnoszenia ciężaru z powodu spadku formy.`; }
    const repsAlt = alt ? Math.max(0, r + (ra ?? 0) - reps) : null; // łącznie tyle samo co ostatnio, ale więcej pełnych
    if (kg != null && factor != null && Math.abs(factor - 1) >= 0.02) kg = Math.max(step, Math.round((kg * factor) / step) * step);
    if (kg != null) kg = Math.round(kg * 100) / 100;
    sets.push({ kg, reps, repsAlt, rpe: aim, why, was: { kg: k, reps: r, repsAlt: ra, rpe: rpeRaw, estimated: est } });
  }

  if (paceNote.fast) notes.push(paceNote.fast);
  if (paceNote.slow) notes.push(paceNote.slow);
  const warn = trend ? 'Wyniki spadają od dwóch treningów – zostań przy ciężarze; sprawdź sen, jedzenie i regenerację.' : null;
  if (off) notes.push(`Korekta Twojej skali: zwykle zostaje Ci ${off > 0 ? `o ${fmt(off)} powt. więcej` : `o ${fmt(-off)} powt. mniej`} w zapasie, niż oceniasz.`);
  if (n > 1) notes.unshift('Każda seria porównana z tą samą serią poprzednio.');
  const s1 = sets[0];
  return {
    ctxRated, otherRated,
    suggestion: {
      level, kg: s1.kg, reps: s1.reps, repsAlt: s1.repsAlt, rpe: s1.rpe, reason: [s1.why, ...notes].join(' '), factor, ctxRated, otherRated, warn,
      pace, outcomes, rirOffset: off, sets,
      from: { d: base.d, n: base.n, kg: s1.was.kg, reps: s1.was.reps, repsAlt: s1.was.repsAlt, rpe: s1.was.rpe },
    },
  };
}
