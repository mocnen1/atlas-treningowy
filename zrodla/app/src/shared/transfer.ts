// Przesyłanie danych kodami QR między telefonem a komputerem.
//
// Dane (JSON) → kompresja deflate → podział na kawałki → każdy kawałek w osobnym kodzie QR (tryb binarny).
// Ramka: 'A''T' | wersja | rodzaj | id wiadomości (4 B) | nr części | liczba części | dane
// Odbiorca zbiera części o tym samym id w dowolnej kolejności; gdy ma wszystkie, rozpakowuje JSON.
import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate';

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
export interface TransferSet { reps: number | null; weightKg: number | null; restSec: number | null; durationSec: number | null; rpe: number | null; warmup: boolean }
export interface TransferWorkout {
  id: string; date: string; startTime: string | null; durationMin: number | null; name: string; notes: string;
  exercises: { exerciseId: string; notes: string; sets: TransferSet[] }[];
}
export interface PhoneBundle {
  k: 'workouts'; v: number; sentAt: string; workouts: TransferWorkout[]; custom: TransferCustom[];
  /** Nazwa profilu z komputera, z którego telefon ostatnio odebrał plany (brak w starszych wersjach) */
  profile?: string | null;
}

/** Plan treningowy przesyłany na telefon. */
export interface TransferPlanExercise { exerciseId: string; sets: number; repsMin: number | null; repsMax: number | null; restSec: number | null; notes: string }
export interface TransferPlan { id: string; name: string; exercises: TransferPlanExercise[] }
export interface TransferCustom { id: string; name: string; eq: string; vol: boolean; top: string | null }
/** Ostatni wynik ćwiczenia: data, ciężar i powtórzenia najlepszej serii roboczej */
export type TransferLast = [date: string, kg: number | null, reps: number | null];
export interface PcBundle {
  k: 'plans'; v: number; sentAt: string; profile: string; plans: TransferPlan[]; custom: TransferCustom[]; last: Record<string, TransferLast>;
  /** Liczba treningów z oceną trudności na ćwiczenie (gotowość trenera); brak w starszych wersjach */
  rated?: Record<string, number>;
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
