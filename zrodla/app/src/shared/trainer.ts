// Trener: podpowiedź ciężaru i powtórzeń na kolejny trening, liczona osobno dla każdego planu treningowego.
//
// Dlaczego osobno: to samo ćwiczenie w innym planie robione jest po innych ćwiczeniach (np. wyciskanie na
// maszynie po klatce vs. na plecach), więc mięśnie są inaczej zmęczone i realny ciężar roboczy jest inny.
//
// Dane: sesje ćwiczenia (data, plan/kontekst, serie: kg, powtórzenia, trudność RPE, rozgrzewka, wariant łatwiejszy).
// Poziomy pewności:
//   'plan'  – co najmniej TRAINER_MIN_SESSIONS ocenionych treningów z tego planu,
//   'mixed' – 1–2 ocenione z tego planu (decyduje ostatni z nich), razem z innymi planami co najmniej próg,
//   'other' – brak ocenionych z tego planu; szacunek z innego planu przeliczony współczynnikiem między planami.
// Reguły (autoregulacja wg zapasu powtórzeń + podwójna progresja w zakresie powtórzeń z planu):
//   zapas ≥ 3 (RPE ≤ 7)   – za lekko: +2 powtórzenia, a na górze zakresu +1 krok ciężaru,
//   zapas 2 (RPE ≤ 8,5)   – górna granica zakresu → +1 krok ciężaru i dół zakresu; inaczej +1 powtórzenie,
//   zapas 1 (RPE ≤ 9,5)   – górna granica → +1 krok; inaczej powtórz wynik,
//   upadek (RPE 10)       – poniżej dołu zakresu → −1 krok; inaczej powtórz wynik.
// Gdy szacowany 1RM spadał na dwóch ostatnich treningach (łącznie o ponad 3%), trener nie podnosi ciężaru.
import { TRAINER_MIN_SESSIONS } from './effort';

/** Seria w historii: [kg, powtórzenia, RPE, rozgrzewka 0/1, powtórzenia w łatwiejszym wariancie] */
export type HSet = [kg: number | null, reps: number | null, rpe: number | null, warm: 0 | 1, repsAlt?: number | null];
/** Jedno wykonanie ćwiczenia: data YYYY-MM-DD, klucz kontekstu (plan), nazwa kontekstu do wyświetlenia, serie */
export interface HSession { d: string; c: string; n: string; s: HSet[] }

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
/** Szacowany 1RM z uwzględnieniem zapasu powtórzeń (bez oceny zakładamy zapas 1). Dla masy ciała: powtórzenia + zapas. */
export function capacity(x: HSet): number {
  const rir = x[2] != null ? Math.max(0, 10 - x[2]) : 1;
  const reps = (x[1] ?? 0) + (x[4] ?? 0) * 0.5;
  return x[0] ? x[0] * (1 + (reps + rir) / 30) : reps + rir;
}
const sessionCap = (s: HSession) => Math.max(0, ...work(s).map(capacity));
const median = (a: number[]) => { const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };

/** Krok ciężaru: najmniejsza różnica między użytymi ciężarami (0,5–10 kg), inaczej wartość domyślna. */
export function weightStep(sessions: HSession[], fallback: number): number {
  const kg = [...new Set(sessions.flatMap(s => work(s).map(x => x[0]).filter((v): v is number => !!v)))].sort((a, b) => a - b);
  let step = Infinity;
  for (let i = 1; i < kg.length; i++) { const d = Math.round((kg[i] - kg[i - 1]) * 100) / 100; if (d >= 0.5 && d < step) step = d; }
  return step <= 10 ? step : fallback;
}

export type TrainerLevel = 'plan' | 'mixed' | 'other';
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
}
export interface TrainerState { suggestion: Suggestion | null; ctxRated: number; otherRated: number }

const fmt = (n: number) => n.toLocaleString('pl-PL', { maximumFractionDigits: 2 });

/**
 * Podpowiedź na kolejny trening.
 * @param sessions wszystkie wykonania ćwiczenia (dowolne plany), kolejność dowolna
 * @param ctx klucz kontekstu bieżącego treningu
 * @param range zakres powtórzeń z planu (null = brak planu dla ćwiczenia)
 * @param alt czy ćwiczenie liczy powtórzenia w dwóch wariantach
 * @param defaultStep krok ciężaru, gdy nie da się go odczytać z historii
 */
export function suggest(sessions: HSession[], ctx: string, range: [number | null, number | null] | null, alt: boolean, defaultStep: number): TrainerState {
  const all = [...sessions].filter(s => work(s).length).sort((a, b) => b.d.localeCompare(a.d));
  const ctxS = all.filter(s => s.c === ctx), othS = all.filter(s => s.c !== ctx);
  const ctxR = ctxS.filter(isRated), othR = othS.filter(isRated);
  const ctxRated = ctxR.length, otherRated = othR.length;
  let level: TrainerLevel | null = null;
  if (ctxRated >= TRAINER_MIN_SESSIONS) level = 'plan';
  else if (ctxRated >= 1 && ctxRated + otherRated >= TRAINER_MIN_SESSIONS) level = 'mixed';
  else if (ctxRated === 0 && otherRated >= TRAINER_MIN_SESSIONS) level = 'other';
  if (!level) return { suggestion: null, ctxRated, otherRated };

  const base = level === 'other' ? othR[0] : ctxR[0];
  const series = level === 'other' ? othS.filter(s => s.c === base.c) : ctxS;
  const ws = work(base);
  const rated = ws.filter(x => x[2] != null);
  // najlepsza seria robocza (z oceną): największy szacowany 1RM; jej trudność – a gdy brak, najwyższa w treningu
  const top = rated.reduce((a, x) => (capacity(x) > capacity(a) ? x : a), rated[0]);
  const rpe = top[2] ?? Math.max(...rated.map(x => x[2]!));
  const k = top[0] && top[0] > 0 ? top[0] : null, r = top[1] ?? 0, ra = alt ? top[4] ?? 0 : null;
  const step = weightStep(all, defaultStep);
  let lo = range?.[0] ?? null, hi = range?.[1] ?? null;
  if (lo == null && hi == null) { lo = r; hi = r + 2; } else { lo ??= hi!; hi ??= lo; }
  if (hi! < lo!) [lo, hi] = [hi, lo];

  let kg = k, reps = r, repsAlt = ra, why = '', aim = 8;
  const rir = Math.max(0, 10 - rpe);
  const zap = rir >= 5 ? '5+' : String(Math.round(rir));
  const was = `${k != null ? fmt(k) + ' kg × ' : ''}${alt ? `${r} + ${ra}` : r} przy ${zap === '0' ? 'upadku' : `zapasie ${zap}`}`;
  if (alt || k == null) {
    // masa ciała / dwa warianty: progres w powtórzeniach (przy wariantach – w pełnych)
    if (rpe <= 7) { reps = r + 2; why = `Ostatnio ${was} – za lekko, +2 ${alt ? 'pełne' : 'powtórzenia'}.`; }
    else if (rpe <= 8.5) { reps = r + 1; why = `Ostatnio ${was} – +1 ${alt ? 'pełne' : 'powtórzenie'}.`; }
    else if (rpe <= 9.5) { reps = r; aim = 9; why = `Ostatnio ${was} – powtórz wynik, celuj w ten sam lub o 1 lepszy.`; }
    else { reps = r; aim = 9; why = `Ostatnio ${was} – powtórz wynik, bez dokładania.`; }
    if (alt) repsAlt = Math.max(0, r + (ra ?? 0) - reps); // łącznie tyle samo co ostatnio, ale więcej pełnych
  } else if (rpe <= 7) {
    if (r < hi!) { reps = Math.min(hi!, r + 2); why = `Ostatnio ${was} – za lekko, +2 powtórzenia.`; }
    else { kg = k + step; reps = lo!; why = `Ostatnio ${was} na górze zakresu – +${fmt(step)} kg.`; }
  } else if (rpe <= 8.5) {
    if (r >= hi!) { kg = k + step; reps = lo!; why = `Ostatnio ${was} na górze zakresu ${lo}–${hi} – +${fmt(step)} kg i od dołu zakresu.`; }
    else { reps = r + 1; why = `Ostatnio ${was} – ten sam ciężar, +1 powtórzenie.`; }
  } else if (rpe <= 9.5) {
    aim = 9;
    if (r >= hi!) { kg = k + step; reps = lo!; aim = 8; why = `Ostatnio ${was} na górze zakresu – +${fmt(step)} kg i od dołu zakresu.`; }
    else { reps = r; why = `Ostatnio ${was} – powtórz wynik; jeśli pójdzie lżej, dołóż powtórzenie.`; }
  } else if (r < lo!) {
    kg = Math.max(step, k - step); reps = lo!; why = `Ostatnio ${was} poniżej zakresu ${lo}–${hi} – −${fmt(step)} kg.`;
  } else { reps = r; aim = 9; why = `Ostatnio ${was} – powtórz wynik zanim dołożysz.`; }

  // trend: dwa kolejne spadki szacowanego 1RM w tym samym kontekście → bez podnoszenia ciężaru
  let warn: string | null = null;
  const caps = series.slice(0, 3).map(sessionCap);
  if (caps.length === 3 && caps[0] < caps[1] && caps[1] < caps[2] && caps[0] < caps[2] * 0.97) {
    warn = 'Wyniki spadają od dwóch treningów – zostań przy ciężarze; sprawdź sen, jedzenie i regenerację.';
    if (kg != null && k != null && kg > k) { kg = k; reps = r; why = `Ostatnio ${was}. Bez podnoszenia ciężaru z powodu spadku formy.`; }
  }

  // przeliczenie z innego planu: stosunek mediany szacowanego 1RM w tym planie i w planie źródłowym
  let factor: number | null = null;
  if (level === 'other' && kg != null) {
    const here = ctxS.slice(0, 3).map(sessionCap), there = series.slice(0, 3).map(sessionCap);
    factor = here.length && there.length ? Math.min(1.15, Math.max(0.75, median(here) / median(there))) : 1;
    if (Math.abs(factor - 1) >= 0.02) kg = Math.max(step, Math.round((kg * factor) / step) * step);
    why += here.length
      ? ` Przeliczone z planu „${base.n}” (w tym planie zwykle ${fmt(Math.round(factor * 100))}% tamtych wyników).`
      : ` Szacunek z planu „${base.n}” – w tym planie brak jeszcze ocenionych treningów, bez korekty.`;
  } else if (level === 'mixed') {
    why += ` Wstępnie: ${ctxRated} z ${TRAINER_MIN_SESSIONS} ocenionych treningów w tym planie.`;
  }
  if (kg != null) kg = Math.round(kg * 100) / 100;
  return {
    ctxRated, otherRated,
    suggestion: {
      level, kg, reps, repsAlt: alt ? repsAlt : null, rpe: aim, reason: why, factor, ctxRated, otherRated, warn,
      from: { d: base.d, n: base.n, kg: k, reps: r, repsAlt: ra, rpe },
    },
  };
}
