// Obliczenia: efektywne serie, częstotliwość i tonaż na mięsień. Czyste funkcje – testowane w tests/.
import type { Weights, MuscleId, Exercise } from '../data/catalog';
import type { Workout, WorkoutSet } from '../store/types';

export type ExerciseLookup = (id: string) => Exercise | undefined;

/** Seria liczy się do objętości, jeśli nie jest rozgrzewkowa i ma powtórzenia lub czas. */
export const isWorkingSet = (s: WorkoutSet) => !s.warmup && ((s.reps ?? 0) > 0 || (s.durationSec ?? 0) > 0);

export interface MuscleLoad {
  /** Suma serii × waga zaangażowania */
  effSets: number;
  /** Suma powtórzenia × kg × waga zaangażowania */
  tonnage: number;
}

/** Obciążenie mięśni w jednym treningu. */
export function workoutLoad(w: Workout, lookup: ExerciseLookup): Record<MuscleId, MuscleLoad> {
  const out: Record<MuscleId, MuscleLoad> = {};
  for (const we of w.exercises) {
    const ex = lookup(we.exerciseId);
    if (!ex || !ex.countsForVolume) continue;
    for (const s of we.sets) {
      if (!isWorkingSet(s)) continue;
      const t = (s.reps ?? 0) * (s.weightKg ?? 0);
      for (const [m, wt] of Object.entries(ex.muscles)) {
        const o = (out[m] ??= { effSets: 0, tonnage: 0 });
        o.effSets += wt;
        o.tonnage += t * wt;
      }
    }
  }
  return out;
}

export interface MuscleStats {
  effSets: number;
  /** Średnio efektywnych serii na tydzień */
  perWeek: number;
  /** Liczba treningów, w których mięsień dostał co najmniej 1 efektywną serię */
  sessions: number;
  /** Średnio treningów na tydzień, w których mięsień pracował */
  freqPerWeek: number;
  tonnage: number;
  lastDate: string | null;
}

const dayMs = 86_400_000;
const parse = (d: string) => new Date(d + 'T12:00:00').getTime();

/** Liczba tygodni w okresie (co najmniej 1), do przeliczenia na „na tydzień”. */
export function weeksBetween(from: string, to: string) {
  return Math.max(1, Math.round((parse(to) - parse(from)) / dayMs + 1) / 7);
}

/** Statystyki mięśni dla treningów z okresu [from, to] włącznie (daty YYYY-MM-DD). */
export function periodStats(workouts: Workout[], from: string, to: string, lookup: ExerciseLookup) {
  const weeks = weeksBetween(from, to);
  const stats: Record<MuscleId, MuscleStats> = {};
  const inRange = workouts.filter(w => w.date >= from && w.date <= to);
  for (const w of inRange) {
    for (const [m, l] of Object.entries(workoutLoad(w, lookup))) {
      const s = (stats[m] ??= { effSets: 0, perWeek: 0, sessions: 0, freqPerWeek: 0, tonnage: 0, lastDate: null });
      s.effSets += l.effSets;
      s.tonnage += l.tonnage;
      if (l.effSets >= 1) s.sessions += 1;
      if (!s.lastDate || w.date > s.lastDate) s.lastDate = w.date;
    }
  }
  for (const s of Object.values(stats)) {
    s.perWeek = s.effSets / weeks;
    s.freqPerWeek = s.sessions / weeks;
  }
  return { stats, weeks, workoutCount: inRange.length };
}

export type TargetState = 'none' | 'below' | 'ok' | 'above' | 'notarget';

export function targetState(perWeek: number, target: [number, number] | null): TargetState {
  if (!target) return perWeek > 0 ? 'notarget' : 'none';
  if (perWeek <= 0) return 'none';
  if (perWeek < target[0]) return 'below';
  if (perWeek > target[1]) return 'above';
  return 'ok';
}

/** Szacowany ciężar maksymalny (1RM) wg wzoru Epleya; dla 1 powtórzenia zwraca sam ciężar. */
export function e1rm(weightKg: number, reps: number) {
  if (reps <= 0 || weightKg <= 0) return 0;
  return reps === 1 ? weightKg : weightKg * (1 + reps / 30);
}

/** Łączny czas przerw zapisanych w treningu (sekundy). */
export function totalRestSec(w: Workout) {
  return w.exercises.reduce((a, e) => a + e.sets.reduce((b, s) => b + (s.restSec ?? 0), 0), 0);
}

export function workoutSummary(w: Workout, lookup: ExerciseLookup) {
  let sets = 0, working = 0, tonnage = 0;
  for (const e of w.exercises) for (const s of e.sets) {
    sets++;
    if (isWorkingSet(s)) { working++; tonnage += (s.reps ?? 0) * (s.weightKg ?? 0); }
  }
  const load = workoutLoad(w, lookup);
  const top = Object.entries(load).sort((a, b) => b[1].effSets - a[1].effSets).slice(0, 4).map(([m]) => m);
  return { sets, working, tonnage, top, restSec: totalRestSec(w) };
}

/** Wagi po scaleniu: wbudowane, nadpisane przez użytkownika albo własne ćwiczenie. */
export function mergeWeights(base: Weights, override?: Weights): Weights {
  return override ? { ...override } : base;
}
