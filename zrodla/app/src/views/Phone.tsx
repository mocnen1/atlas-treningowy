import { useMemo, useState } from 'react';
import { useStore } from '../store/store';
import { uid, type Workout } from '../store/types';
import { QrScanner, QrSender } from '../shared/qr';
import { Kind, bundleFromFile, encodeFrames, type Bundle, type PcBundle, type PhoneBundle } from '../shared/transfer';
import { buildPcBundle } from '../lib/pcBundle';
import { fmtDate } from '../ui/common';

const PHONE_URL = 'https://mocnen1.github.io/atlas-treningowy/';

type Received = { bundle: PhoneBundle; via: 'qr' | 'plik' };

export function PhoneView({ initialMode = 'receive' }: { initialMode?: 'send' | 'receive' }) {
  const { db, profile } = useStore();
  const [mode, setMode] = useState<'send' | 'receive'>(initialMode);
  const [sendBundle, setSendBundle] = useState<PcBundle | null>(null);
  const [scanning, setScanning] = useState(false);
  const [received, setReceived] = useState<Received | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const plans = db.plans.filter(p => p.profileId === profile!.id);
  const frames = useMemo(() => (sendBundle ? encodeFrames(sendBundle).length : 0), [sendBundle]);

  const onBundle = (b: Bundle, via: 'qr' | 'plik') => {
    if (b.k !== 'workouts') { setFileError('Ten plik zawiera plany z komputera, a nie trening z telefonu.'); return; }
    setScanning(false); setReceived({ bundle: b, via });
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><div className="eyebrow">Profil: {profile!.name}</div><h1>Telefon</h1></div>
        <div className="seg" role="group" aria-label="Kierunek">
          <button aria-pressed={mode === 'receive'} onClick={() => setMode('receive')}>Odbierz trening z telefonu</button>
          <button aria-pressed={mode === 'send'} onClick={() => setMode('send')}>Wyślij plany na telefon</button>
        </div>
      </div>

      {mode === 'receive' && (received ? <ImportPreview r={received} onClose={() => setReceived(null)} /> : (
        <div className="phone-grid">
          <div className="panel">
            <h2>Odczytaj kod z telefonu</h2>
            <ol className="steps">
              <li>Na telefonie: zakończ trening i stuknij „Wyślij do komputera”.</li>
              <li>Podkręć jasność telefonu i trzymaj go ok. 30–40 cm przed kamerką, ekranem do kamerki.</li>
              <li>Przy kilku kodach poczekaj, aż kamerka złapie wszystkie (zmieniają się same).</li>
            </ol>
            {scanning
              ? <><QrScanner expect={Kind.PhoneWorkouts} facing="user" onDone={b => onBundle(b, 'qr')} /><div><button className="btn" onClick={() => setScanning(false)}>Wyłącz kamerkę</button></div></>
              : <div><button className="btn primary" onClick={() => setScanning(true)}>Włącz kamerkę i skanuj</button></div>}
          </div>
          <div className="panel">
            <h2>Albo z pliku</h2>
            <p className="note">Jeśli kamerka nie łapie kodów: na telefonie stuknij „Udostępnij jako plik”, wyślij go sobie (mail, OneDrive, komunikator) i wskaż tutaj.</p>
            <label className="btn" style={{ justifySelf: 'start' }}>
              Wybierz plik z telefonu…
              <input type="file" accept=".json,application/json" hidden onChange={async e => {
                const f = e.target.files?.[0]; e.target.value = '';
                if (!f) return;
                try { setFileError(null); onBundle(bundleFromFile(await f.text()), 'plik'); }
                catch (err: any) { setFileError(err?.message ?? String(err)); }
              }} />
            </label>
            {fileError && <p style={{ color: 'var(--danger)', margin: 0 }}>{fileError}</p>}
          </div>
        </div>
      ))}

      {mode === 'send' && (
        <div className="phone-grid">
          <div className="panel">
            <h2>Plany dla telefonu</h2>
            {plans.length === 0 ? <p className="note">Profil nie ma jeszcze planów. Utwórz je w zakładce „Plany”. Możesz też wysłać same ostatnie wyniki – telefon pokaże je przy ćwiczeniach.</p>
              : <ul className="plain">{plans.map(p => <li key={p.id}><b>{p.name}</b> <span className="muted">· {p.exercises.length} ćwiczeń</span></li>)}</ul>}
            <p className="note">Razem z planami idą Twoje własne ćwiczenia i ostatnie wyniki (ciężar × powtórzenia), żeby telefon podpowiadał, co robiłeś poprzednio.</p>
            <div><button className="btn primary" onClick={() => setSendBundle(buildPcBundle(db, profile!.id))}>{sendBundle ? 'Odśwież kody' : 'Pokaż kody QR'}</button></div>
            <p className="note">Na telefonie: „Odbierz plany z komputera” i skieruj aparat na ekran. Aplikację na telefon zainstalujesz z adresu <code style={{ userSelect: 'all' }}>{PHONE_URL}</code> (Safari → Udostępnij → Do ekranu początkowego).</p>
          </div>
          {sendBundle && (
            <div className="panel" style={{ justifyItems: 'center' }}>
              <QrSender bundle={sendBundle} size={420} interval={650} />
              <p className="note">{frames} {frames === 1 ? 'kod' : 'kodów'} · {sendBundle.plans.length} planów · {Object.keys(sendBundle.last).length} ostatnich wyników</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ImportPreview({ r, onClose }: { r: Received; onClose: () => void }) {
  const { db, update, profile, lookup } = useStore();
  const [result, setResult] = useState<string | null>(null);
  const existing = new Set(db.workouts.map(w => w.id));
  const knownCustom = new Set(db.customExercises.map(c => c.id));
  const newCustom = r.bundle.custom.filter(c => !knownCustom.has(c.id) && !lookup(c.id));
  const fresh = r.bundle.workouts.filter(w => !existing.has(w.id));
  // Docelowy profil: ten, z którego telefon odebrał plany (po nazwie), inaczej aktywny.
  const fromPhone = r.bundle.profile ?? null;
  const matched = fromPhone ? db.profiles.find(p => p.name.trim().toLowerCase() === fromPhone.trim().toLowerCase()) : undefined;
  const [targetId, setTargetId] = useState(matched?.id ?? profile!.id);
  const target = db.profiles.find(p => p.id === targetId) ?? profile!;

  const doImport = () => {
    update(d => {
      for (const c of newCustom) d.customExercises.push({ id: c.id, name: c.name, nameEn: '', equipmentPl: c.eq || 'inne', countsForVolume: c.vol, muscles: {}, notes: 'Dodane na telefonie – ustaw mięśnie.' });
      for (const w of fresh) {
        const nw: Workout = {
          id: w.id, profileId: target.id, date: w.date, startTime: w.startTime, durationMin: w.durationMin, name: w.name, notes: w.notes,
          planId: w.planId && d.plans.some(p => p.id === w.planId) ? w.planId : null,
          source: 'import', createdAt: new Date().toISOString(),
          exercises: w.exercises.map(e => ({ id: uid(), exerciseId: e.exerciseId, notes: e.notes, supersetId: e.ss ?? null, altLabels: e.alt ?? null, target: e.t ?? null, setTargets: e.ts?.length ? e.ts : null, sets: e.sets.map(s => ({ id: uid(), ...s, repsAlt: s.repsAlt ?? null })) })),
        };
        d.workouts.push(nw);
      }
    });
    setResult(`Zaimportowano ${fresh.length} ${fresh.length === 1 ? 'trening' : 'treningów'} do profilu ${target.name}.` + (newCustom.length ? ` Dodano ${newCustom.length} nowych ćwiczeń z telefonu – ustaw im mięśnie w zakładce „Ćwiczenia”, inaczej nie będą liczone na mapie.` : ''));
  };

  return (
    <div className="panel" style={{ maxWidth: 860 }}>
      <h2>Odebrano z telefonu ({r.via === 'qr' ? 'kody QR' : 'plik'})</h2>
      <table className="mtable">
        <thead><tr><th>Data</th><th>Trening</th><th className="r">Ćwiczenia</th><th className="r">Serie</th><th>Stan</th></tr></thead>
        <tbody>
          {r.bundle.workouts.map(w => (
            <tr key={w.id} style={{ cursor: 'default' }}>
              <td>{fmtDate(w.date)}{w.startTime ? `, ${w.startTime}` : ''}</td>
              <td>{w.name || w.exercises.map(e => lookup(e.exerciseId)?.name ?? r.bundle.custom.find(c => c.id === e.exerciseId)?.name ?? e.exerciseId).slice(0, 2).join(', ')}</td>
              <td className="r num">{w.exercises.length}</td>
              <td className="r num">{w.exercises.reduce((a, e) => a + e.sets.filter(s => !s.warmup).length, 0)}</td>
              <td>{existing.has(w.id) ? <span className="pill" style={{ background: 'var(--notarget)' }}>już zaimportowany</span> : <span className="pill" style={{ background: 'var(--ok)' }}>nowy</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!result && fresh.length > 0 && (
        <div className="row" style={{ alignItems: 'center' }}>
          <label className="field" style={{ minWidth: 220 }}>Importuj do profilu
            <select id="import-profile" value={target.id} onChange={e => setTargetId(e.target.value)}>
              {db.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {fromPhone && (matched
            ? <span className="note">Telefon jest powiązany z profilem „{fromPhone}”{matched.id !== profile!.id ? ' – wybrano go automatycznie, choć aktywny jest inny profil.' : '.'}</span>
            : <span className="note" style={{ color: 'var(--hot)' }}>Telefon odebrał plany z profilu „{fromPhone}”, którego nie ma na tym komputerze. Sprawdź, czy to na pewno Twoje treningi.</span>)}
        </div>
      )}
      {result ? <p style={{ color: 'var(--ok)', margin: 0 }}>{result}</p> : (
        <p className="note">{fresh.length ? `Treningi trafią do profilu „${target.name}”.` : 'Wszystkie te treningi są już w aplikacji – nic nie zostanie zdublowane.'}</p>
      )}
      <div className="row">
        {!result && fresh.length > 0 && <button className="btn primary" onClick={doImport}>Importuj {fresh.length} do profilu {target.name}</button>}
        <button className="btn" onClick={onClose}>{result ? 'Gotowe' : 'Anuluj'}</button>
      </div>
    </div>
  );
}
