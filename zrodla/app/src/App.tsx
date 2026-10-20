import { useState } from 'react';
import { ModelChoice } from './ui/common';
import { useStore } from './store/store';
import { uid } from './store/types';
import { WorkoutsView } from './views/Workouts';
import { WorkoutEditor } from './views/WorkoutEditor';
import { AtlasView } from './views/Atlas';
import { LoadMapView } from './views/LoadMap';
import { ExercisesView } from './views/Exercises';
import { SettingsView } from './views/Settings';
import { PlansView } from './views/Plans';
import { PhoneView } from './views/Phone';

export type Route = { page: 'workouts' } | { page: 'workout'; id: string } | { page: 'atlas' } | { page: 'map' } | { page: 'exercises' } | { page: 'plans' } | { page: 'phone'; mode?: 'send' | 'receive' } | { page: 'settings' };

const NAV: { page: Route['page']; label: string }[] = [
  { page: 'workouts', label: 'Treningi' },
  { page: 'plans', label: 'Plany' },
  { page: 'phone', label: 'Telefon' },
  { page: 'map', label: 'Mapa obciążenia' },
  { page: 'atlas', label: 'Atlas mięśni' },
  { page: 'exercises', label: 'Ćwiczenia' },
  { page: 'settings', label: 'Profile i dane' },
];

export function App() {
  const { db, update, profile, saveState, saveError } = useStore();
  const [route, setRoute] = useState<Route>({ page: 'workouts' });

  if (!profile) return <FirstProfile />;
  const active = route.page === 'workout' ? 'workouts' : route.page;

  return (
    <div className="shell">
      <nav className="rail" aria-label="Główna nawigacja">
        <div className="brand">Atlas <span>Treningowy</span></div>
        <div className="nav">
          {NAV.map(n => <button key={n.page} aria-current={active === n.page ? 'page' : undefined} onClick={() => setRoute({ page: n.page } as Route)}>{n.label}</button>)}
        </div>
        <div className="rail-foot">
          <label className="field">Profil
            <select id="profile-switch" value={profile.id} onChange={e => { const id = e.target.value; update(d => { d.activeProfileId = id; }); setRoute({ page: 'workouts' }); }}>
              {db.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <div className={`save ${saveState}`} title={saveError ?? undefined}><i />{saveState === 'saved' ? 'Zapisano' : saveState === 'saving' ? 'Zapisywanie…' : 'Błąd zapisu'}</div>
        </div>
      </nav>
      <main className="main">
        {route.page === 'workouts' && <WorkoutsView open={id => setRoute({ page: 'workout', id })} />}
        {route.page === 'workout' && <WorkoutEditor id={route.id} back={() => setRoute({ page: 'workouts' })} open={id => setRoute({ page: 'workout', id })} />}
        {route.page === 'atlas' && <AtlasView />}
        {route.page === 'map' && <LoadMapView />}
        {route.page === 'exercises' && <ExercisesView />}
        {route.page === 'plans' && <PlansView goPhone={() => setRoute({ page: 'phone', mode: 'send' })} />}
        {route.page === 'phone' && <PhoneView key={route.mode ?? 'receive'} initialMode={route.mode ?? 'receive'} />}
        {route.page === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}

function FirstProfile() {
  const { update } = useStore();
  const [name, setName] = useState('');
  const [mass, setMass] = useState('');
  const [model, setModel] = useState<'male' | 'female'>('male');
  const create = () => {
    if (!name.trim()) return;
    update(d => {
      const id = uid();
      d.profiles.push({ id, name: name.trim(), bodyMassKg: mass ? Number(mass.replace(',', '.')) : null, createdAt: new Date().toISOString(), targets: {}, bodyModel: model });
      d.activeProfileId = id;
    });
  };
  return (
    <div className="page" style={{ maxWidth: 520, margin: '8vh auto' }}>
      <div className="brand" style={{ padding: 0, fontSize: 34 }}>Atlas <span>Treningowy</span></div>
      <div className="panel">
        <h2>Utwórz profil</h2>
        <p className="note">Profil przechowuje treningi i cele jednej osoby. Kolejne profile dodasz później w zakładce „Profile i dane”.</p>
        <div className="grid-form">
          <label className="field">Imię lub nazwa<input id="np-name" autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} /></label>
          <label className="field">Masa ciała (kg, opcjonalnie)<input id="np-mass" inputMode="decimal" value={mass} onChange={e => setMass(e.target.value)} /></label>
        </div>
        <div className="field">Model ciała 3D
          <div><ModelChoice id="np-model" value={model} onChange={setModel} /></div>
          <span className="note" style={{ margin: 0 }}>Wpływa tylko na wygląd modelu mięśni. Możesz go zmienić później w „Profile i dane”.</span>
        </div>
        <div><button className="btn primary" disabled={!name.trim()} onClick={create}>Utwórz profil</button></div>
      </div>
    </div>
  );
}
