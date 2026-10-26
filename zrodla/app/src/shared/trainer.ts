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
export interface HSession { d: string; c: string; n: string; s: HSet[]; t?: HTarget | null }

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
/** Jak poszło względem celu trenera: porównanie szacowanego 1RM najlepszej serii z celem (±2–3%). */
export function outcome(s: HSession, off = 0): Outcome | null {
  if (!s.t) return null;
  const ws = work(s).filter(x => x[2] != null);
  if (!ws.length) return null;
  const r = sessionCap(s, off) / targetCap(s.t);
  return r >= 1.03 ? 'beat' : r <= 0.98 ? 'miss' : 'hit';
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
}
export interface TrainerState { suggestion: Suggestion | null; ctxRated: number; otherRated: number }
export interface TrainerOpts { rirOffset?: number }

const fmt = (n: number) => n.toLocaleString('pl-PL', { maximumFractionDigits: 2 });
/** Cel trenera w postaci do zapisu przy ćwiczeniu */
export const toTarget = (g: Suggestion): HTarget => [g.kg, g.reps, g.repsAlt, g.rpe];

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
  const rated = ws.filter(x => x[2] != null);
  // najlepsza seria robocza (z oceną): największy szacowany 1RM; jej trudność – a gdy brak, najwyższa w treningu
  const top = rated.reduce((a, x) => (capacity(x, off) > capacity(a, off) ? x : a), rated[0]);
  const rpeRaw = top[2] ?? Math.max(...rated.map(x => x[2]!));
  const rpe = clamp(rpeRaw - off, 4, 10); // trudność po korekcie skali
  const k = top[0] && top[0] > 0 ? top[0] : null, r = top[1] ?? 0, ra = alt ? top[4] ?? 0 : null;
  const step = weightStep(all, defaultStep);
  let lo = range?.[0] ?? null, hi = range?.[1] ?? null;
  if (lo == null && hi == null) { lo = r; hi = r + 2; } else { lo ??= hi!; hi ??= lo; }
  if (hi! < lo!) [lo, hi] = [hi, lo];

  // tempo: wyniki ostatnich treningów z celem (to ćwiczenie, dowolny plan)
  const outcomes = all.map(s => outcome(s, off)).filter((o): o is Outcome => o != null).slice(0, 3);
  const pace: TrainerPace = outcomes.length === 3 && outcomes.every(o => o === 'beat') ? 'fast'
    : outcomes.length >= 2 && outcomes.filter(o => o === 'miss').length >= 2 ? 'slow' : 'normal';

  let kg = k, reps = r, repsAlt = ra, why = '', aim = 8;
  let change: 'kg+' | 'reps+' | 'same' | 'kg-' = 'same';
  const rir = Math.max(0, 10 - rpeRaw);
  const zap = rir >= 5 ? '5+' : fmt(rir);
  const was = `${k != null ? fmt(k) + ' kg × ' : ''}${alt ? `${r} + ${ra}` : r} przy ${zap === '0' ? 'upadku' : `zapasie ${zap}`}`;
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
  } else if (r < lo!) {
    kg = Math.max(step, k - step); reps = lo!; change = 'kg-'; why = `Ostatnio ${was} poniżej zakresu ${lo}–${hi} – −${fmt(step)} kg.`;
  } else { aim = 9; why = `Ostatnio ${was} – powtórz wynik zanim dołożysz.`; }

  // tempo dopasowane do Ciebie
  if (pace === 'fast' && !trend) {
    if (change === 'kg+' && k != null && 2 * step <= Math.max(step, k * 0.1)) { kg = k + 2 * step; notes.push(`Trzy ostatnie cele przebite – szybciej: +${fmt(2 * step)} kg.`); }
    else if (change === 'reps+') { reps += 1; if (!alt && k != null) reps = Math.min(reps, hi! + 1); notes.push('Trzy ostatnie cele przebite – szybciej: +1 powtórzenie więcej.'); }
    else notes.push('Trzy ostatnie cele przebite.');
  } else if (pace === 'slow') {
    if (change === 'kg+' && rpe > 8) { kg = k; reps = r; change = 'same'; notes.push('Ostatnie cele nie weszły – wolniej: ten sam ciężar, aż wynik będzie pewny.'); }
    else if (change === 'reps+') { reps = Math.max(r, reps - 1); notes.push('Ostatnie cele nie weszły – wolniej: mniejszy krok.'); }
    else notes.push('Ostatnie cele nie weszły – trener nie dokłada.');
  }

  let warn: string | null = null;
  if (trend) {
    warn = 'Wyniki spadają od dwóch treningów – zostań przy ciężarze; sprawdź sen, jedzenie i regenerację.';
    if (kg != null && k != null && kg > k) { kg = k; reps = r; why = `Ostatnio ${was}. Bez podnoszenia ciężaru z powodu spadku formy.`; }
  }
  if (alt) repsAlt = Math.max(0, r + (ra ?? 0) - reps); // łącznie tyle samo co ostatnio, ale więcej pełnych

  // przeliczenie z innego planu: stosunek mediany szacowanego 1RM w tym planie i w planie źródłowym
  let factor: number | null = null;
  if (level === 'other' && kg != null) {
    const here = ctxS.slice(0, 3).map(s => sessionCap(s, off)), there = series.slice(0, 3).map(s => sessionCap(s, off));
    factor = here.length && there.length ? clamp(median(here) / median(there), 0.75, 1.15) : 1;
    if (Math.abs(factor - 1) >= 0.02) kg = Math.max(step, Math.round((kg * factor) / step) * step);
    notes.push(here.length
      ? `Przeliczone z planu „${base.n}” (w tym planie zwykle ${fmt(Math.round(factor * 100))}% tamtych wyników).`
      : `Szacunek z planu „${base.n}” – w tym planie brak jeszcze ocenionych treningów, bez korekty.`);
  } else if (level === 'mixed') {
    notes.push(`Wstępnie: ${ctxRated} z ${TRAINER_MIN_SESSIONS} ocenionych treningów w tym planie.`);
  }
  if (off) notes.push(`Korekta Twojej skali: zwykle zostaje Ci ${off > 0 ? `o ${fmt(off)} powt. więcej` : `o ${fmt(-off)} powt. mniej`} w zapasie, niż oceniasz.`);
  if (kg != null) kg = Math.round(kg * 100) / 100;
  return {
    ctxRated, otherRated,
    suggestion: {
      level, kg, reps, repsAlt: alt ? repsAlt : null, rpe: aim, reason: [why, ...notes].join(' '), factor, ctxRated, otherRated, warn,
      pace, outcomes, rirOffset: off,
      from: { d: base.d, n: base.n, kg: k, reps: r, repsAlt: ra, rpe: rpeRaw },
    },
  };
}
