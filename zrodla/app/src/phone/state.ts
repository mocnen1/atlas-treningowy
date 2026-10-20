// Stan aplikacji na telefonie. Trzymany w localStorage (zapis po każdej zmianie).
import catalogJson from './catalog.json';
import musclesJson from '../data/muscles.json';
import { localDate, localTime, type PcBundle, type PhoneBundle, type TransferCustom, type TransferLast, type TransferPlan, type TransferWorkout } from '../shared/transfer';

export interface CatalogItem { id: string; name: string; nameEn: string; eq: string; vol: boolean; top: string | null; verified: boolean; custom?: boolean }
export const CATALOG: CatalogItem[] = (catalogJson as [string, string, string, string, number, string | null, number][])
  .map(([id, name, nameEn, eq, vol, top, v]) => ({ id, name, nameEn, eq, vol: !!vol, top, verified: !!v }));
const MUSCLE_NAMES: Record<string, string> = Object.fromEntries(musclesJson.muscles.map(m => [m.id, m.name.replace(/\s*\(.*\)$/, '')]));
export const muscleName = (id: string | null) => (id ? MUSCLE_NAMES[id] ?? '' : '');

export interface PSet { id: string; kg: number | null; reps: number | null; dur: number | null; rpe: number | null; warmup: boolean; doneAt: number | null; restSec: number | null }
export interface PExercise { id: string; exerciseId: string; repsMin: number | null; repsMax: number | null; restSec: number | null; notes: string; sets: PSet[] }
export interface PWorkout { id: string; name: string; planId: string | null; startedAt: number; endedAt: number | null; notes: string; exercises: PExercise[]; sentAt: number | null }
export interface Rest { setId: string; from: number; target: number }
export interface Settings { kgStep: number; defaultRest: number; sound: boolean }

export interface PhoneState {
  v: 1;
  profile: string | null;
  receivedAt: string | null;
  plans: TransferPlan[];
  /** Własne ćwiczenia: z komputera albo dodane na telefonie (local = jeszcze nieznane komputerowi) */
  custom: (TransferCustom & { local?: boolean })[];
  last: Record<string, TransferLast>;
  active: PWorkout | null;
  rest: Rest | null;
  history: PWorkout[];
  settings: Settings;
}

const KEY = 'atlas-phone-v1';
export const emptyState = (): PhoneState => ({
  v: 1, profile: null, receivedAt: null, plans: [], custom: [], last: {}, active: null, rest: null, history: [],
  settings: { kgStep: 2.5, defaultRest: 120, sound: true },
});

export function loadState(): PhoneState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    return { ...emptyState(), ...JSON.parse(raw) };
  } catch { return emptyState(); }
}
export function saveState(s: PhoneState) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; }
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function lookupExercise(s: PhoneState, id: string): CatalogItem | undefined {
  const c = s.custom.find(x => x.id === id);
  if (c) return { id: c.id, name: c.name, nameEn: '', eq: c.eq, vol: c.vol, top: c.top, verified: true, custom: true };
  return CATALOG_BY_ID.get(id);
}
const CATALOG_BY_ID = new Map(CATALOG.map(c => [c.id, c]));

/** Nowa seria z podpowiedzią: ostatni wynik z komputera albo poprzednia seria. */
export function suggestedSet(s: PhoneState, exerciseId: string, repsMin: number | null): PSet {
  const last = s.last[exerciseId];
  return { id: uid(), kg: last?.[1] ?? null, reps: last?.[2] ?? repsMin ?? null, dur: null, rpe: null, warmup: false, doneAt: null, restSec: null };
}

export function newExercise(s: PhoneState, exerciseId: string, plan?: { sets: number; repsMin: number | null; repsMax: number | null; restSec: number | null; notes: string }): PExercise {
  const n = plan?.sets ?? 3;
  const base = suggestedSet(s, exerciseId, plan?.repsMin ?? null);
  return {
    id: uid(), exerciseId, repsMin: plan?.repsMin ?? null, repsMax: plan?.repsMax ?? null, restSec: plan?.restSec ?? null, notes: plan?.notes ?? '',
    sets: Array.from({ length: n }, () => ({ ...base, id: uid() })),
  };
}

export function startWorkout(s: PhoneState, plan: TransferPlan | null): PWorkout {
  return {
    id: uid(), name: plan?.name ?? '', planId: plan?.id ?? null, startedAt: Date.now(), endedAt: null, notes: '', sentAt: null,
    exercises: plan ? plan.exercises.map(e => newExercise(s, e.exerciseId, e)) : [],
  };
}

/** Szacowany czas trwania serii (s), gdy nie wiemy, kiedy się zaczęła: ~3 s na powtórzenie. */
export const estSetSec = (st: PSet) => st.dur ?? Math.min(90, Math.max(15, (st.reps ?? 8) * 3));

/** Trening z telefonu w formacie dla komputera. Tylko odhaczone serie; ćwiczenia bez serii pomijamy. */
export function toTransfer(w: PWorkout): TransferWorkout {
  const end = w.endedAt ?? Date.now();
  return {
    id: w.id, date: localDate(w.startedAt), startTime: localTime(w.startedAt), durationMin: Math.max(1, Math.round((end - w.startedAt) / 60000)),
    name: w.name, notes: w.notes,
    exercises: w.exercises.map(e => ({
      exerciseId: e.exerciseId, notes: e.notes,
      sets: e.sets.filter(x => x.doneAt).map(x => ({ reps: x.reps, weightKg: x.kg, restSec: x.restSec, durationSec: x.dur, rpe: x.rpe, warmup: x.warmup })),
    })).filter(e => e.sets.length),
  };
}

export function phoneBundle(s: PhoneState, ws: PWorkout[]): PhoneBundle {
  const used = new Set(ws.flatMap(w => w.exercises.map(e => e.exerciseId)));
  return {
    k: 'workouts', v: 1, sentAt: new Date().toISOString(), workouts: ws.map(toTransfer),
    custom: s.custom.filter(c => used.has(c.id)).map(({ id, name, eq, vol, top }) => ({ id, name, eq, vol, top })),
  };
}

/** Przyjęcie planów z komputera. Własne ćwiczenia dodane na telefonie zostają, dopóki komputer ich nie zna. */
export function applyPcBundle(s: PhoneState, b: PcBundle): PhoneState {
  const fromPc = new Set(b.custom.map(c => c.id));
  const last = { ...s.last };
  for (const [id, v] of Object.entries(b.last)) if (!last[id] || last[id][0] <= v[0]) last[id] = v;
  return {
    ...s, profile: b.profile, receivedAt: b.sentAt, plans: b.plans, last,
    custom: [...b.custom, ...s.custom.filter(c => c.local && !fromPc.has(c.id))],
  };
}

/** Po zakończeniu treningu zapamiętujemy najlepszą serię każdego ćwiczenia jako „ostatnio”. */
export function updateLast(last: Record<string, TransferLast>, w: PWorkout): Record<string, TransferLast> {
  const out = { ...last };
  const date = localDate(w.startedAt);
  for (const e of w.exercises) {
    const done = e.sets.filter(x => x.doneAt && !x.warmup && (x.reps ?? 0) > 0);
    if (!done.length) continue;
    const score = (x: PSet) => (x.kg ?? 0) * (1 + (x.reps ?? 0) / 30);
    const best = done.reduce((a, x) => (score(x) >= score(a) ? x : a), done[0]);
    out[e.exerciseId] = [date, best.kg, best.reps];
  }
  return out;
}

export const fmtClock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};
export const fmtKg = (n: number | null) => (n == null ? '–' : n.toLocaleString('pl-PL', { maximumFractionDigits: 2 }));
export const fmtDay = (iso: string) => { const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso); return d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' }); };
export const fmtDateTime = (ms: number) => new Date(ms).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
