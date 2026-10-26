// Przesyłanie danych kodami QR między telefonem a komputerem.
//
// Dane (JSON) → kompresja deflate → podział na kawałki → każdy kawałek w osobnym kodzie QR (tryb binarny).
// Ramka: 'A''T' | wersja | rodzaj | id wiadomości (4 B) | nr części | liczba części | dane
// Odbiorca zbiera części o tym samym id w dowolnej kolejności; gdy ma wszystkie, rozpakowuje JSON.
import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';
import type { HSession, HSet, HTarget } from './trainer';

export const PROTOCOL_VERSION = 1;
const MAGIC0 = 0x41, MAGIC1 = 0x54; // "AT"
const HEADER = 10;
/**
 * Bajty danych na jeden kod. 140 B + nagłówek daje kod wersji 8 (49×49 modułów) przy korekcji M.
 * Dobrane symulacją kamerki 720p: taki kod czyta się nawet przy rozmyciu, przekrzywieniu i ciemnym ekranie.
 */
export const CHUNK = 140;

export const enum Kind { PhoneWorkouts = 1, PcPlans = 2 }

/** Trening w formacie przesyłanym z telefonu (pola jak w aplikacji na komputer). */
export interface TransferSet {
  reps: number | null; weightKg: number | null; restSec: number | null; durationSec: number | null; rpe: number | null; warmup: boolean;
  /** Powtórzenia w łatwiejszym wariancie (np. „tylko nogi”); `reps` to wtedy wariant pełny. Brak w starszych wersjach. */
  repsAlt?: number | null;
}
/** Nazwy dwóch wariantów powtórzeń: [pełny, łatwiejszy] */
export type AltLabels = [string, string];
export interface TransferWorkout {
  id: string; date: string; startTime: string | null; durationMin: number | null; name: string; notes: string;
  /** Plan, z którego zaczęto trening (kontekst dla trenera); brak w starszych wersjach */
  planId?: string | null;
  exercises: {
    exerciseId: string; notes: string; sets: TransferSet[];
    /** Identyfikator superserii: sąsiednie ćwiczenia z tym samym identyfikatorem robione na zmianę */
    ss?: string | null; alt?: AltLabels | null;
    /** Cel trenera podany przed tym ćwiczeniem [kg, powt., powt. łatwiejsze, RPE] */
    t?: HTarget | null;
  }[];
}
export interface PhoneBundle {
  k: 'workouts'; v: number; sentAt: string; workouts: TransferWorkout[]; custom: TransferCustom[];
  /** Nazwa profilu z komputera, z którego telefon ostatnio odebrał plany (brak w starszych wersjach) */
  profile?: string | null;
}

/** Plan treningowy przesyłany na telefon. */
export interface TransferPlanExercise {
  exerciseId: string; sets: number; repsMin: number | null; repsMax: number | null; restSec: number | null; notes: string;
  ss?: string | null; alt?: AltLabels | null;
}
export interface TransferPlan { id: string; name: string; exercises: TransferPlanExercise[] }
export interface TransferCustom { id: string; name: string; eq: string; vol: boolean; top: string | null }
/** Ostatni wynik ćwiczenia: data, ciężar i powtórzenia najlepszej serii roboczej */
export type TransferLast = [date: string, kg: number | null, reps: number | null, repsAlt?: number | null];
export interface PcBundle {
  k: 'plans'; v: number; sentAt: string; profile: string; plans: TransferPlan[]; custom: TransferCustom[]; last: Record<string, TransferLast>;
  /** Liczba treningów z oceną trudności na ćwiczenie (gotowość trenera); brak w starszych wersjach */
  rated?: Record<string, number>;
  /** Ćwiczenia zapisywane w dwóch wariantach powtórzeń (ostatnio użyte nazwy) */
  alt?: Record<string, AltLabels>;
  /** Historia serii ćwiczeń (dla trenera i przycisku „Historia”); brak w starszych wersjach */
  hist?: PackedHistory;
}

/**
 * Historia w formie zwartej: konteksty [klucz, nazwa], a dla ćwiczenia lista [dzień od 2020-01-01, nr kontekstu, serie].
 * Seria: [kg, powtórzenia, RPE, rozgrzewka 0/1, (powtórzenia łatwiejsze)].
 */
export interface PackedHistory { c: [string, string][]; e: Record<string, ([number, number, HSet[]] | [number, number, HSet[], HTarget])[]> }
const DAY0 = Date.UTC(2020, 0, 1);
const toDay = (iso: string) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - DAY0) / 86_400_000);
const fromDay = (n: number) => new Date(DAY0 + n * 86_400_000).toISOString().slice(0, 10);

export function packHistory(byEx: Record<string, HSession[]>): PackedHistory {
  const c: [string, string][] = [], idx = new Map<string, number>();
  const e: PackedHistory['e'] = {};
  for (const [ex, ss] of Object.entries(byEx)) {
    e[ex] = ss.map(s => {
      if (!idx.has(s.c)) { idx.set(s.c, c.length); c.push([s.c, s.n]); }
      const sets = s.s.map(x => (x[4] == null ? x.slice(0, 4) : x) as HSet);
      return s.t ? [toDay(s.d), idx.get(s.c)!, sets, s.t] : [toDay(s.d), idx.get(s.c)!, sets];
    });
  }
  return { c, e };
}
export function unpackHistory(h: PackedHistory | undefined): Record<string, HSession[]> {
  const out: Record<string, HSession[]> = {};
  if (!h) return out;
  for (const [ex, ss] of Object.entries(h.e)) out[ex] = ss.map(([d, ci, s, t]) => ({ d: fromDay(d), c: h.c[ci]?.[0] ?? 'x', n: h.c[ci]?.[1] ?? '', s, ...(t ? { t } : {}) }));
  return out;
}

export type Bundle = PhoneBundle | PcBundle;

export function encodeFrames(bundle: Bundle, chunk = CHUNK): Uint8Array[] {
  const kind = bundle.k === 'workouts' ? Kind.PhoneWorkouts : Kind.PcPlans;
  const body = deflateSync(strToU8(JSON.stringify(bundle)), { level: 9 });
  const total = Math.max(1, Math.ceil(body.length / chunk));
  if (total > 255) throw new Error('Za dużo danych na kody QR (ponad 255 kodów). Wyślij mniej treningów naraz albo użyj pliku.');
  const id = (Math.random() * 0xffffffff) >>> 0;
  const frames: Uint8Array[] = [];
  for (let i = 0; i < total; i++) {
    const part = body.subarray(i * chunk, (i + 1) * chunk);
    const f = new Uint8Array(HEADER + part.length);
    f[0] = MAGIC0; f[1] = MAGIC1; f[2] = PROTOCOL_VERSION; f[3] = kind;
    f[4] = id >>> 24; f[5] = (id >>> 16) & 255; f[6] = (id >>> 8) & 255; f[7] = id & 255;
    f[8] = i; f[9] = total;
    f.set(part, HEADER);
    frames.push(f);
  }
  return frames;
}

export type FeedResult =
  | { status: 'ignored'; reason: string }
  | { status: 'progress'; have: number; total: number; kind: Kind }
  | { status: 'done'; bundle: Bundle; total: number };

/** Składa części wiadomości odczytane z kolejnych kodów. */
export class Assembler {
  private id = -1;
  private parts: (Uint8Array | undefined)[] = [];

  constructor(private expect?: Kind) {}

  reset() { this.id = -1; this.parts = []; }

  feed(bytes: ArrayLike<number>): FeedResult {
    if (bytes.length < HEADER + 1 || bytes[0] !== MAGIC0 || bytes[1] !== MAGIC1) return { status: 'ignored', reason: 'To nie jest kod Atlasu Treningowego.' };
    if (bytes[2] !== PROTOCOL_VERSION) return { status: 'ignored', reason: 'Kod z innej wersji aplikacji. Zaktualizuj obie aplikacje.' };
    const kind = bytes[3] as Kind;
    if (this.expect && kind !== this.expect) {
      return { status: 'ignored', reason: kind === Kind.PcPlans ? 'To kod z planami z komputera – odczytaj go telefonem.' : 'To kod z treningiem z telefonu – odczytaj go na komputerze.' };
    }
    const id = ((bytes[4] << 24) | (bytes[5] << 16) | (bytes[6] << 8) | bytes[7]) >>> 0;
    const idx = bytes[8], total = bytes[9];
    if (!total || idx >= total) return { status: 'ignored', reason: 'Uszkodzony kod.' };
    if (id !== this.id || this.parts.length !== total) { this.id = id; this.parts = new Array(total).fill(undefined); }
    this.parts[idx] = Uint8Array.from(Array.prototype.slice.call(bytes, HEADER));
    const have = this.parts.filter(Boolean).length;
    if (have < total) return { status: 'progress', have, total, kind };
    const len = this.parts.reduce((a, p) => a + p!.length, 0);
    const body = new Uint8Array(len);
    let o = 0; for (const p of this.parts) { body.set(p!, o); o += p!.length; }
    try {
      const bundle = JSON.parse(strFromU8(inflateSync(body))) as Bundle;
      this.reset();
      return { status: 'done', bundle, total };
    } catch {
      this.reset();
      return { status: 'ignored', reason: 'Nie udało się odczytać danych – zacznij skanowanie od nowa.' };
    }
  }
}

/** Plik awaryjny (gdy kamera nie łapie kodów): ten sam JSON, bez kompresji. */
export const bundleToFile = (b: Bundle) => JSON.stringify(b);
export function bundleFromFile(text: string): Bundle {
  const b = JSON.parse(text);
  if (!b || (b.k !== 'workouts' && b.k !== 'plans')) throw new Error('To nie jest plik przesyłania Atlasu Treningowego.');
  return b;
}

/** Data i godzina lokalna z czasu w ms. */
export function localDate(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function localTime(ms: number) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Najlepsza seria do „ostatnio”: najwyższy szacowany 1RM; przy wariantach – najwięcej pełnych, potem łatwiejszych powtórzeń. */
export function setScore(kg: number | null, reps: number | null, repsAlt?: number | null): number {
  const r = reps ?? 0, a = repsAlt ?? 0;
  return (kg ?? 0) * (1 + (r + a * 0.5) / 30) * 1000 + r * 10 + a * 0.5;
}

/** Zapis powtórzeń: „8”, przy wariantach „4 + 6” (z nazwami: „4 pełne + 6 tylko nogi”). */
export function fmtRepsAlt(reps: number | null, repsAlt: number | null | undefined, labels?: AltLabels | null): string {
  if (repsAlt == null) return reps == null ? '–' : String(reps);
  return labels ? `${reps ?? 0} ${labels[0]} + ${repsAlt} ${labels[1]}` : `${reps ?? 0} + ${repsAlt}`;
}
