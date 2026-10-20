import type { MuscleId, Weights } from '../data/catalog';

export const DB_VERSION = 1;

export interface Profile {
  id: string;
  name: string;
  bodyMassKg: number | null;
  createdAt: string;
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
}

export interface WorkoutExercise {
  id: string;
  exerciseId: string;
  notes: string;
  sets: WorkoutSet[];
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
  db.plans = (r.plans ?? []).map((p: any) => ({ createdAt: new Date().toISOString(), ...p, exercises: (p.exercises ?? []).map((e: any) => ({ sets: 3, repsMin: null, repsMax: null, restSec: null, notes: '', ...e })) }));
  db.profiles = db.profiles.map((p: any) => ({ bodyMassKg: null, targets: {}, createdAt: new Date().toISOString(), ...p }));
  db.workouts = db.workouts.map((w: any) => ({
    startTime: null, durationMin: null, name: '', notes: '', source: 'ręcznie', createdAt: new Date().toISOString(), ...w,
    exercises: (w.exercises ?? []).map((e: any) => ({
      notes: '', ...e,
      sets: (e.sets ?? []).map((s: any) => ({ reps: null, weightKg: null, restSec: null, durationSec: null, rpe: null, warmup: false, ...s })),
    })),
  }));
  if (db.activeProfileId && !db.profiles.some(p => p.id === db.activeProfileId)) db.activeProfileId = db.profiles[0]?.id ?? null;
  return db;
}
