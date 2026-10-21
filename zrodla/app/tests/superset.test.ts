import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterSet, emptyState, newExercise, startWorkout, supersetOf, toTransfer, updateLast, applyPcBundle, type PExercise, type PSet } from '../src/phone/state';
import { linkNext, normalizeDb, supersetGroups } from '../src/store/types';
import { isWorkingSet, workoutLoad } from '../src/lib/stats';
import { fmtRepsAlt } from '../src/shared/transfer';

const set = (id: string, done = false, extra: Partial<PSet> = {}): PSet => ({ id, kg: 100, reps: 10, dur: null, rpe: null, warmup: false, doneAt: done ? 1 : null, restSec: null, ...extra });
const ex = (id: string, ss: string | null, rest: number | null, sets: PSet[]): PExercise => ({ id, exerciseId: id, repsMin: null, repsMax: null, restSec: rest, notes: '', sets, ss });

test('superseria: po serii pierwszego ćwiczenia od razu drugie, po drugim przerwa (najdłuższa z grupy)', () => {
  const a = ex('hack', 'g', 150, [set('a1', true), set('a2')]);
  const b = ex('calf', 'g', 60, [set('b1'), set('b2')]);
  const c = ex('curl', null, 90, [set('c1')]);
  const all = [a, b, c];
  assert.deepEqual(supersetOf(all, 0), [0, 1]);
  assert.deepEqual(supersetOf(all, 2), [2]);
  assert.deepEqual(afterSet(all, 0, 0, 120), { next: 1, rest: 0 });
  b.sets[0].doneAt = 2;
  assert.deepEqual(afterSet(all, 1, 0, 120), { next: null, rest: 150 }, 'po rundzie przerwa = max(150, 60)');
  assert.deepEqual(afterSet(all, 2, 0, 120), { next: null, rest: 90 }, 'zwykłe ćwiczenie: jego własna przerwa');
});

test('superseria: gdy drugie ćwiczenie ma mniej serii, ostatnia seria pierwszego kończy rundę przerwą', () => {
  const all = [ex('a', 'g', 120, [set('a1', true), set('a2', true), set('a3', true)]), ex('b', 'g', 60, [set('b1', true), set('b2', true)])];
  assert.deepEqual(afterSet(all, 0, 2, 120), { next: null, rest: 120 });
});

test('superseria: grupy tylko z sąsiednich ćwiczeń; łączenie i rozłączanie', () => {
  const arr = [{ supersetId: null }, { supersetId: null }, { supersetId: null }] as { supersetId: string | null }[];
  linkNext(arr, 0, true);
  assert.ok(arr[0].supersetId && arr[0].supersetId === arr[1].supersetId && arr[2].supersetId === null);
  linkNext(arr, 1, true);
  assert.deepEqual(supersetGroups(arr, x => x.supersetId), [[0, 1, 2]]);
  linkNext(arr, 0, false);
  assert.deepEqual(supersetGroups(arr, x => x.supersetId), [[0], [1, 2]]);
  assert.equal(arr[0].supersetId, null, 'pojedyncze ćwiczenie traci identyfikator');
  linkNext(arr, 1, false);
  assert.ok(arr.every(x => x.supersetId === null));
});

test('plan z superserią i wariantami trafia do treningu na telefonie', () => {
  const s = { ...emptyState(), last: { legs: ['2026-10-20', null, 4, 6] as [string, null, number, number] } };
  const w = startWorkout(s, { id: 'p', name: 'Nogi', exercises: [
    { exerciseId: 'hack', sets: 3, repsMin: 8, repsMax: 10, restSec: 150, notes: '', ss: 'x' },
    { exerciseId: 'calf', sets: 3, repsMin: 12, repsMax: 15, restSec: 60, notes: '', ss: 'x' },
    { exerciseId: 'legs', sets: 3, repsMin: null, repsMax: null, restSec: 90, notes: '', alt: ['pełne', 'tylko nogi'] },
  ] });
  assert.equal(w.exercises[0].ss, 'x'); assert.equal(w.exercises[1].ss, 'x'); assert.equal(w.exercises[2].ss, null);
  assert.deepEqual(w.exercises[2].alt, ['pełne', 'tylko nogi']);
  assert.equal(w.exercises[2].sets[0].reps, 4); assert.equal(w.exercises[2].sets[0].repsAlt, 6, 'podpowiedź z ostatniego wyniku');
  assert.equal(w.exercises[0].sets[0].repsAlt, null);
});

test('warianty powtórzeń: zapamiętane per ćwiczenie, wysyłane do komputera, liczone jako jedna seria', () => {
  let s = applyPcBundle(emptyState(), { k: 'plans', v: 1, sentAt: 'x', profile: 'B', plans: [], custom: [], last: {}, alt: { legs: ['pełne', 'nogi'] } });
  const e = newExercise(s, 'legs');
  assert.deepEqual(e.alt, ['pełne', 'nogi']);
  e.sets = [set('1', true, { kg: null, reps: 1, repsAlt: 9 }), set('2', true, { kg: null, reps: 4, repsAlt: 6 }), set('3', true, { kg: null, reps: 0, repsAlt: 10 })];
  const w = { id: 'w', name: '', planId: null, startedAt: Date.parse('2026-10-21T18:00:00'), endedAt: Date.parse('2026-10-21T19:00:00'), notes: '', sentAt: null, exercises: [e] };
  const t = toTransfer(w);
  assert.deepEqual(t.exercises[0].alt, ['pełne', 'nogi']);
  assert.deepEqual(t.exercises[0].sets.map(x => [x.reps, x.repsAlt]), [[1, 9], [4, 6], [0, 10]]);
  assert.deepEqual(updateLast({}, w).legs, ['2026-10-21', null, 4, 6], 'najlepsza seria: najwięcej pełnych');
  s = { ...s };
  // komputer: seria z samymi łatwiejszymi powtórzeniami też jest robocza i liczy się raz
  const db = normalizeDb({ profiles: [{ id: 'p', name: 'B' }], workouts: [{ id: 'w', profileId: 'p', date: '2026-10-21', exercises: [{ exerciseId: 'legs', altLabels: ['pełne', 'nogi'], sets: t.exercises[0].sets }] }] });
  const sets = db.workouts[0].exercises[0].sets;
  assert.ok(sets.every(isWorkingSet));
  const load = workoutLoad(db.workouts[0], () => ({ id: 'legs', countsForVolume: true, muscles: { abs: 1 } } as any));
  assert.equal(load.abs.effSets, 3);
  assert.equal(fmtRepsAlt(1, 9, ['pełne', 'nogi']), '1 pełne + 9 nogi');
  assert.equal(fmtRepsAlt(8, null), '8');
});

test('stare dane bez nowych pól: domyślnie brak superserii i wariantów', () => {
  const db = normalizeDb({ profiles: [], workouts: [{ id: 'w', profileId: 'p', date: '2026-01-01', exercises: [{ exerciseId: 'x', sets: [{ reps: 5 }] }] }], plans: [{ id: 'p', exercises: [{ exerciseId: 'x' }] }] });
  assert.equal(db.workouts[0].exercises[0].supersetId, null);
  assert.equal(db.workouts[0].exercises[0].altLabels, null);
  assert.equal(db.workouts[0].exercises[0].sets[0].repsAlt, null);
  assert.equal(db.plans[0].exercises[0].supersetId, null);
});
