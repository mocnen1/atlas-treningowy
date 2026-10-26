// Przykładowy profil z 8 tygodniami treningów (push / pull / nogi), żeby wypróbować mapę obciążenia.
import { addDays } from '../ui/common';
import { todayIso, uid, type Profile, type Workout, type WorkoutSet } from '../store/types';

type Plan = [string, number, number, number][]; // id ćwiczenia, serie, powtórzenia, kg
const PUSH: Plan = [['Barbell_Bench_Press_-_Medium_Grip', 4, 6, 80], ['Incline_Dumbbell_Press', 3, 10, 28], ['Side_Lateral_Raise', 4, 15, 10],
  ['Triceps_Pushdown_-_Rope_Attachment', 3, 12, 25], ['Dumbbell_Shoulder_Press', 3, 10, 24]];
const PULL: Plan = [['Pullups', 4, 8, 0], ['Bent_Over_Barbell_Row', 3, 8, 70], ['Seated_Cable_Rows', 3, 12, 60],
  ['Face_Pull', 3, 15, 20], ['Barbell_Curl', 3, 10, 35], ['Hammer_Curls', 2, 12, 14]];
const LEGS: Plan = [['Barbell_Squat', 4, 6, 100], ['Romanian_Deadlift', 3, 8, 90], ['Leg_Press', 3, 12, 160],
  ['Lying_Leg_Curls', 3, 12, 40], ['Standing_Calf_Raises', 4, 12, 80], ['Cable_Crunch', 3, 15, 40]];

export function demoData(): { profile: Profile; workouts: Workout[] } {
  const profile: Profile = { id: uid(), name: 'Przykład (dane testowe)', bodyMassKg: 80, createdAt: new Date().toISOString(), targets: {}, bodyModel: 'male' };
  const workouts: Workout[] = [];
  const today = todayIso();
  const plans: [string, Plan][] = [['Push', PUSH], ['Pull', PULL], ['Nogi', LEGS]];
  let k = 0;
  for (let day = 56; day >= 1; day--) {
    const dow = new Date(addDays(today, -day) + 'T12:00:00').getDay();
    if (![1, 3, 5].includes(dow)) continue; // pn, śr, pt
    const [name, plan] = plans[k++ % 3];
    const progress = 1 + (56 - day) / 56 * 0.08; // ~8% progresu w 8 tygodni
    workouts.push({
      id: uid(), profileId: profile.id, date: addDays(today, -day), startTime: '17:30', durationMin: 65 + (k % 3) * 5, name, notes: '',
      source: 'ręcznie', createdAt: new Date().toISOString(), planId: null,
      exercises: plan.map(([exerciseId, sets, reps, kg]) => ({
        id: uid(), exerciseId, notes: '', supersetId: null, altLabels: null, target: null,
        sets: Array.from({ length: sets }, (_, i): WorkoutSet => ({
          id: uid(), reps: reps - (i === sets - 1 ? 1 : 0), weightKg: kg ? Math.round(kg * progress / 2.5) * 2.5 : null,
          restSec: reps <= 8 ? 150 : 90, durationSec: null, rpe: i === sets - 1 ? 9 : 8, warmup: false, repsAlt: null,
        })),
      })),
    });
  }
  return { profile, workouts };
}
