import { useMemo, useState } from 'react';
import { useStore } from '../store/store';
import { allReps, e1rm, isWorkingSet, sessionEffort } from '../lib/stats';
import { fmtRepsAlt, setScore } from '../shared/transfer';
import { TRAINER_MIN_SESSIONS, effortPct } from '../shared/effort';
import { calibrateRir, outcome, suggest, type HSet } from '../shared/trainer';
import { sessionsByExercise } from '../lib/pcBundle';
import { ExerciseFilters, ExerciseList, MuscleBars, emptyFilter, fmtDate, fmtNum, useFilteredExercises } from '../ui/common';
import { ExerciseEditor } from './ExerciseEditor';
import { ExerciseAnim } from '../shared/ExerciseImage';

export function ExercisesView() {
  const { db, exercises, lookup, profile } = useStore();
  const [f, setF] = useState(emptyFilter());
  const [sel, setSel] = useState<string | null>(null);
  const [edit, setEdit] = useState<null | { customId?: string; builtinId?: string }>(null);
  const { list, muscle } = useFilteredExercises(exercises, f, null, 0.5);
  const ex = sel ? lookup(sel) : undefined;

  // Historia wybranego ćwiczenia w aktywnym profilu
  const history = useMemo(() => {
    if (!sel) return [];
    return db.workouts.filter(w => w.profileId === profile!.id)
      .flatMap(w => w.exercises.filter(e => e.exerciseId === sel).map(e => ({ w, sets: e.sets.filter(isWorkingSet), labels: e.altLabels, target: e.target })))
      .filter(h => h.sets.length)
      .map(h => {
        const best = h.sets.reduce((a, s) => (setScore(s.weightKg, s.reps, s.repsAlt) > setScore(a.weightKg, a.reps, a.repsAlt) ? s : a), h.sets[0]);
        return { date: h.w.date, labels: h.labels, target: h.target, plan: h.w.name, out: outcome({ d: h.w.date, c: '', n: '', s: h.sets.map(s => [s.weightKg, s.reps, s.rpe, 0, s.repsAlt] as HSet), t: h.target }), sets: h.sets, effort: sessionEffort(h.sets), best, est: e1rm(best.weightKg ?? 0, best.reps ?? 0), vol: h.sets.reduce((a, s) => a + allReps(s) * (s.weightKg ?? 0), 0) };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [db.workouts, sel, profile]);
  const maxEst = Math.max(1, ...history.map(h => h.est));

  return (
    <div className="page">
      <div className="page-head">
        <div><div className="eyebrow">{exercises.length} ćwiczeń · {db.customExercises.length} własnych</div><h1>Ćwiczenia</h1></div>
        <div className="actions"><button className="btn primary" onClick={() => setEdit({})}>Nowe własne ćwiczenie</button></div>
      </div>
      <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(360px, 1fr)' }}>
        <div className="panel">
          <ExerciseFilters f={f} set={setF} showMuscle />
          <div className="muted" style={{ fontSize: 12 }}>{list.length} ćwiczeń{muscle ? ' (udział wybranego mięśnia min. 50%)' : ''}</div>
          <ExerciseList list={list} muscle={muscle} selected={sel} onSelect={e => setSel(e.id)} limit={60} />
        </div>
        <div className="side" style={{ position: 'sticky', top: 16 }}>
          {ex ? <>
            <div className="panel">
              <div className="eyebrow">{ex.equipmentPl} · {ex.categoryPl}{ex.levelPl ? ` · ${ex.levelPl}` : ''}</div>
              <h2 style={{ fontSize: 22, textTransform: 'none' }}>{ex.name}</h2>
              {ex.nameEn && <div className="muted">{ex.nameEn}</div>}
              {ex.hasImg ? <ExerciseAnim id={ex.id} alt={ex.name} /> : <p className="note">Brak zdjęć dla tego ćwiczenia.</p>}
              <div className="row">
                <span className="chip">wagi: {ex.weightsSource}{db.weightOverrides[ex.id] ? ' (poprawione przez Ciebie)' : ''}</span>
                {ex.source === 'własne'
                  ? <button className="btn small" onClick={() => setEdit({ customId: ex.id })}>Edytuj</button>
                  : <button className="btn small" onClick={() => setEdit({ builtinId: ex.id })}>Popraw wagi mięśni</button>}
              </div>
              <MuscleBars weights={ex.muscles} />
              {!ex.countsForVolume && <p className="note">Nie liczy się do objętości treningowej.</p>}
            </div>
            <div className="panel">
              <h2>Twoja historia</h2>
              <TrainerByPlan exerciseId={sel!} />
              {history.length === 0 ? <p className="note">Jeszcze nie wykonywałeś tego ćwiczenia w profilu {profile!.name}.</p> : (
                <table className="mtable">
                  <thead><tr><th>Data</th><th>Trening</th><th>Najlepsza seria</th><th>Cel trenera</th><th className="r">Szac. 1RM</th><th className="r">Serie</th><th className="r">Trudność</th></tr></thead>
                  <tbody>{history.slice(0, 30).map((h, i) => (
                    <tr key={i}>
                      <td>{fmtDate(h.date)}</td>
                      <td className="muted">{h.plan || '–'}</td>
                      <td className="num">{h.best.weightKg != null ? `${fmtNum(h.best.weightKg)} kg × ` : ''}{h.best.reps == null && h.best.repsAlt == null ? (h.best.durationSec ? `${h.best.durationSec} s` : '–') : fmtRepsAlt(h.best.reps, h.best.repsAlt, h.labels)}</td>
                      <td className="num">{h.target ? <>{h.target[0] != null ? `${fmtNum(h.target[0])} × ` : ''}{h.target[2] != null ? `${h.target[1]} + ${h.target[2]}` : h.target[1]}
                        {h.out && <span className={`pill out-${h.out}`}>{{ beat: 'przebity', hit: 'trafiony', miss: 'nietrafiony' }[h.out]}</span>}</> : <span className="muted">–</span>}</td>
                      <td className="r num"><span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <i className="meter" style={{ width: 50, ['--w' as any]: `${(h.est / maxEst) * 100}%` }} />{h.est ? fmtNum(h.est) : '–'}</span></td>
                      <td className="r num">{h.sets.length}</td>
                      <td className="r num">{h.effort != null ? `${effortPct(h.effort)}%` : '–'}</td>
                    </tr>))}</tbody>
                </table>
              )}
              <p className="note">Szacowany 1RM wg wzoru Epleya (ciężar × (1 + powtórzenia/30)). Wiarygodny dla serii do ok. 10 powtórzeń.</p>
            </div>
            {ex.instructionsEn.length > 0 && (
              <div className="panel">
                <h2>Technika (po angielsku)</h2>
                <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 13 }}>{ex.instructionsEn.map((s, i) => <li key={i}>{s}</li>)}</ol>
              </div>
            )}
          </> : <div className="panel"><h2>Wybierz ćwiczenie</h2><p className="note">Zobaczysz zaangażowane mięśnie, swoją historię i możliwość poprawienia wag. Filtr „każdy mięsień” pokaże ćwiczenia, w których wybrany mięsień ma co najmniej 50% udziału.</p></div>}
        </div>
      </div>
      {edit && <ExerciseEditor {...edit} onClose={() => setEdit(null)} onSaved={id => setSel(id)} />}
    </div>
  );
}

/** Trener wg planów: dla każdego planu (kontekstu), w którym robiono ćwiczenie – liczba ocenionych treningów i cel na następny raz. */
function TrainerByPlan({ exerciseId }: { exerciseId: string }) {
  const { db, profile } = useStore();
  const plans = db.plans.filter(p => p.profileId === profile!.id);
  const rows = useMemo(() => {
    const all = sessionsByExercise(db, profile!.id);
    const cal = calibrateRir(all);
    const sessions = all[exerciseId] ?? [];
    const names = new Map<string, string>(plans.map(p => [p.id, p.name]));
    for (const x of sessions) if (!names.has(x.c)) names.set(x.c, x.n);
    const ctxs = new Set(sessions.map(s => s.c));
    for (const p of plans) if (p.exercises.some(e => e.exerciseId === exerciseId)) ctxs.add(p.id);
    const alt = db.workouts.some(w => w.exercises.some(e => e.exerciseId === exerciseId && e.altLabels));
    return [...ctxs].map(c => {
      const pe = plans.find(p => p.id === c)?.exercises.find(e => e.exerciseId === exerciseId);
      return { c, name: names.get(c) ?? c, tr: suggest(sessions, c, pe ? [pe.repsMin, pe.repsMax] : null, alt, 2.5, { rirOffset: cal.offset }) };
    }).sort((a, b) => b.tr.ctxRated - a.tr.ctxRated);
  }, [db.workouts, db.plans, exerciseId, profile]);
  if (!rows.length) return <div className="trainer">Trener: brak treningów z tym ćwiczeniem.</div>;
  return (
    <div className="trainer-plans">
      <div className="muted" style={{ fontSize: 12.5 }}>Trener liczy osobno dla każdego planu (inne zmęczenie przed ćwiczeniem). Podpowiedź widać na telefonie w trakcie treningu.</div>
      <table className="mtable">
        <thead><tr><th>Plan / trening</th><th className="r">Ocenione</th><th>Cel na następny raz</th></tr></thead>
        <tbody>{rows.map(({ c, name, tr }) => {
          const g = tr.suggestion;
          return (
            <tr key={c} style={{ cursor: 'default' }}>
              <td>{name}</td>
              <td className="r num">{Math.min(tr.ctxRated, 99)}/{TRAINER_MIN_SESSIONS}</td>
              <td>{g ? <><b className="num">{g.kg != null ? `${fmtNum(g.kg)} kg × ` : ''}{g.repsAlt != null ? `${g.reps} + ${g.repsAlt}` : g.reps}</b>{' '}
                <span className="muted" style={{ fontSize: 12 }}>{g.level === 'plan' ? '' : g.level === 'mixed' ? '(wstępnie)' : '(szacunek z innego planu)'}</span>
                <div className="muted" style={{ fontSize: 12 }}>{g.reason}{g.warn ? ' ' + g.warn : ''}</div></>
                : <span className="muted">za mało ocenionych treningów</span>}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}
