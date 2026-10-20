import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/store';
import { todayIso, uid, type Workout, type WorkoutSet } from '../store/types';
import { isWorkingSet, workoutLoad, workoutSummary } from '../lib/stats';
import { shortName } from '../data/catalog';
import { BodyViewer } from '../three/BodyViewer';
import { ConfirmButton, EffortSelect, fmtDate, fmtDur, fmtKg, fmtNum, rampColor } from '../ui/common';
import { ExercisePicker } from './ExercisePicker';
import { newWorkout } from './Workouts';
import { ExerciseAnim, ExerciseThumb } from '../shared/ExerciseImage';

const nowHM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const parseNum = (s: string) => { const t = s.trim().replace(',', '.'); if (!t) return null; const n = Number(t); return Number.isFinite(n) && n >= 0 ? n : undefined; };
const emptySet = (): WorkoutSet => ({ id: uid(), reps: null, weightKg: null, restSec: null, durationSec: null, rpe: null, warmup: false });

/** Pole liczbowe trzymające tekst w trakcie pisania (np. „82,”), zapisujące liczbę. */
function NumCell(p: { value: number | null; onChange: (v: number | null) => void; label: string; id: string; max?: number }) {
  const [text, setText] = useState(p.value == null ? '' : String(p.value).replace('.', ','));
  useEffect(() => { const cur = parseNum(text); if (cur !== p.value) setText(p.value == null ? '' : String(p.value).replace('.', ',')); }, [p.value]);
  return <input id={p.id} type="text" inputMode="decimal" aria-label={p.label} value={text}
    onChange={e => { setText(e.target.value); const n = parseNum(e.target.value); if (n !== undefined && (p.max == null || n == null || n <= p.max)) p.onChange(n); }} />;
}

export function WorkoutEditor({ id, back, open }: { id: string; back: () => void; open: (id: string) => void }) {
  const { db, update, profile, lookup } = useStore();
  const w = db.workouts.find(x => x.id === id);
  const [picker, setPicker] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [savedPlan, setSavedPlan] = useState(false);
  const [showImg, setShowImg] = useState<string | null>(null);
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 30_000); return () => clearInterval(t); }, []);

  const load = useMemo(() => (w ? workoutLoad(w, lookup) : {}), [w, lookup]);
  const maxEff = Math.max(1, ...Object.values(load).map(l => l.effSets));
  const summary = w ? workoutSummary(w, lookup) : null;

  // Poprzednie wykonanie danego ćwiczenia (najnowszy wcześniejszy trening tego profilu)
  const previous = useMemo(() => {
    const map = new Map<string, WorkoutSet[]>();
    if (!w) return map;
    const earlier = db.workouts.filter(x => x.profileId === w.profileId && x.id !== w.id && (x.date < w.date || (x.date === w.date && x.createdAt < w.createdAt)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    for (const we of w.exercises) {
      for (const x of earlier) {
        const hit = x.exercises.find(e => e.exerciseId === we.exerciseId);
        if (hit) { map.set(we.exerciseId, hit.sets.filter(isWorkingSet)); break; }
      }
    }
    return map;
  }, [db.workouts, w]);

  if (!w) return <div className="page"><p>Ten trening nie istnieje (mógł zostać usunięty).</p><button className="btn" onClick={back}>Wróć do listy</button></div>;

  const set = (fn: (d: Workout) => void) => update(d => { const x = d.workouts.find(y => y.id === id); if (x) fn(x); });
  const running = !!w.startTime && w.durationMin == null && w.date === todayIso();
  const elapsedMin = running ? (() => { const [h, m] = w.startTime!.split(':').map(Number); const n = new Date(); return Math.max(0, n.getHours() * 60 + n.getMinutes() - h * 60 - m); })() : 0;
  void tick;

  const addExercises = (ids: string[]) => {
    set(d => {
      for (const exId of ids) {
        const prev = previous.get(exId);
        const first = prev?.[0];
        d.exercises.push({ id: uid(), exerciseId: exId, notes: '', sets: [{ ...emptySet(), weightKg: first?.weightKg ?? null, reps: first?.reps ?? null }] });
      }
    });
    setPicker(false);
  };

  const duplicate = () => {
    const n = newWorkout(w.profileId);
    n.name = w.name;
    n.exercises = w.exercises.map(e => ({ id: uid(), exerciseId: e.exerciseId, notes: '', sets: e.sets.map(s => ({ ...s, id: uid() })) }));
    update(d => { d.workouts.push(n); });
    open(n.id);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <button className="btn ghost small" onClick={back}>← Treningi</button>
          <h1>{w.name || `Trening ${fmtDate(w.date)}`}</h1>
        </div>
        <div className="actions">
          <button className="btn" disabled={!w.exercises.length} onClick={() => {
            update(d => { d.plans.push({ id: uid(), profileId: w.profileId, name: w.name || `Plan z ${fmtDate(w.date)}`, createdAt: new Date().toISOString(),
              exercises: w.exercises.map(e => { const ws = e.sets.filter(isWorkingSet); const reps = ws.map(s => s.reps ?? 0).filter(Boolean);
                return { id: uid(), exerciseId: e.exerciseId, sets: Math.max(1, ws.length), repsMin: reps.length ? Math.min(...reps) : null, repsMax: reps.length ? Math.max(...reps) : null,
                  restSec: (() => { const r = ws.find(s => s.restSec)?.restSec; return r ? Math.max(30, Math.round(r / 15) * 15) : 120; })(), notes: e.notes }; }) }); });
            setSavedPlan(true);
          }}>{savedPlan ? 'Zapisano w Planach ✓' : 'Zapisz jako plan'}</button>
          <button className="btn" onClick={duplicate} title="Tworzy nowy trening na dziś z tymi samymi ćwiczeniami i seriami">Powtórz jako nowy</button>
          <ConfirmButton label="Usuń trening" confirm="Na pewno usunąć?" onConfirm={() => { update(d => { d.workouts = d.workouts.filter(x => x.id !== id); }); back(); }} />
        </div>
      </div>

      <div className="editor">
        <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
          <div className="panel">
            <div className="grid-form">
              <label className="field">Nazwa (opcjonalnie)<input id="w-name" placeholder="np. Push A, Nogi" value={w.name} onChange={e => set(d => { d.name = e.target.value; })} /></label>
              <label className="field">Data<input id="w-date" type="date" value={w.date} onChange={e => e.target.value && set(d => { d.date = e.target.value; })} /></label>
              <label className="field">Początek<input id="w-start" type="time" value={w.startTime ?? ''} onChange={e => set(d => { d.startTime = e.target.value || null; })} /></label>
              <label className="field">Czas trwania (min)
                <NumCell id="w-dur" label="Czas trwania w minutach" value={w.durationMin} onChange={v => set(d => { d.durationMin = v == null ? null : Math.round(v); })} />
              </label>
            </div>
            <div className="row">
              {!w.startTime && <button className="btn" onClick={() => set(d => { d.date = todayIso(); d.startTime = nowHM(); d.durationMin = null; })}>Zaczynam teraz</button>}
              {running && <><span className="muted">Trwa: <b className="num">{elapsedMin} min</b></span>
                <button className="btn" onClick={() => set(d => { d.durationMin = elapsedMin; })}>Zakończ trening</button></>}
              <label className="field" style={{ flex: 1, minWidth: 220 }}>Notatki<input id="w-notes" value={w.notes} onChange={e => set(d => { d.notes = e.target.value; })} placeholder="samopoczucie, sen, uwagi" /></label>
            </div>
          </div>

          {w.exercises.map((we, ei) => {
            const ex = lookup(we.exerciseId);
            const prev = previous.get(we.exerciseId) ?? [];
            const setEx = (fn: (e: typeof we) => void) => set(d => { const e = d.exercises.find(y => y.id === we.id); if (e) fn(e); });
            return (
              <section className="wex" key={we.id}>
                <div className="wex-head">
                  <span className="idx">{ei + 1}</span>
                  {ex?.hasImg && <button className="thumb-btn" onClick={() => setShowImg(v => (v === we.id ? null : we.id))} aria-label="Pokaż, jak wykonać ćwiczenie" title="Jak wykonać"><ExerciseThumb id={ex.id} has size={40} /></button>}
                  <div style={{ minWidth: 0 }}>
                    <h3>{ex?.name ?? `Nieznane ćwiczenie (${we.exerciseId})`}</h3>
                    {ex && <div className="muted" style={{ fontSize: 12 }}>{ex.equipmentPl} · {Object.keys(ex.muscles).slice(0, 3).map(shortName).join(', ')}</div>}
                  </div>
                  <div className="tools">
                    <button className="btn ghost small" disabled={ei === 0} onClick={() => set(d => { const a = d.exercises; [a[ei - 1], a[ei]] = [a[ei], a[ei - 1]]; })} aria-label="Przesuń wyżej">↑</button>
                    <button className="btn ghost small" disabled={ei === w.exercises.length - 1} onClick={() => set(d => { const a = d.exercises; [a[ei + 1], a[ei]] = [a[ei], a[ei + 1]]; })} aria-label="Przesuń niżej">↓</button>
                    <ConfirmButton className="small ghost" label="Usuń" confirm="Usunąć ćwiczenie?" onConfirm={() => set(d => { d.exercises = d.exercises.filter(y => y.id !== we.id); })} />
                  </div>
                </div>
                {showImg === we.id && ex && <div className="wex-img"><ExerciseAnim id={ex.id} alt={ex.name} /></div>}
                <div style={{ overflowX: 'auto' }}>
                  <table className="sets">
                    <thead><tr><th>Seria</th><th>Rozgrz.</th><th>Ciężar kg</th><th>Powt.</th><th>Czas s</th><th>Przerwa s</th><th title="Ile powtórzeń zostało w zapasie: 100% = upadek">Trudność</th><th>Poprzednio</th><th /></tr></thead>
                    <tbody>
                      {we.sets.map((s, si) => {
                        const ps = prev[si];
                        const upd = (fn: (x: WorkoutSet) => void) => setEx(e => { const t = e.sets.find(y => y.id === s.id); if (t) fn(t); });
                        const base = `s-${we.id}-${si}`;
                        return (
                          <tr key={s.id} className={s.warmup ? 'warm' : ''}>
                            <td className="n">{s.warmup ? 'R' : we.sets.slice(0, si + 1).filter(x => !x.warmup).length}</td>
                            <td><input id={`${base}-w`} type="checkbox" checked={s.warmup} onChange={e => upd(x => { x.warmup = e.target.checked; })} aria-label="Seria rozgrzewkowa" /></td>
                            <td><NumCell id={`${base}-kg`} label="Ciężar w kg" value={s.weightKg} onChange={v => upd(x => { x.weightKg = v; })} /></td>
                            <td><NumCell id={`${base}-r`} label="Powtórzenia" value={s.reps} onChange={v => upd(x => { x.reps = v == null ? null : Math.round(v); })} /></td>
                            <td><NumCell id={`${base}-t`} label="Czas serii w sekundach" value={s.durationSec} onChange={v => upd(x => { x.durationSec = v == null ? null : Math.round(v); })} /></td>
                            <td><NumCell id={`${base}-p`} label="Przerwa po serii w sekundach" value={s.restSec} onChange={v => upd(x => { x.restSec = v == null ? null : Math.round(v); })} /></td>
                            <td>{s.warmup ? <span className="muted">–</span> : <EffortSelect id={`${base}-rpe`} value={s.rpe} onChange={v => upd(x => { x.rpe = v; })} />}</td>
                            <td className="prev">{ps ? `${ps.weightKg != null ? fmtNum(ps.weightKg) + ' kg × ' : ''}${ps.reps ?? '–'}` : '–'}</td>
                            <td><button className="btn ghost small" onClick={() => setEx(e => { e.sets = e.sets.filter(y => y.id !== s.id); })} aria-label="Usuń serię">✕</button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="wex-foot">
                  <button className="btn small" onClick={() => setEx(e => { const last = e.sets[e.sets.length - 1]; e.sets.push(last ? { ...last, id: uid(), warmup: false } : emptySet()); })}>+ Seria</button>
                  <input id={`n-${we.id}`} placeholder="Notatka do ćwiczenia" value={we.notes} onChange={e => setEx(x => { x.notes = e.target.value; })} aria-label="Notatka do ćwiczenia" />
                </div>
              </section>
            );
          })}

          <button className="btn primary" style={{ justifySelf: 'start' }} onClick={() => setPicker(true)}>+ Dodaj ćwiczenie</button>
          <p className="note">„Trudność” to ile powtórzeń zostało w zapasie (100% = upadek, 80% = jeszcze 2 powtórzenia). Z tych ocen trener będzie dobierał ciężar – wystarczy ocenić ostatnią serię ćwiczenia. „Rozgrz.” oznacza serię rozgrzewkową: zapisuje się, ale nie liczy do objętości. Przy ćwiczeniach na czas (deska, zwis) wpisz „Czas s” zamiast powtórzeń. „Przerwa s” to odpoczynek po danej serii.</p>
        </div>

        <aside className="sticky">
          <div className="panel">
            <h2>Podsumowanie</h2>
            <div className="kpis">
              <div className="kpi"><b>{summary!.working}</b><span>serii roboczych</span></div>
              <div className="kpi"><b>{fmtKg(summary!.tonnage)}</b><span>tonaż</span></div>
              <div className="kpi"><b>{w.durationMin ? fmtDur(w.durationMin * 60) : running ? `${elapsedMin} min` : '–'}</b><span>czas</span></div>
              <div className="kpi"><b>{summary!.restSec ? fmtDur(summary!.restSec) : '–'}</b><span>przerwy łącznie</span></div>
            </div>
          </div>
          <BodyViewer compact paintKey={load}
            colorOf={m => load[m] ? rampColor(Math.min(1, load[m].effSets / maxEff)) : null}
            tooltip={m => `${shortName(m)}: ${fmtNum(load[m]?.effSets ?? 0)} ef. serii`}
            onHover={setHover} selected={hover} />
          <div className="panel">
            <h2>Mięśnie w tym treningu</h2>
            {Object.keys(load).length === 0 ? <p className="note">Dodaj ćwiczenia i serie robocze, żeby zobaczyć obciążenie mięśni.</p> : (
              <div className="mlist">
                {Object.entries(load).sort((a, b) => b[1].effSets - a[1].effSets).slice(0, 12).map(([m, l]) => (
                  <div key={m} className="mrow" onMouseEnter={() => setHover(m)} onMouseLeave={() => setHover(null)}>
                    <span className="mn">{shortName(m)}</span>
                    <i className="meter" style={{ ['--w' as any]: `${(l.effSets / maxEff) * 100}%`, ['--c' as any]: rampColor(l.effSets / maxEff) }} />
                    <span className="v">{fmtNum(l.effSets)}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="note">Efektywne serie = serie robocze × udział mięśnia w ćwiczeniu.</p>
          </div>
        </aside>
      </div>

      {picker && <ExercisePicker profileId={profile!.id} onClose={() => setPicker(false)} onAdd={addExercises} />}
    </div>
  );
}
