import QRCode from 'qrcode'; import fs from 'node:fs';
import { encodeFrames } from '../../src/shared/transfer';
const set = (kg: number, reps: number) => ({ reps, weightKg: kg, restSec: 143, durationSec: null, rpe: 8, warmup: false });
const ids = ['Barbell_Squat','Romanian_Deadlift','Leg_Press','Lying_Leg_Curls','Standing_Calf_Raises','Cable_Crunch','X_Bulgarian_Split_Squat'];
const w = { id: 'w1', date: '2026-10-20', startTime: '17:32', durationMin: 74, name: 'Nogi', notes: '', exercises: ids.map(exerciseId => ({ exerciseId, notes: '', sets: [set(60,10), set(100,6), set(100,6), set(100,5)] })) };
const frames = encodeFrames({ k: 'workouts', v: 1, sentAt: 'x', workouts: [w], custom: [] } as any);
for (const [i, f] of frames.entries()) fs.writeFileSync(`${process.argv[2]}/f${i}.png`, await QRCode.toBuffer([{ data: new Uint8ClampedArray(f), mode: 'byte' }] as any, { errorCorrectionLevel: 'M', margin: 3, width: 330 }));
