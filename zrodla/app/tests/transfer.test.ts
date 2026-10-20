import { test } from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { readBarcodes, prepareZXingModule } from 'zxing-wasm/reader';
import { Assembler, encodeFrames, Kind, type PhoneBundle, type PcBundle } from '../src/shared/transfer';

prepareZXingModule({ overrides: { wasmBinary: fs.readFileSync('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm') as any } });
const set = (kg: number, reps: number) => ({ reps, weightKg: kg, restSec: 143, durationSec: null, rpe: 8, warmup: false });
const ids = ['Barbell_Squat', 'Romanian_Deadlift', 'Leg_Press', 'Lying_Leg_Curls', 'Standing_Calf_Raises', 'Cable_Crunch', 'X_Bulgarian_Split_Squat'];
export const sampleWorkout = (id: string) => ({
  id, date: '2026-10-20', startTime: '17:32', durationMin: 74, name: 'Nogi', notes: '',
  exercises: ids.map((exerciseId, k) => ({ exerciseId, notes: k === 0 ? 'kolano ok' : '', sets: [set(60, 10), set(100 + k * 2.5, 6), set(100 + k * 2.5, 6), set(100, 5)].map((s, i) => ({ ...s, warmup: i === 0 })) })),
});
const phone: PhoneBundle = { k: 'workouts', v: 1, sentAt: '2026-10-20T19:00:00Z', workouts: [sampleWorkout('mabc123xyz')], custom: [] };

async function roundTrip(frames: Uint8Array[], asm: Assembler, order: number[]) {
  let res: any;
  for (const i of order) {
    const png = PNG.sync.read(await QRCode.toBuffer([{ data: new Uint8ClampedArray(frames[i]), mode: 'byte' }] as any, { errorCorrectionLevel: 'M', margin: 3, width: 360 }));
    const found = await readBarcodes({ data: new Uint8ClampedArray(png.data), width: png.width, height: png.height, colorSpace: 'srgb' } as ImageData, { formats: ['QRCode'] });
    assert.ok(found[0]?.isValid, `kod ${i} nieczytelny`);
    res = asm.feed(found[0].bytes);
  }
  return res;
}

test('trening z telefonu: rozmiar i przesłanie przez kody QR w losowej kolejności z powtórzeniami', async () => {
  const json = JSON.stringify(phone).length;
  const frames = encodeFrames(phone);
  console.log(`  trening 7 ćwiczeń × 4 serie: JSON ${json} B → ${frames.reduce((a, f) => a + f.length, 0)} B w ${frames.length} kodach`);
  const order = [...frames.keys()].reverse(); order.splice(1, 0, order[0]);
  const res = await roundTrip(frames, new Assembler(Kind.PhoneWorkouts), order);
  assert.equal(res.status, 'done');
  assert.deepEqual(res.bundle, phone);
});

test('plany z komputera: kilka planów i 120 ostatnich wyników', async () => {
  const last: Record<string, any> = {};
  for (let i = 0; i < 120; i++) last[`Exercise_Name_Number_${i}`] = ['2026-10-1' + (i % 10), 50 + i, 8];
  const pc: PcBundle = { k: 'plans', v: 1, sentAt: 'x', profile: 'Bartek', custom: [{ id: 'C_1', name: 'Wiosłowanie Hammer', eq: 'maszyna', vol: true, top: 'lats' }],
    plans: ['Push A', 'Pull A', 'Nogi A', 'Push B', 'Pull B'].map((name, p) => ({ id: 'p' + p, name, exercises: ids.map(exerciseId => ({ exerciseId, sets: 3, repsMin: 8, repsMax: 12, restSec: 120, notes: '' })) })), last };
  const frames = encodeFrames(pc);
  console.log(`  5 planów + 120 wyników: JSON ${JSON.stringify(pc).length} B → ${frames.length} kodów`);
  const res = await roundTrip(frames, new Assembler(Kind.PcPlans), [...frames.keys()]);
  assert.equal(res.status, 'done');
  assert.deepEqual(res.bundle, pc);
});

test('odrzuca kod złego rodzaju i obce kody, nowa wiadomość zastępuje starą', () => {
  const f = encodeFrames(phone);
  assert.equal(new Assembler(Kind.PcPlans).feed(f[0]).status, 'ignored');
  assert.equal(new Assembler().feed([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]).status, 'ignored');
  const a = new Assembler(Kind.PhoneWorkouts);
  const big = encodeFrames(phone, 60);
  assert.ok(big.length > 2);
  assert.equal(a.feed(big[0]).status, 'progress');
  const other = encodeFrames({ ...phone, sentAt: 'y' }, 60);
  let r: any; for (const fr of other) r = a.feed(fr);
  assert.equal(r.status, 'done');
  assert.equal(r.bundle.sentAt, 'y');
});
