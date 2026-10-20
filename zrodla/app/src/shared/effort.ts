// Subiektywna trudność serii. Pokazywana jako pasek 50–100% z liczbą powtórzeń w zapasie,
// zapisywana jako RPE (skala 1–10 oparta na powtórzeniach w zapasie: RPE 10 = upadek, RPE 9 = 1 w zapasie...).
// Skala RIR/RPE: Zourdos i in. 2016 (J Strength Cond Res 30(1)), Helms i in. 2016 (Strength Cond J 38(4)).
// Ocena jest najbardziej wiarygodna blisko upadku (±1 powtórzenie), dlatego skala ma tylko 6 poziomów.

export interface EffortLevel { rpe: number; pct: number; label: string; short: string }

export const EFFORT_LEVELS: EffortLevel[] = [
  { rpe: 5, pct: 50, label: 'lekko – 5+ powtórzeń w zapasie', short: 'lekko' },
  { rpe: 6, pct: 60, label: '4 powtórzenia w zapasie', short: '4 w zap.' },
  { rpe: 7, pct: 70, label: '3 powtórzenia w zapasie', short: '3 w zap.' },
  { rpe: 8, pct: 80, label: '2 powtórzenia w zapasie', short: '2 w zap.' },
  { rpe: 9, pct: 90, label: '1 powtórzenie w zapasie', short: '1 w zap.' },
  { rpe: 10, pct: 100, label: 'upadek – nic więcej nie zrobiłbym', short: 'upadek' },
];

/** Najbliższy poziom skali dla zapisanego RPE (obsługuje też wartości pośrednie, np. 8,5 z importu). */
export function effortLevel(rpe: number | null | undefined): EffortLevel | null {
  if (rpe == null || !Number.isFinite(rpe) || rpe <= 0) return null;
  return EFFORT_LEVELS.reduce((a, l) => (Math.abs(l.rpe - rpe) < Math.abs(a.rpe - rpe) ? l : a), EFFORT_LEVELS[0]);
}
export const effortPct = (rpe: number | null | undefined) => {
  if (rpe == null || !Number.isFinite(rpe) || rpe <= 0) return null;
  return Math.min(100, Math.max(50, Math.round(rpe * 10)));
};

/** Ile treningów z oceną trudności potrzeba, zanim trener zacznie podpowiadać ciężar dla ćwiczenia. */
export const TRAINER_MIN_SESSIONS = 3;
