import { useEffect, useState } from 'react';
import { isDesktop, useStore } from '../store/store';
import { normalizeDb, todayIso, uid } from '../store/types';
import { demoData } from '../lib/demo';
import { ConfirmButton } from '../ui/common';

export function SettingsView() {
  const { db, update, replaceDb, profile } = useStore();
  const [newName, setNewName] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => { window.atlasApi?.dataPath().then(setPath); }, []);

  const addProfile = () => {
    if (!newName.trim()) return;
    update(d => { const id = uid(); d.profiles.push({ id, name: newName.trim(), bodyMassKg: null, createdAt: new Date().toISOString(), targets: {} }); d.activeProfileId = id; });
    setNewName('');
  };

  const doExport = async () => {
    const ok = await window.atlasApi!.exportFile(JSON.stringify(db, null, 1), `atlas-treningowy-${todayIso()}.json`);
    setMsg(ok ? { ok: true, text: 'Dane wyeksportowane.' } : null);
  };
  const doImport = async () => {
    try {
      const raw = await window.atlasApi!.importFile();
      if (!raw) return;
      const next = normalizeDb(JSON.parse(raw));
      replaceDb(next);
      setMsg({ ok: true, text: `Zaimportowano: ${next.profiles.length} profili, ${next.workouts.length} treningów. Poprzedni stan jest w kopiach zapasowych.` });
    } catch (e: any) {
      setMsg({ ok: false, text: `Import nie powiódł się: ${e?.message ?? e}` });
    }
  };

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-head"><div><div className="eyebrow">Ustawienia</div><h1>Profile i dane</h1></div></div>

      <div className="panel">
        <h2>Profile</h2>
        <table className="mtable">
          <thead><tr><th>Nazwa</th><th>Masa ciała (kg)</th><th className="r">Treningi</th><th /></tr></thead>
          <tbody>
            {db.profiles.map(p => {
              const n = db.workouts.filter(w => w.profileId === p.id).length;
              return (
                <tr key={p.id} style={{ cursor: 'default' }}>
                  <td><input className="input" id={`pn-${p.id}`} value={p.name} onChange={e => update(d => { d.profiles.find(x => x.id === p.id)!.name = e.target.value; })} aria-label="Nazwa profilu" /></td>
                  <td><input className="input" id={`pm-${p.id}`} inputMode="decimal" style={{ maxWidth: 110 }} defaultValue={p.bodyMassKg ?? ''} aria-label="Masa ciała"
                    onBlur={e => { const v = Number(e.target.value.replace(',', '.')); update(d => { d.profiles.find(x => x.id === p.id)!.bodyMassKg = e.target.value.trim() && Number.isFinite(v) ? v : null; }); }} /></td>
                  <td className="r num">{n}</td>
                  <td className="r">
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      {p.id === profile!.id ? <span className="chip on">aktywny</span> : <button className="btn small" onClick={() => update(d => { d.activeProfileId = p.id; })}>Przełącz</button>}
                      {db.profiles.length > 1 && <ConfirmButton className="small" label="Usuń" confirm={`Usunąć z ${n} treningami?`}
                        onConfirm={() => update(d => { d.profiles = d.profiles.filter(x => x.id !== p.id); d.workouts = d.workouts.filter(w => w.profileId !== p.id); if (d.activeProfileId === p.id) d.activeProfileId = d.profiles[0].id; })} />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="row">
          <label className="field" style={{ flex: 1 }}>Nowy profil<input id="new-profile" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addProfile()} placeholder="imię" /></label>
          <button className="btn" disabled={!newName.trim()} onClick={addProfile}>Dodaj profil</button>
        </div>
      </div>

      <div className="panel">
        <h2>Twoje dane</h2>
        {isDesktop() ? <>
          <p className="note">Wszystko zapisuje się automatycznie na tym komputerze, w pliku:<br /><code style={{ userSelect: 'all' }}>{path}</code><br />
            Raz dziennie aplikacja robi kopię zapasową (ostatnie 30 dni, folder „kopie-zapasowe” obok pliku).</p>
          <div className="row">
            <button className="btn" onClick={() => window.atlasApi!.openDataFolder()}>Otwórz folder z danymi</button>
            <button className="btn" onClick={doExport}>Eksportuj do pliku…</button>
            <button className="btn" onClick={doImport}>Importuj z pliku (zastępuje dane)…</button>
          </div>
        </> : <p className="note">To jest podgląd w przeglądarce: dane zapisują się tylko w tej przeglądarce i mogą zniknąć. Eksport i import do pliku działa w aplikacji na Windowsie.</p>}
        {msg && <p style={{ color: msg.ok ? 'var(--ok)' : 'var(--danger)', margin: 0 }}>{msg.text}</p>}
      </div>

      <div className="panel">
        <h2>Wypróbuj na przykładowych danych</h2>
        <p className="note">Tworzy osobny profil „Przykład (dane testowe)” z 8 tygodniami treningów push/pull/nogi, żeby zobaczyć, jak działa mapa obciążenia. Twoje dane zostają nietknięte; profil przykładowy usuniesz w tabeli powyżej.</p>
        <div><button className="btn" onClick={() => { const { profile: p, workouts } = demoData(); update(d => { d.profiles.push(p); d.workouts.push(...workouts); d.activeProfileId = p.id; }); setMsg({ ok: true, text: 'Dodano profil przykładowy i przełączono na niego.' }); }}>Dodaj profil przykładowy</button></div>
      </div>

      <p className="note">Model 3D: Z-Anatomy (CC BY-SA 4.0) na bazie BodyParts3D, The Database Center for Life Science (CC BY-SA 2.1 JP). Baza ćwiczeń: free-exercise-db (domena publiczna). Wagi zaangażowania mięśni to szacunki biomechaniczne, nie pomiary.</p>
    </div>
  );
}
