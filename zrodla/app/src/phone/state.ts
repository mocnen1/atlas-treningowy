// Stan aplikacji na telefonie. Trzymany w localStorage (zapis po każdej zmianie).
import catalogJson from './catalog.json';
import musclesJson from '../data/muscles.json';
import { calibrateRir, contextKey, suggest, toTarget, type HSession, type HSet, type HTarget, type TrainerState } from '../shared/trainer';
import { localDate, localTime, setScore, unpackHistory, type AltLabels, type PcBundle, type PhoneBundle, type TransferCustom, type TransferLast, type TransferPlan, type TransferWorkout } from '../shared/transfer';

export interface CatalogItem { id: string; name: string; nameEn: string; eq: string; vol: boolean; top: string | null; verified: boolean; img: boolean; custom?: boolean }
export const CATALOG: CatalogItem[] = (catalogJson as [string, string, string, string, number, string | null, number, number][])
  .map(([id, name, nameEn, eq, vol, top, v, img]) => ({ id, name, nameEn, eq, vol: !!vol, top, verified: !!v, img: !!img }));
const MUSCLE_NAMES: Record<string, string> = Object.fromEntries(musclesJson.muscles.map(m => [m.id, m.name.replace(/\s*\(.*\)$/, '')]));
export const muscleName = (id: string | null) => (id ? MUSCLE_NAMES[id] ?? '' : '');

export interface PSet {
  id: string; kg: number | null; reps: number | null; dur: number | null; rpe: number | null; warmup: boolean; doneAt: number | null; restSec: number | null;
  /** Powtórzenia w łatwiejszym wariancie (gdy ćwiczenie ma `alt`) */
  repsAlt?: number | null;
}
export interface PExercise {
  id: string; exerciseId: string; repsMin: number | null; repsMax: number | null; restSec: number | null; notes: string; sets: PSet[];
  /** Superseria: sąsiednie ćwiczenia z tym samym identyfikatorem robione na zmianę */
  ss?: string | null;
  /** Dwa warianty powtórzeń w serii: [pełny, łatwiejszy] */
  alt?: AltLabels | null;
  /** Cel trenera z chwili rozpoczęcia ćwiczenia – zapisywany, żeby trener mógł porównać cel z wynikiem */
  tgt?: HTarget | null;
}
export interface PWorkout { id: string; name: string; planId: string | null; startedAt: number; endedAt: number | null; notes: string; exercises: PExercise[]; sentAt: number | null }
/** Przerwa po serii. `next` = przejście w superserii do kolejnego ćwiczenia (bez odliczania i sygnału). */
export interface Rest { setId: string; from: number; target: number; next?: string | null }
export interface Settings { kgStep: number; defaultRest: number; sound: boolean }

export interface PhoneState {
  v: 1;
  profile: string | null;
  receivedAt: string | null;
  plans: TransferPlan[];
  /** Własne ćwiczenia: z komputera albo dodane na telefonie (local = jeszcze nieznane komputerowi) */
  custom: (TransferCustom & { local?: boolean })[];
  last: Record<string, TransferLast>;
  /** Treningi z oceną trudności wg komputera (stan z chwili odbioru planów) */
  rated: Record<string, number>;
  /** Ćwiczenia zapisywane w dwóch wariantach powtórzeń – zapamiętane nazwy wariantów */
  alt: Record<string, AltLabels>;
  /** Historia serii z komputera (stan z chwili odbioru planów) */
  hist: Record<string, HSession[]>;
  active: PWorkout | null;
  rest: Rest | null;
  history: PWorkout[];
  settings: Settings;
}

const KEY = 'atlas-phone-v1';
export const emptyState = (): PhoneState => ({
  v: 1, profile: null, receivedAt: null, plans: [], custom: [], last: {}, rated: {}, alt: {}, hist: {}, active: null, rest: null, history: [],
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
  if (c) return { id: c.id, name: c.name, nameEn: '', eq: c.eq, vol: c.vol, top: c.top, verified: true, img: false, custom: true };
  return CATALOG_BY_ID.get(id);
}
const CATALOG_BY_ID = new Map(CATALOG.map(c => [c.id, c]));

/** Ostatni wynik ćwiczenia w danym kontekście (planie): najlepsza seria robocza z ostatniego takiego treningu. */
export function lastInContext(s: PhoneState, exerciseId: string, ctx: string | null): { d: string; kg: number | null; reps: number | null; repsAlt: number | null } | null {
  if (!ctx) return null;
  const h = exerciseHistory(s, exerciseId).find(x => x.c === ctx);
  const ws = h?.s.filter(x => !x[3] && ((x[1] ?? 0) > 0 || (x[4] ?? 0) > 0));
  if (!h || !ws?.length) return null;
  const top = ws.reduce((a, x) => (setScore(x[0], x[1], x[4]) > setScore(a[0], a[1], a[4]) ? x : a), ws[0]);
  return { d: h.d, kg: top[0], reps: top[1], repsAlt: top[4] ?? null };
}

/** Nowa seria z podpowiedzią: ostatni wynik w tym samym planie, a gdy go brak – ostatni wynik w ogóle. */
export function suggestedSet(s: PhoneState, exerciseId: string, repsMin: number | null, ctx: string | null = null): PSet {
  const lc = lastInContext(s, exerciseId, ctx);
  const last = s.last[exerciseId];
  const kg = lc ? lc.kg : last?.[1] ?? null, reps = lc ? lc.reps : last?.[2] ?? null, repsAlt = lc ? lc.repsAlt : last?.[3] ?? null;
  return { id: uid(), kg, reps: reps ?? repsMin ?? null, repsAlt, dur: null, rpe: null, warmup: false, doneAt: null, restSec: null };
}

export function newExercise(s: PhoneState, exerciseId: string, plan?: { sets: number; repsMin: number | null; repsMax: number | null; restSec: number | null; notes: string; ss?: string | null; alt?: AltLabels | null }, ctx: string | null = null): PExercise {
  const n = plan?.sets ?? 3;
  const alt = plan?.alt ?? s.alt[exerciseId] ?? null;
  const base = suggestedSet(s, exerciseId, plan?.repsMin ?? null, ctx);
  if (alt) base.repsAlt ??= 0; else base.repsAlt = null;
  return {
    id: uid(), exerciseId, repsMin: plan?.repsMin ?? null, repsMax: plan?.repsMax ?? null, restSec: plan?.restSec ?? null, notes: plan?.notes ?? '',
    ss: plan?.ss ?? null, alt,
    sets: Array.from({ length: n }, () => ({ ...base, id: uid() })),
  };
}

export function startWorkout(s: PhoneState, plan: TransferPlan | null): PWorkout {
  const w: PWorkout = {
    id: uid(), name: plan?.name ?? '', planId: plan?.id ?? null, startedAt: Date.now(), endedAt: null, notes: '', sentAt: null,
    exercises: plan ? plan.exercises.map(e => newExercise(s, e.exerciseId, e, plan.id)) : [],
  };
  w.exercises = w.exercises.map(e => withTarget(s, w, e));
  return w;
}

/** Zapamiętuje przy ćwiczeniu cel trenera (jeśli trener ma dość danych). */
export function withTarget(s: PhoneState, w: Pick<PWorkout, 'planId' | 'name'>, e: PExercise): PExercise {
  const g = trainerFor(s, w, e).suggestion;
  const out: PExercise = { ...e, tgt: g ? toTarget(g) : null };
  // pewny cel (≥ 3 ocenione treningi w tym planie) od razu w seriach; przy „wstępnie” i „szacunku” serie zostają z ostatnim wynikiem
  if (g && g.level === 'plan') out.sets = fillSets(out, [g.kg, g.reps, g.repsAlt]);
  return out;
}

/** Wpisuje [kg, powt., powt. łatwiejsze] do nieodhaczonych serii roboczych ćwiczenia. */
export function fillSets(e: PExercise, v: [number | null, number | null, number | null]): PSet[] {
  return e.sets.map(z => (z.doneAt || z.warmup ? z : { ...z, kg: v[0] ?? z.kg, reps: v[1], repsAlt: e.alt ? v[2] : z.repsAlt }));
}

/** Czy nieodhaczone serie robocze mają wpisany cel trenera. */
export function setsAtTarget(e: PExercise): boolean {
  const t = e.tgt, open = e.sets.filter(z => !z.doneAt && !z.warmup);
  return !!t && open.length > 0 && open.every(z => (t[0] == null || z.kg === t[0]) && z.reps === t[1] && (!e.alt || (z.repsAlt ?? 0) === (t[2] ?? 0)));
}

/** Szacowany czas trwania serii (s), gdy nie wiemy, kiedy się zaczęła: ~3 s na powtórzenie. */
export const estSetSec = (st: PSet) => st.dur ?? Math.min(90, Math.max(15, (st.reps ?? 8) * 3));

/** Trening z telefonu w formacie dla komputera. Tylko odhaczone serie; ćwiczenia bez serii pomijamy. */
export function toTransfer(w: PWorkout): TransferWorkout {
  const end = w.endedAt ?? Date.now();
  return {
    id: w.id, date: localDate(w.startedAt), startTime: localTime(w.startedAt), durationMin: Math.max(1, Math.round((end - w.startedAt) / 60000)),
    name: w.name, notes: w.notes, ...(w.planId ? { planId: w.planId } : {}),
    exercises: w.exercises.map(e => ({
      exerciseId: e.exerciseId, notes: e.notes,
      ...(e.ss ? { ss: e.ss } : {}), ...(e.alt ? { alt: e.alt } : {}), ...(e.tgt ? { t: e.tgt } : {}),
      sets: e.sets.filter(x => x.doneAt).map(x => ({ reps: x.reps, weightKg: x.kg, restSec: x.restSec, durationSec: x.dur, rpe: x.rpe, warmup: x.warmup, ...(e.alt ? { repsAlt: x.repsAlt ?? 0 } : {}) })),
    })).filter(e => e.sets.length),
  };
}

export function phoneBundle(s: PhoneState, ws: PWorkout[]): PhoneBundle {
  const used = new Set(ws.flatMap(w => w.exercises.map(e => e.exerciseId)));
  return {
    k: 'workouts', v: 1, sentAt: new Date().toISOString(), workouts: ws.map(toTransfer), profile: s.profile,
    custom: s.custom.filter(c => used.has(c.id)).map(({ id, name, eq, vol, top }) => ({ id, name, eq, vol, top })),
  };
}

/** Przyjęcie planów z komputera. Własne ćwiczenia dodane na telefonie zostają, dopóki komputer ich nie zna. */
export function applyPcBundle(s: PhoneState, b: PcBundle): PhoneState {
  const fromPc = new Set(b.custom.map(c => c.id));
  const last = { ...s.last };
  for (const [id, v] of Object.entries(b.last)) if (!last[id] || last[id][0] <= v[0]) last[id] = v;
  return {
    ...s, profile: b.profile, receivedAt: b.sentAt, plans: b.plans, last, rated: b.rated ?? s.rated, alt: { ...s.alt, ...(b.alt ?? {}) }, hist: b.hist ? unpackHistory(b.hist) : s.hist,
    custom: [...b.custom, ...s.custom.filter(c => c.local && !fromPc.has(c.id))],
  };
}

/** Po zakończeniu treningu zapamiętujemy najlepszą serię każdego ćwiczenia jako „ostatnio”. */
export function updateLast(last: Record<string, TransferLast>, w: PWorkout): Record<string, TransferLast> {
  const out = { ...last };
  const date = localDate(w.startedAt);
  for (const e of w.exercises) {
    const done = e.sets.filter(x => x.doneAt && !x.warmup && ((x.reps ?? 0) > 0 || (e.alt && (x.repsAlt ?? 0) > 0)));
    if (!done.length) continue;
    const score = (x: PSet) => setScore(x.kg, x.reps, e.alt ? x.repsAlt : null);
    const best = done.reduce((a, x) => (score(x) >= score(a) ? x : a), done[0]);
    out[e.exerciseId] = e.alt ? [date, best.kg, best.reps, best.repsAlt ?? 0] : [date, best.kg, best.reps];
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

/** Treningi z oceną trudności dla ćwiczenia: stan z komputera + treningi zrobione na telefonie po ostatnim odbiorze planów. */
export function ratedCount(s: PhoneState, exerciseId: string): number {
  const since = s.receivedAt ? Date.parse(s.receivedAt) : 0;
  const local = s.history.filter(w => (w.endedAt ?? 0) > since && w.exercises.some(e => e.exerciseId === exerciseId && e.sets.some(x => x.doneAt && !x.warmup && x.rpe != null))).length;
  return (s.rated[exerciseId] ?? 0) + local;
}

/** Indeksy ćwiczeń tej samej superserii co ćwiczenie `i` (sąsiednie, ten sam identyfikator). */
export function supersetOf(ex: PExercise[], i: number): number[] {
  const id = ex[i]?.ss;
  if (!id) return [i];
  let a = i, b = i;
  while (a > 0 && ex[a - 1].ss === id) a--;
  while (b < ex.length - 1 && ex[b + 1].ss === id) b++;
  return Array.from({ length: b - a + 1 }, (_, k) => a + k);
}

/**
 * Co po odhaczeniu serii nr `si` ćwiczenia `ei`: w superserii przejście do kolejnego ćwiczenia grupy, które ma tę serię nieodhaczoną
 * (bez przerwy), a po ostatnim ćwiczeniu rundy – przerwa (najdłuższa z przerw ćwiczeń grupy).
 */
export function afterSet(ex: PExercise[], ei: number, si: number, defaultRest: number): { next: number | null; rest: number } {
  const g = supersetOf(ex, ei);
  const rest = Math.max(...g.map(k => ex[k].restSec ?? defaultRest));
  for (const k of g) if (k > ei) { const s = ex[k].sets[si]; if (s && !s.doneAt) return { next: k, rest: 0 }; }
  return { next: null, rest: g.length > 1 ? rest : ex[ei].restSec ?? defaultRest };
}

/** Kontekst treningu dla trenera: plan, a bez planu plan o tej samej nazwie albo sama nazwa. */
export const workoutContext = (s: PhoneState, w: Pick<PWorkout, 'planId' | 'name'>) => contextKey(w.planId, w.name, s.plans);

/** Historia ćwiczenia: z komputera + treningi z telefonu, których komputer jeszcze nie znał przy ostatnim odbiorze planów. Od najnowszych. */
export function exerciseHistory(s: PhoneState, exerciseId: string): HSession[] {
  const since = s.receivedAt ? Date.parse(s.receivedAt) : 0;
  const local: HSession[] = [];
  for (const w of s.history) {
    // niewysłane albo zrobione po ostatnim odbiorze – tych komputer jeszcze nie zna
    if (w.sentAt && (w.endedAt ?? 0) <= since) continue;
    const c = workoutContext(s, w);
    for (const e of w.exercises) {
      if (e.exerciseId !== exerciseId) continue;
      const done = e.sets.filter(x => x.doneAt);
      if (!done.length) continue;
      local.push({ d: localDate(w.startedAt), c, n: w.name || 'Trening', s: done.map(x => [x.kg, x.dur != null && x.reps == null ? null : x.reps, x.rpe, x.warmup ? 1 : 0, ...(e.alt ? [x.repsAlt ?? 0] : [])] as HSet), ...(e.tgt ? { t: e.tgt } : {}) });
    }
  }
  return [...local, ...(s.hist[exerciseId] ?? [])].sort((a, b) => b.d.localeCompare(a.d));
}

/** Podpowiedź trenera dla ćwiczenia w bieżącym treningu. */
export function trainerFor(s: PhoneState, w: Pick<PWorkout, 'planId' | 'name'>, e: PExercise): TrainerState {
  const range: [number | null, number | null] | null = e.repsMin != null || e.repsMax != null ? [e.repsMin, e.repsMax] : null;
  return suggest(exerciseHistory(s, e.exerciseId), workoutContext(s, w), range, !!e.alt, s.settings.kgStep, { rirOffset: rirCalibration(s).offset });
}

/** Korekta skali trudności z całej historii (wszystkie ćwiczenia); liczona raz na stan historii. */
const calCache = new WeakMap<object, WeakMap<object, { offset: number; pairs: number }>>();
export function rirCalibration(s: PhoneState): { offset: number; pairs: number } {
  let m = calCache.get(s.hist); if (!m) { m = new WeakMap(); calCache.set(s.hist, m); }
  let c = m.get(s.history);
  if (!c) {
    const ids = new Set([...Object.keys(s.hist), ...s.history.flatMap(w => w.exercises.map(e => e.exerciseId))]);
    c = calibrateRir(Object.fromEntries([...ids].map(id => [id, exerciseHistory(s, id)])));
    m.set(s.history, c);
  }
  return c;
}
