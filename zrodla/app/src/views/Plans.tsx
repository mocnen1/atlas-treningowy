import { useState } from 'react';
import { useStore } from '../store/store';
import { uid, type Plan, type PlanExercise } from '../store/types';
import { shortName } from '../data/catalog';
import { ConfirmButton } from '../ui/common';
import { ExercisePicker } from './ExercisePicker';

const num = (s: string) => { const t = s.trim().replace(',', '.'); if (!t) return null; const n = Number(t); return Number.isFinite(n) && n >= 0 ? Math.round(n) : null; };
export const fmtRest = (s: number | null) => s == null ? '–' : s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} s`;
export const fmtReps = (a: number | null, b: number | null) => a == null && b == null ? '–' : a != null && b != null && a !== b ? `${a}–${b}` : String(a ?? b);

export function PlansView({ goPhone }: { goPhone: () => void }) {
  const { db, update, profile } = useStore();
  const plans = db.plans.filter(p => p.profileId === profile!.id);
  const [openId, setOpenId] = useState<string | null>(plans[0]?.id ?? null);
  const plan = plans.find(p => p.id === openId) ?? null;

  const create = () => {
    const p: Plan = { id: uid(), profileId: profile!.id, name: `Plan ${plans.length + 1}`, exercises: [], createdAt: new Date().toISOString() };
    update(d => { d.plans.push(p); });
    setOpenId(p.id);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><div className="eyebrow">Profil: {profile!.name}</div><h1>Plany treningowe</h1></div>
        <span className="sub">Plany wysyłasz na telefon w zakładce „Telefon”; na siłowni zaczynasz trening jednym stuknięciem.</span>
        <div className="actions">
          {plans.length > 0 && <button className="btn" onClick={goPhone}>Wyślij na telefon</button>}
          <button className="btn primary" onClick={create}>Nowy plan</button>
        </div>
      </div>
      {plans.length === 0 ? (
        <div className="empty">
          <h2>Brak planów</h2>
          <p>Plan to lista ćwiczeń z docelową liczbą serii, powtórzeń i przerwą, np. „Push A”. Możesz też zapisać istniejący trening jako plan przyciskiem „Zapisz jako plan” w edytorze treningu.</p>
          <button className="btn primary" onClick={create}>Utwórz pierwszy plan</button>
        </div>
      ) : (
        <div className="plans">
          <nav className="plan-list" aria-label="Plany">
            {plans.map(p => (
              <button key={p.id} aria-current={p.id === openId ? 'true' : undefined} onClick={() => setOpenId(p.id)}>
                <b>{p.name || 'Bez nazwy'}</b><span>{p.exercises.length} ćwiczeń · {p.exercises.reduce((a, e) => a + e.sets, 0)} serii</span>
              </button>
            ))}
          </nav>
          {plan ? <PlanEditor key={plan.id} plan={plan} onDeleted={() => setOpenId(null)} /> : <p className="note">Wybierz plan z listy.</p>}
        </div>
      )}
    </div>
  );
}

function PlanEditor({ plan, onDeleted }: { plan: Plan; onDeleted: () => void }) {
  const { update, lookup, profile } = useStore();
  const [picker, setPicker] = useState(false);
  const set = (fn: (p: Plan) => void) => update(d => { const p = d.plans.find(x => x.id === plan.id); if (p) fn(p); });
  const setEx = (id: string, fn: (e: PlanExercise) => void) => set(p => { const e = p.exercises.find(x => x.id === id); if (e) fn(e); });

  return (
    <div className="panel">
      <div className="row" style={{ alignItems: 'end' }}>
        <label className="field" style={{ flex: 1, minWidth: 200 }}>Nazwa planu<input id="plan-name" value={plan.name} onChange={e => set(p => { p.name = e.target.value; })} /></label>
        <ConfirmButton label="Usuń plan" confirm="Na pewno usunąć plan?" onConfirm={() => { update(d => { d.plans = d.plans.filter(p => p.id !== plan.id); }); onDeleted(); }} />
      </div>
      {plan.exercises.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="mtable plan-table">
            <thead><tr><th>#</th><th>Ćwiczenie</th><th className="r">Serie</th><th>Powtórzenia</th><th className="r">Przerwa (s)</th><th>Uwagi</th><th /></tr></thead>
            <tbody>
              {plan.exercises.map((pe, i) => {
                const ex = lookup(pe.exerciseId);
                return (
                  <tr key={pe.id} style={{ cursor: 'default' }}>
                    <td className="num muted">{i + 1}</td>
                    <td><b style={{ fontWeight: 500 }}>{ex?.name ?? pe.exerciseId}</b>{ex && <div className="muted" style={{ fontSize: 11.5 }}>{ex.equipmentPl} · {Object.keys(ex.muscles).slice(0, 2).map(shortName).join(', ')}</div>}</td>
                    <td className="r"><input className="input sm" id={`pe-s-${pe.id}`} inputMode="numeric" defaultValue={pe.sets} aria-label="Liczba serii" onBlur={e => setEx(pe.id, x => { x.sets = Math.max(1, Math.min(20, num(e.target.value) ?? 3)); })} /></td>
                    <td><span className="tgt">
                      <input className="input sm" id={`pe-a-${pe.id}`} inputMode="numeric" defaultValue={pe.repsMin ?? ''} aria-label="Powtórzenia od" onBlur={e => setEx(pe.id, x => { x.repsMin = num(e.target.value); })} />–
                      <input className="input sm" id={`pe-b-${pe.id}`} inputMode="numeric" defaultValue={pe.repsMax ?? ''} aria-label="Powtórzenia do" onBlur={e => setEx(pe.id, x => { x.repsMax = num(e.target.value); })} />
                    </span></td>
                    <td className="r"><input className="input sm" id={`pe-r-${pe.id}`} inputMode="numeric" defaultValue={pe.restSec ?? ''} aria-label="Przerwa w sekundach" onBlur={e => setEx(pe.id, x => { x.restSec = num(e.target.value); })} /></td>
                    <td><input className="input" id={`pe-n-${pe.id}`} defaultValue={pe.notes} placeholder="np. tempo 3-0-1" aria-label="Uwagi" onBlur={e => setEx(pe.id, x => { x.notes = e.target.value; })} /></td>
                    <td className="r" style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn ghost small" disabled={i === 0} onClick={() => set(p => { const a = p.exercises; [a[i - 1], a[i]] = [a[i], a[i - 1]]; })} aria-label="Wyżej">↑</button>
                      <button className="btn ghost small" disabled={i === plan.exercises.length - 1} onClick={() => set(p => { const a = p.exercises; [a[i + 1], a[i]] = [a[i], a[i + 1]]; })} aria-label="Niżej">↓</button>
                      <button className="btn ghost small" onClick={() => set(p => { p.exercises = p.exercises.filter(x => x.id !== pe.id); })} aria-label="Usuń ćwiczenie z planu">✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div><button className="btn primary" onClick={() => setPicker(true)}>+ Dodaj ćwiczenia</button></div>
      <p className="note">Powtórzenia możesz podać jako zakres (np. 8–12) albo jedną liczbę. Przerwa ustawia licznik odpoczynku na telefonie.</p>
      {picker && <ExercisePicker profileId={profile!.id} onClose={() => setPicker(false)} onAdd={ids => {
        set(p => { for (const exerciseId of ids) p.exercises.push({ id: uid(), exerciseId, sets: 3, repsMin: 8, repsMax: 12, restSec: 120, notes: '' }); });
        setPicker(false);
      }} />}
    </div>
  );
}
