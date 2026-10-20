import { useMemo, useState } from 'react';
import { useStore } from '../store/store';
import { Dialog, ExerciseFilters, ExerciseList, MuscleBars, emptyFilter, useFilteredExercises } from '../ui/common';
import { ExerciseEditor } from './ExerciseEditor';

export function ExercisePicker(p: { profileId: string; onClose: () => void; onAdd: (ids: string[]) => void }) {
  const { db, exercises, lookup } = useStore();
  const [f, setF] = useState(emptyFilter());
  const [chosen, setChosen] = useState<string[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Ostatnio używane przez ten profil – na górze listy
  const recent = useMemo(() => {
    const seen: string[] = [];
    for (const w of [...db.workouts].filter(w => w.profileId === p.profileId).sort((a, b) => b.date.localeCompare(a.date)))
      for (const e of w.exercises) if (!seen.includes(e.exerciseId)) seen.push(e.exerciseId);
    return seen;
  }, [db.workouts, p.profileId]);

  const { list, muscle } = useFilteredExercises(exercises, f, null, 0.3, recent);
  const toggle = (id: string) => { setChosen(c => c.includes(id) ? c.filter(x => x !== id) : [...c, id]); setPreview(id); };
  const pv = preview ? lookup(preview) : null;

  return (
    <Dialog wide title="Dodaj ćwiczenie" onClose={p.onClose}
      foot={<>
        <button className="btn left" onClick={() => setCreating(true)}>Nie ma na liście? Utwórz własne</button>
        <span className="muted">{chosen.length ? `Wybrano: ${chosen.length}` : 'Kliknij ćwiczenia, aby je zaznaczyć'}</span>
        <button className="btn" onClick={p.onClose}>Anuluj</button>
        <button className="btn primary" disabled={!chosen.length} onClick={() => p.onAdd(chosen)}>Dodaj do treningu</button>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 18, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 10, minWidth: 0 }}>
          <ExerciseFilters f={f} set={setF} showMuscle autoFocus />
          <p className="note">{muscle ? `Posortowane wg zaangażowania wybranego mięśnia (min. 30%).` : recent.length ? 'Na górze ćwiczenia, które ostatnio robiłeś.' : 'Na górze ćwiczenia ze zweryfikowanymi wagami.'}</p>
          <ExerciseList list={list} muscle={muscle} selected={null} onSelect={e => toggle(e.id)}
            extra={e => chosen.includes(e.id) ? <span className="chip on">wybrane {chosen.indexOf(e.id) + 1}</span> : null} />
        </div>
        <div className="panel" style={{ position: 'sticky', top: 0 }}>
          {pv ? <>
            <div className="eyebrow">{pv.equipmentPl} · {pv.weightsSource}</div>
            <h3 style={{ fontSize: 16 }}>{pv.name}</h3>
            <div className="muted" style={{ fontSize: 12 }}>{pv.nameEn}</div>
            <MuscleBars weights={pv.muscles} />
          </> : <p className="note">Tu zobaczysz, które mięśnie pracują w klikniętym ćwiczeniu.</p>}
        </div>
      </div>
      {creating && <ExerciseEditor onClose={() => setCreating(false)} onSaved={id => { setCreating(false); setChosen(c => [...c, id]); setPreview(id); }} />}
    </Dialog>
  );
}
