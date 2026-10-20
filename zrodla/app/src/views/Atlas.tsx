import { useState } from 'react';
import { useStore } from '../store/store';
import { GROUPS, MUSCLE_BY_ID, MUSCLES, shortName } from '../data/catalog';
import { BodyViewer } from '../three/BodyViewer';
import { ExerciseAnim } from '../shared/ExerciseImage';
import { ExerciseFilters, ExerciseList, MuscleBars, emptyFilter, pct, rampColor, useFilteredExercises } from '../ui/common';

export function AtlasView() {
  const { exercises, lookup } = useStore();
  const [hover, setHover] = useState<string | null>(null);   // ostatnio wskazany mięsień (zostaje po zjechaniu z modelu)
  const [pinned, setPinned] = useState<string | null>(null);
  const [exId, setExId] = useState<string | null>(null);
  const [f, setF] = useState(emptyFilter());
  const focus = pinned ?? hover;
  const { list, muscle } = useFilteredExercises(exercises, f, focus, 0.3);
  const ex = exId ? lookup(exId) : undefined;
  const m = focus ? MUSCLE_BY_ID[focus] : null;

  return (
    <div className="page">
      <div className="page-head">
        <div><div className="eyebrow">Model: Z-Anatomy (CC BY-SA 4.0)</div><h1>Atlas mięśni</h1></div>
        <span className="sub">Najedź na mięsień, żeby zobaczyć ćwiczenia, które go wzmacniają. Kliknięcie przypina mięsień.</span>
      </div>
      <div className="split">
        <div style={{ position: 'relative' }}>
          <BodyViewer paintKey={exId} selected={ex ? null : pinned}
            colorOf={mid => ex ? rampColor(ex.muscles[mid] ?? 0) : null}
            tooltip={mid => ex ? `${shortName(mid)}: ${pct(ex.muscles[mid] ?? 0)}` : shortName(mid)}
            onHover={id => { if (id) setHover(id); }}
            onPick={id => { setExId(null); setPinned(id && id !== pinned ? id : null); if (id) setHover(id); }} />
          {ex && <div className="legend"><div className="eyebrow">Zaangażowanie w ćwiczeniu</div><div className="ramp" /><div className="ramp-l"><span>0%</span><span>50%</span><span>100%</span></div></div>}
        </div>
        <div className="side">
          {ex ? (
            <div className="panel">
              <div className="eyebrow">Ćwiczenie · {ex.equipmentPl} · wagi {ex.weightsSource}</div>
              <h2 style={{ fontSize: 22, textTransform: 'none' }}>{ex.name}</h2>
              <div className="muted">{ex.nameEn}</div>
              {ex.hasImg && <ExerciseAnim id={ex.id} alt={ex.name} />}
              <MuscleBars weights={ex.muscles} onClick={mid => { setExId(null); setPinned(mid); setHover(mid); }} />
              <div><button className="btn small" onClick={() => setExId(null)}>Zamknij ćwiczenie</button></div>
            </div>
          ) : m ? (
            <div className="panel">
              <div className="eyebrow">{GROUPS.find(g => g.id === m.group)?.name}{pinned ? ' · przypięty' : ''}</div>
              <h2 style={{ fontSize: 22, textTransform: 'none' }}>{m.name}</h2>
              <div className="muted" style={{ fontStyle: 'italic' }}>{m.latin}</div>
              {pinned && <div><button className="btn small" onClick={() => setPinned(null)}>Odepnij</button></div>}
            </div>
          ) : (
            <div className="panel">
              <h2>Wskaż mięsień</h2>
              <p className="note">Przeciągnij, aby obracać; kółkiem przybliżasz. Możesz też wybrać mięsień z listy poniżej.</p>
              <select id="atlas-m" className="input" value="" onChange={e => { setPinned(e.target.value); setHover(e.target.value); }} aria-label="Wybierz mięsień">
                <option value="">wybierz mięsień…</option>
                {MUSCLES.map(x => <option key={x.id} value={x.id}>{shortName(x.id)}</option>)}
              </select>
            </div>
          )}
          {focus && (
            <div className="panel">
              <h2>Ćwiczenia na ten mięsień</h2>
              <ExerciseFilters f={f} set={setF} />
              <div className="muted" style={{ fontSize: 12 }}>{list.length} ćwiczeń angażujących mięsień w co najmniej 30%</div>
              <ExerciseList list={list} muscle={muscle} selected={exId} onSelect={e => setExId(e.id === exId ? null : e.id)} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
