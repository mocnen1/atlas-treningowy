import { useMemo } from 'react';
import { useStore } from '../store/store';
import { todayIso, uid, type Workout } from '../store/types';
import { workoutSummary } from '../lib/stats';
import { shortName } from '../data/catalog';
import { dayOfMonth, fmtDur, fmtKg, monthShort, monthTitle, weekday } from '../ui/common';

export function newWorkout(profileId: string, date = todayIso()): Workout {
  return { id: uid(), profileId, date, startTime: null, durationMin: null, name: '', notes: '', exercises: [], source: 'ręcznie', createdAt: new Date().toISOString() };
}

export function WorkoutsView({ open }: { open: (id: string) => void }) {
  const { db, update, profile, lookup } = useStore();
  const mine = useMemo(() => db.workouts.filter(w => w.profileId === profile!.id)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.startTime ?? '').localeCompare(a.startTime ?? '') || b.createdAt.localeCompare(a.createdAt)), [db.workouts, profile]);

  const create = () => {
    const w = newWorkout(profile!.id);
    update(d => { d.workouts.push(w); });
    open(w.id);
  };

  let lastMonth = '';
  return (
    <div className="page">
      <div className="page-head">
        <div><div className="eyebrow">Profil: {profile!.name}</div><h1>Treningi</h1></div>
        <span className="sub">{mine.length} zapisanych</span>
        <div className="actions"><button className="btn primary" onClick={create}>Nowy trening</button></div>
      </div>

      {mine.length === 0 ? (
        <div className="empty">
          <h2>Brak treningów</h2>
          <p>Dodaj pierwszy trening: wybierz ćwiczenia i wpisz serie. Po kilku treningach mapa obciążenia pokaże, które mięśnie dostają za mało pracy.</p>
          <button className="btn primary" onClick={create}>Dodaj pierwszy trening</button>
        </div>
      ) : (
        <div className="wlist">
          {mine.map(w => {
            const s = workoutSummary(w, lookup);
            const m = monthTitle(w.date);
            const head = m !== lastMonth ? (lastMonth = m, <div className="month" key={'m' + m}>{m}</div>) : null;
            const title = w.name || w.exercises.map(e => lookup(e.exerciseId)?.name).filter(Boolean).slice(0, 2).join(', ') || 'Trening bez ćwiczeń';
            return [head, (
              <button key={w.id} className="wcard" onClick={() => open(w.id)}>
                <div className="wdate"><b>{dayOfMonth(w.date)}</b><span>{monthShort(w.date)} · {weekday(w.date)}</span></div>
                <div className="wbody">
                  <h3>{title}</h3>
                  <div className="wstats">
                    <span><b>{w.exercises.length}</b> ćwiczeń</span>
                    <span><b>{s.working}</b> serii roboczych</span>
                    {s.tonnage > 0 && <span><b>{fmtKg(s.tonnage)}</b> tonażu</span>}
                    {w.durationMin ? <span><b>{fmtDur(w.durationMin * 60)}</b></span> : null}
                    {w.startTime && <span>start {w.startTime}</span>}
                  </div>
                  {s.top.length > 0 && <div className="chips">{s.top.map(mid => <span key={mid} className="chip">{shortName(mid)}</span>)}</div>}
                </div>
                <span className="muted">Otwórz →</span>
              </button>
            )];
          })}
        </div>
      )}
    </div>
  );
}
