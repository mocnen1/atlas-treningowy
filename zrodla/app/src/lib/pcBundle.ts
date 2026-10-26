// Paczka wysyłana z komputera na telefon (plany, własne ćwiczenia, ostatnie wyniki, historia serii). Czysta funkcja – testowana.
import { isWorkingSet, ratedSessionCounts } from './stats';
import type { Db } from '../store/types';
import { packHistory, setScore, type AltLabels, type PcBundle, type TransferLast } from '../shared/transfer';
import { contextKey, type HSession, type HSet } from '../shared/trainer';

/** Paczka z planami, własnymi ćwiczeniami i ostatnimi wynikami dla aktywnego profilu. */
export function buildPcBundle(db: Db, profileId: string): PcBundle {
  const profile = db.profiles.find(p => p.id === profileId)!;
  const plans = db.plans.filter(p => p.profileId === profileId);
  const workouts = db.workouts.filter(w => w.profileId === profileId).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const inPlans = new Set(plans.flatMap(p => p.exercises.map(e => e.exerciseId)));
  const last: Record<string, TransferLast> = {};
  // Nazwy wariantów powtórzeń: z najnowszego treningu, w którym ćwiczenie je miało
  const alt: Record<string, AltLabels> = {};
  for (const w of workouts) for (const we of w.exercises) if (we.altLabels && !alt[we.exerciseId]) alt[we.exerciseId] = we.altLabels;
  let recent = 0;
  for (const w of workouts) {
    for (const we of w.exercises) {
      if (last[we.exerciseId]) continue;
      const sets = we.sets.filter(isWorkingSet);
      if (!sets.length) continue;
      if (!inPlans.has(we.exerciseId) && recent >= 80) continue;
      const best = sets.reduce((a, s) => (setScore(s.weightKg, s.reps, s.repsAlt) >= setScore(a.weightKg, a.reps, a.repsAlt) ? s : a), sets[0]);
      last[we.exerciseId] = best.repsAlt != null ? [w.date, best.weightKg, best.reps, best.repsAlt] : [w.date, best.weightKg, best.reps];
      if (!inPlans.has(we.exerciseId)) recent++;
    }
  }
  // Historia serii: ćwiczenia z planów i ostatnio wykonywane; na ćwiczenie do 4 treningów z każdego planu, łącznie do 10
  const hist: Record<string, HSession[]> = {};
  const planName = new Map(plans.map(p => [p.id, p.name]));
  for (const w of workouts) {
    const c = contextKey(w.planId, w.name, plans);
    const n = planName.get(c) ?? (w.name || 'Bez nazwy');
    for (const we of w.exercises) {
      if (!last[we.exerciseId]) continue;
      if (!we.sets.some(isWorkingSet)) continue;
      const arr = (hist[we.exerciseId] ??= []);
      if (arr.length >= 10 || arr.filter(x => x.c === c).length >= 4) continue;
      arr.push({ d: w.date, c, n, s: we.sets.map(s => [s.weightKg, s.reps, s.rpe, s.warmup ? 1 : 0, ...(s.repsAlt != null ? [s.repsAlt] : [])] as HSet) });
    }
  }
  return {
    k: 'plans', v: 1, sentAt: new Date().toISOString(), profile: profile.name,
    hist: packHistory(hist),
    plans: plans.map(p => ({ id: p.id, name: p.name, exercises: p.exercises.map(e => ({ exerciseId: e.exerciseId, sets: e.sets, repsMin: e.repsMin, repsMax: e.repsMax, restSec: e.restSec, notes: e.notes, ...(e.supersetId ? { ss: e.supersetId } : {}), ...(e.altLabels ? { alt: e.altLabels } : {}) })) })),
    custom: db.customExercises.map(c => ({ id: c.id, name: c.name, eq: c.equipmentPl, vol: c.countsForVolume, top: Object.keys(c.muscles)[0] ?? null })),
    last,
    rated: ratedSessionCounts(workouts),
    alt,
  };
}

