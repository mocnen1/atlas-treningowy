import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workoutLoad, periodStats, targetState, e1rm, weeksBetween, workoutSummary } from '../src/lib/stats';
import { normalizeDb } from '../src/store/types';

const EX: Record<string, any> = {
  bench: { id: 'bench', countsForVolume: true, muscles: { chest_stern: 1, delt_front: 0.5 } },
  stretch: { id: 'stretch', countsForVolume: false, muscles: { chest_stern: 1 } },
};
const lookup = (id: string) => EX[id];
const set = (o: any = {}) => ({ id: Math.random().toString(), reps: 8, weightKg: 100, restSec: 120, durationSec: null, rpe: null, warmup: false, ...o });
const wk = (date: string, exercises: any[]) => ({ id: date + Math.random(), profileId: 'p', date, startTime: null, durationMin: 60, name: '', notes: '', source: 'ręcznie', createdAt: date, exercises }) as any;

test('serie efektywne = serie robocze × waga; rozgrzewka i rozciąganie się nie liczą', () => {
  const w = wk('2026-10-01', [
    { id: 'a', exerciseId: 'bench', notes: '', sets: [set({ warmup: true, weightKg: 40 }), set(), set(), set({ reps: null })] },
    { id: 'b', exerciseId: 'stretch', notes: '', sets: [set()] },
  ]);
  const l = workoutLoad(w, lookup);
  assert.equal(l.chest_stern.effSets, 2);
  assert.equal(l.delt_front.effSets, 1);
  assert.equal(l.chest_stern.tonnage, 2 * 8 * 100);
  assert.equal(l.delt_front.tonnage, 800);
});

test('seria na czas (bez powtórzeń) liczy się jako robocza', () => {
  const l = workoutLoad(wk('2026-10-01', [{ id: 'a', exerciseId: 'bench', notes: '', sets: [set({ reps: null, durationSec: 45, weightKg: null })] }]), lookup);
  assert.equal(l.chest_stern.effSets, 1);
});

test('okres: średnia na tydzień, częstotliwość, granice dat włącznie', () => {
  const ws = [
    wk('2026-09-01', [{ id: 'a', exerciseId: 'bench', notes: '', sets: [set(), set(), set()] }]),
    wk('2026-09-14', [{ id: 'a', exerciseId: 'bench', notes: '', sets: [set()] }]),
    wk('2026-09-28', [{ id: 'a', exerciseId: 'bench', notes: '', sets: [set(), set()] }]),
    wk('2026-08-31', [{ id: 'a', exerciseId: 'bench', notes: '', sets: [set(), set(), set(), set()] }]), // poza okresem
  ];
  const { stats, weeks, workoutCount } = periodStats(ws, '2026-09-01', '2026-09-28', lookup);
  assert.equal(workoutCount, 3);
  assert.equal(weeks, 4);
  assert.equal(stats.chest_stern.effSets, 6);
  assert.equal(stats.chest_stern.perWeek, 1.5);
  assert.equal(stats.chest_stern.sessions, 3);
  assert.equal(stats.delt_front.sessions, 2, 'trening z 1 serią daje 0,5 serii na barki – poniżej progu 1');
  assert.equal(stats.chest_stern.lastDate, '2026-09-28');
});

test('tygodnie w okresie: 7 dni = 1 tydzień, minimum 1', () => {
  assert.equal(weeksBetween('2026-10-13', '2026-10-19'), 1);
  assert.equal(weeksBetween('2026-10-19', '2026-10-19'), 1);
  assert.equal(weeksBetween('2026-07-28', '2026-10-19'), 12);
});

test('stan względem celu', () => {
  assert.equal(targetState(0, [10, 20]), 'none');
  assert.equal(targetState(5, [10, 20]), 'below');
  assert.equal(targetState(10, [10, 20]), 'ok');
  assert.equal(targetState(20, [10, 20]), 'ok');
  assert.equal(targetState(21, [10, 20]), 'above');
  assert.equal(targetState(3, null), 'notarget');
  assert.equal(targetState(0, null), 'none');
});

test('szacowany 1RM wg Epleya', () => {
  assert.equal(e1rm(100, 1), 100);
  assert.ok(Math.abs(e1rm(100, 10) - 133.333) < 0.01);
  assert.equal(e1rm(0, 5), 0);
});

test('podsumowanie treningu: przerwy i tonaż', () => {
  const s = workoutSummary(wk('2026-10-01', [{ id: 'a', exerciseId: 'bench', notes: '', sets: [set(), set({ restSec: 60 }), set({ warmup: true, restSec: 30 })] }]), lookup);
  assert.equal(s.sets, 3); assert.equal(s.working, 2); assert.equal(s.tonnage, 1600); assert.equal(s.restSec, 210);
});

test('wczytywanie danych uzupełnia brakujące pola i odrzuca obce pliki', () => {
  const db = normalizeDb({ profiles: [{ id: 'p', name: 'A' }], workouts: [{ id: 'w', profileId: 'p', date: '2026-10-01', exercises: [{ id: 'e', exerciseId: 'bench', sets: [{ id: 's', reps: 5 }] }] }], activeProfileId: 'x' });
  assert.equal(db.activeProfileId, 'p');
  assert.deepEqual(db.profiles[0].targets, {});
  assert.equal(db.workouts[0].exercises[0].sets[0].warmup, false);
  assert.equal(db.workouts[0].exercises[0].sets[0].weightKg, null);
  assert.throws(() => normalizeDb({ foo: 1 }));
  assert.throws(() => normalizeDb(null));
});
