import { useMemo, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { uid } from '../store/types';
import { BUILTIN_EXERCISES, EQUIPMENT, GROUPS, MUSCLES, shortName, type Weights } from '../data/catalog';
import { BodyViewer } from '../three/BodyViewer';
import { ConfirmButton, Dialog, pct, rampColor } from '../ui/common';

/**
 * Edytor ćwiczenia: nowe własne, edycja własnego albo poprawa wag wbudowanego.
 * Wagi ustawia się suwakami albo klikając mięsień na modelu.
 */
export function ExerciseEditor(p: { customId?: string; builtinId?: string; onClose: () => void; onSaved?: (id: string) => void }) {
  const { db, update } = useStore();
  const custom = p.customId ? db.customExercises.find(c => c.id === p.customId) : undefined;
  const builtin = p.builtinId ? BUILTIN_EXERCISES.find(b => b.id === p.builtinId) : undefined;
  const startWeights: Weights = custom?.muscles ?? (builtin ? db.weightOverrides[builtin.id] ?? builtin.muscles : {});

  const [name, setName] = useState(custom?.name ?? '');
  const [nameEn, setNameEn] = useState(custom?.nameEn ?? '');
  const [eq, setEq] = useState(custom?.equipmentPl ?? 'inne');
  const [vol, setVol] = useState(custom?.countsForVolume ?? true);
  const [w, setW] = useState<Weights>({ ...startWeights });
  const [focus, setFocus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = useRef<Record<string, HTMLDivElement | null>>({});

  const usage = useMemo(() => p.customId ? db.workouts.filter(x => x.exercises.some(e => e.exerciseId === p.customId)).length : 0, [db.workouts, p.customId]);
  const setWeight = (m: string, v: number) => setW(cur => { const n = { ...cur }; if (v <= 0) delete n[m]; else n[m] = Math.round(v * 100) / 100; return n; });

  const pickOnModel = (m: string | null) => {
    if (!m) return;
    if (!w[m]) setWeight(m, 1);
    setFocus(m);
    rows.current[m]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const save = () => {
    const clean = Object.fromEntries(Object.entries(w).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]));
    if (!builtin && !name.trim()) return setError('Podaj nazwę ćwiczenia.');
    if (!Object.keys(clean).length) return setError('Ustaw co najmniej jeden mięsień z udziałem większym niż 0%.');
    let id = p.customId ?? p.builtinId ?? '';
    update(d => {
      if (builtin) d.weightOverrides[builtin.id] = clean;
      else if (custom) Object.assign(d.customExercises.find(c => c.id === custom.id)!, { name: name.trim(), nameEn: nameEn.trim(), equipmentPl: eq, countsForVolume: vol, muscles: clean });
      else { id = 'C_' + uid(); d.customExercises.push({ id, name: name.trim(), nameEn: nameEn.trim(), equipmentPl: eq, countsForVolume: vol, muscles: clean, notes: '' }); }
    });
    p.onSaved?.(id);
    p.onClose();
  };

  const title = builtin ? 'Popraw wagi ćwiczenia' : custom ? 'Edytuj własne ćwiczenie' : 'Nowe własne ćwiczenie';
  return (
    <Dialog wide title={title} onClose={p.onClose}
      foot={<>
        {builtin && db.weightOverrides[builtin.id] && <button className="btn left" onClick={() => { update(d => { delete d.weightOverrides[builtin.id]; }); p.onClose(); }}>Przywróć wagi domyślne</button>}
        {custom && (usage ? <span className="muted left">Użyte w {usage} treningach – nie można usunąć.</span>
          : <span className="left"><ConfirmButton label="Usuń ćwiczenie" confirm="Na pewno usunąć?" onConfirm={() => { update(d => { d.customExercises = d.customExercises.filter(c => c.id !== custom.id); }); p.onClose(); }} /></span>)}
        {error && <span style={{ color: 'var(--danger)' }}>{error}</span>}
        <button className="btn" onClick={p.onClose}>Anuluj</button>
        <button className="btn primary" onClick={save}>Zapisz</button>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', gap: 18, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
          {builtin ? (
            <div><div className="eyebrow">{builtin.equipmentPl}</div><h3 style={{ fontSize: 18 }}>{builtin.name}</h3><div className="muted">{builtin.nameEn}</div>
              <p className="note" style={{ marginTop: 6 }}>Zmienione wagi zastąpią domyślne we wszystkich treningach i na mapie obciążenia.</p></div>
          ) : (
            <div className="grid-form">
              <label className="field">Nazwa<input id="ce-name" autoFocus value={name} onChange={e => setName(e.target.value)} /></label>
              <label className="field">Nazwa angielska (opcjonalnie)<input id="ce-en" value={nameEn} onChange={e => setNameEn(e.target.value)} /></label>
              <label className="field">Sprzęt<select id="ce-eq" value={eq} onChange={e => setEq(e.target.value)}>{EQUIPMENT.map(x => <option key={x}>{x}</option>)}</select></label>
              <label className="check" style={{ alignSelf: 'end', paddingBottom: 8 }}><input type="checkbox" checked={vol} onChange={e => setVol(e.target.checked)} /> liczy się do objętości</label>
            </div>
          )}
          <p className="note">Ustaw udział każdego mięśnia: 100% = mięsień docelowy, ok. 50% = istotny pomocniczy, 20–30% = stabilizujący. Kliknięcie mięśnia na modelu dodaje go ze 100%.</p>
          <div className="weights">
            {GROUPS.map(g => (
              <div key={g.id}>
                <h3>{g.name}</h3>
                {MUSCLES.filter(m => m.group === g.id).map(m => {
                  const v = w[m.id] ?? 0;
                  return (
                    <div key={m.id} ref={el => { rows.current[m.id] = el; }} className={`wrow${v ? ' on' : ''}${focus === m.id ? ' focus' : ''}`} onMouseEnter={() => setFocus(m.id)}>
                      <span className="wn">{shortName(m.id)}</span>
                      <input id={`wt-${m.id}`} type="range" min={0} max={100} step={5} value={Math.round(v * 100)} aria-label={`Udział: ${shortName(m.id)}`}
                        onChange={e => setWeight(m.id, Number(e.target.value) / 100)} />
                      <span className="v">{pct(v)}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div style={{ position: 'sticky', top: 0, display: 'grid', gap: 10 }}>
          <div style={{ height: 520 }}>
            <BodyViewer compact paintKey={w} colorOf={m => w[m] ? rampColor(w[m]) : null} selected={focus}
              tooltip={m => `${shortName(m)}: ${pct(w[m] ?? 0)}`} onPick={pickOnModel} />
          </div>
          <div className="muted" style={{ fontSize: 12 }}>Wybrane mięśnie: {Object.keys(w).length}</div>
        </div>
      </div>
    </Dialog>
  );
}
