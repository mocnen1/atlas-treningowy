import type { MuscleId, Weights } from '../data/catalog';

export const DB_VERSION = 1;

export type BodyModel = 'male' | 'female';

export interface Profile {
  id: string;
  name: string;
  bodyMassKg: number | null;
  createdAt: string;
  /** Model 3D: męski (Z-Anatomy, z kośćmi) albo kobiecy (R. Gadzhiev, bez kości) */
  bodyModel: BodyModel;
  /** Cele tygodniowe w efektywnych seriach; brak klucza = cel domyślny, null = bez celu */
  targets: Record<MuscleId, [number, number] | null>;
}

export interface WorkoutSet {
  id: string;
  reps: number | null;
  weightKg: number | null;
  /** Przerwa po tej serii, w sekundach */
  restSec: number | null;
  /** Czas trwania serii (np. deska), w sekundach */
  durationSec: number | null;
  rpe: number | null;
  warmup: boolean;
  /** Powtórzenia w łatwiejszym wariancie (gdy ćwiczenie ma altLabels); `reps` to wtedy wariant pełny */
  repsAlt: number | null;
}

/** Nazwy dwóch wariantów powtórzeń w jednej serii, np. ['pełne', 'tylko nogi'] */
export type AltLabels = [string, string];

export interface WorkoutExercise {
  id: string;
  exerciseId: string;
  notes: string;
  sets: WorkoutSet[];
  /** Superseria: sąsiednie ćwiczenia z tym samym identyfikatorem są robione na zmianę */
  supersetId: string | null;
  altLabels: AltLabels | null;
  /** Cel trenera podany na telefonie przed ćwiczeniem: [kg, powt., powt. łatwiejsze, RPE] */
  target: [number | null, number, number | null, number] | null;
  /** Cele trenera dla kolejnych serii roboczych (seria 1, 2, 3…) */
  setTargets: [number | null, number, number | null, number][] | null;
}

export interface Workout {
  id: string;
  profileId: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM albo null */
  startTime: string | null;
  durationMin: number | null;
  name: string;
  notes: string;
  exercises: WorkoutExercise[];
  /** Plan, z którego zrobiono trening – kontekst dla trenera (null = bez planu; wtedy liczy się nazwa) */
  planId: string | null;
  /** Skąd pochodzi zapis: wpisany ręcznie albo zaimportowany z telefonu */
  source: 'ręcznie' | 'import';
  createdAt: string;
}

export interface CustomExercise {
  id: string;
  name: string;
  nameEn: string;
  equipmentPl: string;
  countsForVolume: boolean;
  muscles: Weights;
  notes: string;
}

export interface PlanExercise {
  id: string;
  exerciseId: string;
  sets: number;
  repsMin: number | null;
  repsMax: number | null;
  /** Docelowa przerwa między seriami (s) */
  restSec: number | null;
  notes: string;
  supersetId: string | null;
  altLabels: AltLabels | null;
}

export interface Plan {
  id: string;
  profileId: string;
  name: string;
  exercises: PlanExercise[];
  createdAt: string;
}

export interface Db {
  version: number;
  activeProfileId: string | null;
  profiles: Profile[];
  workouts: Workout[];
  customExercises: CustomExercise[];
  plans: Plan[];
  /** Poprawione przez użytkownika wagi wbudowanych ćwiczeń */
  weightOverrides: Record<string, Weights>;
}

export const emptyDb = (): Db => ({
  version: DB_VERSION, activeProfileId: null, profiles: [], workouts: [], customExercises: [], plans: [], weightOverrides: {},
});

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Sprawdza i uzupełnia dane wczytane z pliku (stare wersje, brakujące pola). Rzuca błąd przy nieprawidłowym formacie. */
export function normalizeDb(raw: unknown): Db {
  if (!raw || typeof raw !== 'object') throw new Error('Plik nie zawiera danych aplikacji.');
  const r = raw as Partial<Db>;
  if (!Array.isArray(r.profiles) || !Array.isArray(r.workouts)) throw new Error('Plik nie wygląda na kopię danych Atlasu Treningowego.');
  const db: Db = { ...emptyDb(), ...r, version: DB_VERSION } as Db;
  db.customExercises = r.customExercises ?? [];
  db.weightOverrides = r.weightOverrides ?? {};
  db.plans = (r.plans ?? []).map((p: any) => ({ createdAt: new Date().toISOString(), ...p, exercises: (p.exercises ?? []).map((e: any) => ({ sets: 3, repsMin: null, repsMax: null, restSec: null, notes: '', supersetId: null, altLabels: null, ...e })) }));
  db.profiles = db.profiles.map((p: any) => ({ bodyMassKg: null, targets: {}, createdAt: new Date().toISOString(), ...p, bodyModel: p.bodyModel === 'female' ? 'female' : 'male' }));
  db.workouts = db.workouts.map((w: any) => ({
    startTime: null, durationMin: null, name: '', notes: '', source: 'ręcznie', createdAt: new Date().toISOString(), planId: null, ...w,
    exercises: (w.exercises ?? []).map((e: any) => ({
      notes: '', supersetId: null, altLabels: null, target: null, setTargets: null, ...e,
      sets: (e.sets ?? []).map((s: any) => ({ reps: null, weightKg: null, restSec: null, durationSec: null, rpe: null, warmup: false, repsAlt: null, ...s })),
    })),
  }));
  if (db.activeProfileId && !db.profiles.some(p => p.id === db.activeProfileId)) db.activeProfileId = db.profiles[0]?.id ?? null;
  return db;
}

/** Grupy superserii: indeksy sąsiednich elementów z tym samym, niepustym identyfikatorem (pojedyncze ćwiczenie = grupa jednoelementowa). */
export function supersetGroups<T>(items: T[], idOf: (x: T) => string | null | undefined): number[][] {
  const out: number[][] = [];
  items.forEach((x, i) => {
    const id = idOf(x), prev = out[out.length - 1];
    if (id && prev && idOf(items[prev[0]]) === id) prev.push(i); else out.push([i]);
  });
  return out;
}

/** Łączy ćwiczenie `i` z następnym w superserię (wspólny identyfikator) albo rozłącza je. Działa na tablicy ćwiczeń treningu lub planu. */
export function linkNext<T extends { supersetId: string | null }>(arr: T[], i: number, on: boolean) {
  const a = arr[i], b = arr[i + 1];
  if (!a || !b) return;
  if (on) {
    const id = a.supersetId ?? b.supersetId ?? uid();
    const old = b.supersetId;
    for (const x of arr) if (x === a || x === b || (old && x.supersetId === old)) x.supersetId = id;
  } else {
    // rozcięcie grupy między i a i+1: dalsza część dostaje nowy identyfikator
    const id = a.supersetId, nid = uid();
    for (let k = i + 1; k < arr.length && arr[k].supersetId === id; k++) arr[k].supersetId = nid;
  }
  // pojedyncze ćwiczenie nie jest superserią
  supersetGroups(arr, x => x.supersetId).forEach(g => { if (g.length === 1) arr[g[0]].supersetId = null; });
}
