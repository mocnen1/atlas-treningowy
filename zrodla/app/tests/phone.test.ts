import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, ratedCount, applyPcBundle, toTransfer, type PWorkout } from '../src/phone/state';

const w = (id: string, endedAt: number, rpe: number | null, warmup = false): PWorkout => ({
  id, name: '', planId: null, startedAt: endedAt - 3600_000, endedAt, notes: '', sentAt: null,
  exercises: [{ id: 'e', exerciseId: 'bench', repsMin: 8, repsMax: 12, restSec: 120, notes: '', sets: [
    { id: 's1', kg: 80, reps: 8, dur: null, rpe, warmup, doneAt: endedAt - 60_000, restSec: 120 },
    { id: 's2', kg: 80, reps: 8, dur: null, rpe: null, warmup: false, doneAt: null, restSec: null },
  ] }],
});

test('telefon: licznik trenera = stan z komputera + treningi po ostatnim odbiorze', () => {
  let s = emptyState();
  s = applyPcBundle(s, { k: 'plans', v: 1, sentAt: '2026-10-10T10:00:00Z', profile: 'B', plans: [], custom: [], last: {}, rated: { bench: 2 } });
  const after = Date.parse('2026-10-12T10:00:00Z'), before = Date.parse('2026-10-08T10:00:00Z');
  s = { ...s, history: [w('a', after, 9), w('b', before, 8), w('c', after, null), w('d', after, 7, true)] };
  assert.equal(ratedCount(s, 'bench'), 3, '2 z komputera + 1 nowy oceniony; stary, nieoceniony i rozgrzewkowy pomijane');
  assert.equal(ratedCount(s, 'squat'), 0);
});

test('telefon: starszy komputer bez pola rated nie kasuje liczników', () => {
  let s = { ...emptyState(), rated: { bench: 4 } };
  s = applyPcBundle(s, { k: 'plans', v: 1, sentAt: 'x', profile: 'B', plans: [], custom: [], last: {} });
  assert.equal(s.rated.bench, 4);
});

test('telefon: do komputera idą tylko odhaczone serie, z oceną trudności', () => {
  const t = toTransfer(w('a', Date.parse('2026-10-12T18:30:00'), 9));
  assert.equal(t.exercises[0].sets.length, 1);
  assert.equal(t.exercises[0].sets[0].rpe, 9);
  assert.equal(t.durationMin, 60);
});
