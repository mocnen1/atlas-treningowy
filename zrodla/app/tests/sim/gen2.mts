import QRCode from 'qrcode'; import fs from 'node:fs';
import { encodeFrames } from '../../src/shared/transfer';
const set = (kg: number, reps: number) => ({ reps, weightKg: kg, restSec: 143, durationSec: null, rpe: 8, warmup: false });
const ids = ['Barbell_Squat','Romanian_Deadlift','Leg_Press','Lying_Leg_Curls','Standing_Calf_Raises','Cable_Crunch','X_Bulgarian_Split_Squat'];
const w = { id: 'w1', date: '2026-10-20', startTime: '17:32', durationMin: 74, name: 'Nogi', notes: '', exercises: ids.map(exerciseId => ({ exerciseId, notes: '', sets: [set(60,10), set(100,6), set(100,6), set(100,5)] })) };
for (const chunk of [100, 140, 180, 250]) for (const ecc of ['L', 'M']) {
  const frames = encodeFrames({ k: 'workouts', v: 1, sentAt: 'x', workouts: [w], custom: [] } as any, chunk);
  const q = QRCode.create([{ data: new Uint8ClampedArray(frames[0]), mode: 'byte' }] as any, { errorCorrectionLevel: ecc as any });
  // telefon rysuje kod natywnie: 1 moduł = całkowita liczba pikseli, szerokość ~1000 px (ekran ~3x)
  const scale = Math.floor(1000 / (q.modules.size + 6));
  fs.writeFileSync(`${process.argv[2]}/q_${chunk}_${ecc}.png`, await QRCode.toBuffer([{ data: new Uint8ClampedArray(frames[0]), mode: 'byte' }] as any, { errorCorrectionLevel: ecc as any, margin: 3, scale }));
  console.log(chunk, ecc, 'frames', frames.length, 'version', q.version, 'modules', q.modules.size);
}
