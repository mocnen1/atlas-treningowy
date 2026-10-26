import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QrScanner, QrSender } from '../shared/qr';
import { Kind, bundleToFile, fmtRepsAlt, type AltLabels, type PcBundle } from '../shared/transfer';
import { EFFORT_LEVELS, TRAINER_MIN_SESSIONS, effortPct } from '../shared/effort';
import { outcome, type HSet, type TrainerState } from '../shared/trainer';
import { ExerciseAnim, ExerciseThumb, imgUrl } from '../shared/ExerciseImage';
import {
  CATALOG, afterSet, applyPcBundle, estSetSec, supersetOf, fmtClock, fmtDateTime, fmtDay, fmtKg, loadState, lookupExercise, muscleName, newExercise, norm,
  exerciseHistory, fillSets, lastInContext, setsAtTarget, withTarget, phoneBundle, saveState, trainerFor, workoutContext, startWorkout, uid, updateLast, type PExercise, type PSet, type PWorkout, type PhoneState,
} from './state';

type Screen = { s: 'home' } | { s: 'workout' } | { s: 'send'; ids: string[] } | { s: 'receive' } | { s: 'settings' } | { s: 'view'; id: string };

// ---------- Dźwięk końca przerwy (Web Audio, planowany z wyprzedzeniem – dokładny co do sekundy przy włączonym ekranie)
let audio: AudioContext | null = null;
let pending: OscillatorNode[] = [];
let vibrateTimer = 0;
function unlockAudio() {
  try { audio ??= new AudioContext(); if (audio.state === 'suspended') audio.resume(); } catch { /* brak dźwięku */ }
}
function scheduleBeep(inSec: number) {
  cancelBeep();
  if ('vibrate' in navigator) vibrateTimer = window.setTimeout(() => { try { navigator.vibrate([350, 150, 350]); } catch { /* brak wibracji */ } }, Math.max(0, inSec) * 1000);
  if (!audio) return;
  for (const [off, f] of [[0, 880], [0.25, 880], [0.5, 1320]] as const) {
    const o = audio.createOscillator(), g = audio.createGain();
    const t = audio.currentTime + Math.max(0, inSec) + off;
    o.frequency.value = f; o.type = 'sine';
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.2);
    pending.push(o);
  }
}
function cancelBeep() { clearTimeout(vibrateTimer); for (const o of pending) { try { o.stop(); } catch { /* już zagrał */ } } pending = []; }

function useNow(active: boolean, ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!active) return; const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [active, ms]);
  return now;
}

/** Ekran nie gaśnie w trakcie treningu (iOS 18.4+ również w aplikacji z ekranu początkowego). */
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return;
    let lock: any = null, dead = false;
    const req = () => (navigator as any).wakeLock.request('screen').then((l: any) => { if (dead) l.release(); else lock = l; }).catch(() => {});
    const vis = () => { if (document.visibilityState === 'visible') req(); };
    req(); document.addEventListener('visibilitychange', vis);
    return () => { dead = true; document.removeEventListener('visibilitychange', vis); lock?.release?.(); };
  }, [on]);
}

export function PhoneApp() {
  const [st, setSt] = useState<PhoneState>(loadState);
  const [screen, setScreen] = useState<Screen>(() => (loadState().active ? { s: 'workout' } : { s: 'home' }));
  const [saveFailed, setSaveFailed] = useState(false);
  const update = useCallback((fn: (s: PhoneState) => PhoneState) => setSt(prev => { const n = fn(prev); setSaveFailed(!saveState(n)); return n; }), []);
  useEffect(() => { (navigator as any).storage?.persist?.().catch(() => {}); }, []);
  // Nowa wersja aplikacji: bez treningu w toku przeładowujemy od razu (dane są w pamięci telefonu), w trakcie treningu – pytamy.
  const [updateReady, setUpdateReady] = useState(false);
  const activeRef = useRef(st.active); activeRef.current = st.active;
  useEffect(() => {
    const on = () => { if (!activeRef.current) location.reload(); else setUpdateReady(true); };
    window.addEventListener('atlas-update', on); return () => window.removeEventListener('atlas-update', on);
  }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [screen.s]);

  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;

  return (
    <div className="p-app">
      {updateReady && <div className="p-banner p-update">Dostępna nowa wersja aplikacji. <button className="p-btn sm primary" onClick={() => location.reload()}>Uruchom ponownie</button><span>Trening w toku zostanie zachowany.</span></div>}
      {saveFailed && <div className="p-banner err">Nie udało się zapisać danych w telefonie. Wyślij treningi do komputera, zanim zamkniesz aplikację.</div>}
      {screen.s === 'home' && <Home st={st} update={update} go={setScreen} standalone={standalone} />}
      {screen.s === 'workout' && st.active && <WorkoutScreen st={st} update={update} go={setScreen} />}
      {screen.s === 'workout' && !st.active && <Home st={st} update={update} go={setScreen} standalone={standalone} />}
      {screen.s === 'send' && <SendScreen st={st} update={update} ids={screen.ids} go={setScreen} />}
      {screen.s === 'receive' && <ReceiveScreen update={update} go={setScreen} />}
      {screen.s === 'settings' && <SettingsScreen st={st} update={update} go={setScreen} />}
      {screen.s === 'view' && <ViewScreen st={st} update={update} id={screen.id} go={setScreen} />}
    </div>
  );
}

type P = { st: PhoneState; update: (fn: (s: PhoneState) => PhoneState) => void; go: (s: Screen) => void };

// ====================================================================== Instalacja
const IS_ANDROID = /Android/i.test(navigator.userAgent);
let deferredPrompt: any = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; window.dispatchEvent(new Event('atlas-installable')); });

function InstallBanner() {
  const [canPrompt, setCanPrompt] = useState(!!deferredPrompt);
  useEffect(() => { const on = () => setCanPrompt(true); window.addEventListener('atlas-installable', on); return () => window.removeEventListener('atlas-installable', on); }, []);
  if (IS_ANDROID) return (
    <div className="p-banner">
      <b>Zainstaluj aplikację na telefonie.</b> Dopiero wtedy działa bez internetu i ma własną ikonę.
      {canPrompt
        ? <div style={{ marginTop: 8 }}><button className="p-btn primary sm" onClick={async () => { try { await deferredPrompt.prompt(); } catch { /* odrzucone */ } deferredPrompt = null; setCanPrompt(false); }}>Zainstaluj</button></div>
        : <> W <b>Chrome</b> stuknij menu <b>⋮</b> (prawy górny róg) → <b>Zainstaluj aplikację</b> albo <b>Dodaj do ekranu głównego</b>. Używaj Chrome, nie przeglądarki Xiaomi.</>}
    </div>
  );
  return (
    <div className="p-banner">
      <b>Zainstaluj aplikację na ekranie początkowym.</b> W <b>Safari</b> stuknij <b>Udostępnij</b> (kwadrat ze strzałką) → <b>Do ekranu początkowego</b>. Dopiero wtedy działa bez internetu, a dane nie znikną przy czyszczeniu Safari.
    </div>
  );
}

// ====================================================================== Ekran główny
function Home({ st, update, go, standalone }: P & { standalone: boolean }) {
  const now = useNow(!!st.active, 10_000);
  const unsent = st.history.filter(w => !w.sentAt);
  const sent = st.history.filter(w => w.sentAt).slice(0, 15);
  const [manage, setManage] = useState(false);
  const [askDel, setAskDel] = useState<string | null>(null);
  const start = (planIdx: number | null) => {
    unlockAudio();
    update(s => ({ ...s, active: startWorkout(s, planIdx == null ? null : s.plans[planIdx]), rest: null }));
    go({ s: 'workout' });
  };
  return (
    <>
      <header className="p-head">
        <div className="p-brand">Atlas <span>Treningowy</span></div>
        <button className="p-icon" onClick={() => go({ s: 'settings' })} aria-label="Ustawienia">⚙</button>
      </header>
      <main className="p-main">
        {!standalone && <InstallBanner />}
        {st.active ? (
          <button className="p-card p-live" onClick={() => go({ s: 'workout' })}>
            <span className="p-eyebrow">Trening w toku</span>
            <b>{st.active.name || 'Trening'}</b>
            <span>{fmtClock((now - st.active.startedAt) / 1000)} · {st.active.exercises.reduce((a, e) => a + e.sets.filter(x => x.doneAt).length, 0)} serii zrobionych</span>
            <span className="p-go">Wróć do treningu →</span>
          </button>
        ) : (
          <section className="p-sec">
            <h2>Zacznij trening{st.plans.length > 0 && <button className="p-link" onClick={() => { setManage(m => !m); setAskDel(null); }}>{manage ? 'Gotowe' : 'Usuń plany'}</button>}</h2>
            {st.plans.map((p, i) => manage ? (
              <div key={p.id} className="p-card p-plan p-plan-del">
                <b>{p.name}</b>
                {askDel === p.id
                  ? <button className="p-btn danger sm" onClick={() => { update(s => ({ ...s, plans: s.plans.filter(x => x.id !== p.id) })); setAskDel(null); }}>Na pewno usunąć</button>
                  : <button className="p-btn sm" onClick={() => setAskDel(p.id)}>Usuń</button>}
              </div>
            ) : (
              <button key={p.id} className="p-card p-plan" onClick={() => start(i)}>
                <b>{p.name}</b>
                <span>{p.exercises.length} ćwiczeń · {p.exercises.map(e => lookupExercise(st, e.exerciseId)?.name ?? '?').slice(0, 3).join(', ')}{p.exercises.length > 3 ? '…' : ''}</span>
              </button>
            ))}
            {manage && <p className="p-note">Usuwa plan tylko z telefonu. Jeśli plan jest też na komputerze, wróci przy następnym „Odbierz plany” – usuń go wtedy na komputerze w zakładce „Plany”.</p>}
            {!manage && <button className="p-btn wide" onClick={() => start(null)}>Pusty trening</button>}
            {!st.plans.length && <p className="p-note">Plany treningowe układasz na komputerze i przesyłasz przyciskiem „Odbierz plany z komputera”.</p>}
          </section>
        )}

        {unsent.length > 0 && (
          <section className="p-sec">
            <h2>Do wysłania na komputer <span className="p-count">{unsent.length}</span></h2>
            {unsent.map(w => <WorkoutRow key={w.id} st={st} w={w} onClick={() => go({ s: 'view', id: w.id })} />)}
            <button className="p-btn primary wide" onClick={() => go({ s: 'send', ids: unsent.map(w => w.id) })}>Wyślij {unsent.length > 1 ? `wszystkie (${unsent.length})` : ''} do komputera</button>
          </section>
        )}

        <section className="p-sec">
          <h2>Komputer</h2>
          <button className="p-btn wide" onClick={() => go({ s: 'receive' })}>Odbierz plany z komputera</button>
          <p className="p-note">{st.receivedAt ? `Ostatnio odebrano: ${fmtDateTime(Date.parse(st.receivedAt))}${st.profile ? ` · profil ${st.profile}` : ''}.` : 'Jeszcze nic nie odebrano.'}</p>
        </section>

        {sent.length > 0 && (
          <section className="p-sec">
            <h2>Wysłane</h2>
            {sent.map(w => <WorkoutRow key={w.id} st={st} w={w} onClick={() => go({ s: 'view', id: w.id })} />)}
          </section>
        )}
        <p className="p-note p-ver">Wersja {__APP_VERSION__}</p>
      </main>
    </>
  );
}

function WorkoutRow({ st, w, onClick }: { st: PhoneState; w: PWorkout; onClick: () => void }) {
  const sets = w.exercises.reduce((a, e) => a + e.sets.filter(x => x.doneAt && !x.warmup).length, 0);
  return (
    <button className="p-row" onClick={onClick}>
      <span className="p-row-d"><b>{new Date(w.startedAt).getDate()}</b>{new Date(w.startedAt).toLocaleDateString('pl-PL', { month: 'short' })}</span>
      <span className="p-row-b">
        <b>{w.name || w.exercises.map(e => lookupExercise(st, e.exerciseId)?.name).filter(Boolean).slice(0, 2).join(', ') || 'Trening'}</b>
        <span>{w.exercises.length} ćw. · {sets} serii · {fmtClock(((w.endedAt ?? w.startedAt) - w.startedAt) / 1000)}</span>
      </span>
      <span className={`p-tag ${w.sentAt ? 'ok' : 'warn'}`}>{w.sentAt ? 'wysłany' : 'niewysłany'}</span>
    </button>
  );
}

// ====================================================================== Trening
function WorkoutScreen({ st, update, go }: P) {
  const w = st.active!;
  const now = useNow(true, 500);
  const [picker, setPicker] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [openSet, setOpenSet] = useState<string | null>(null);
  /** Seria właśnie odhaczona – pod nią pokazujemy szybki wybór trudności */
  const [rateSet, setRateSet] = useState<string | null>(null);
  const [showImg, setShowImg] = useState<string | null>(null);
  const [altEdit, setAltEdit] = useState<string | null>(null);
  /** Ćwiczenie, którego historię serii pokazujemy */
  const [histFor, setHistFor] = useState<string | null>(null);
  useWakeLock(true);

  const setW = (fn: (w: PWorkout) => PWorkout) => update(s => ({ ...s, active: s.active ? fn(s.active) : s.active }));
  const setEx = (exId: string, fn: (e: PExercise) => PExercise) => setW(w => ({ ...w, exercises: w.exercises.map(e => (e.id === exId ? fn(e) : e)) }));
  // Zmiana ciężaru/powtórzeń przenosi się na kolejne nieodhaczone serie, które miały tę samą wartość (typowo wszystkie serie robocze są takie same).
  const setSet = (exId: string, setId: string, patch: Partial<PSet>) => setEx(exId, e => {
    const i = e.sets.findIndex(x => x.id === setId);
    if (i < 0) return e;
    const old = e.sets[i];
    return { ...e, sets: e.sets.map((x, k) => {
      if (k === i) return { ...x, ...patch };
      if (k < i || x.doneAt || x.warmup !== old.warmup) return x;
      const c: Partial<PSet> = {};
      for (const key of ['kg', 'reps', 'repsAlt', 'dur'] as const) if (key in patch && x[key] === old[key]) (c as any)[key] = patch[key];
      return { ...x, ...c };
    }) };
  });

  const tick = (ex: PExercise, set: PSet) => {
    unlockAudio();
    setRateSet(!set.doneAt && !set.warmup ? set.id : null);
    const t = Date.now();
    update(s => {
      if (!s.active) return s;
      let rest = s.rest;
      const exercises = s.active.exercises.map(e => ({ ...e, sets: e.sets.map(x => ({ ...x })) }));
      const find = (id: string) => { for (const e of exercises) for (const x of e.sets) if (x.id === id) return x; return null; };
      const target = find(set.id)!;
      if (target.doneAt) {
        target.doneAt = null; target.restSec = null;
        if (rest?.setId === set.id) { rest = null; cancelBeep(); }
      } else {
        // Przerwa po poprzedniej serii, jeśli nie zatrzymano jej przyciskiem: od odhaczenia do odhaczenia minus szacowany czas serii
        if (rest) { const prev = find(rest.setId); if (prev && prev.restSec == null) prev.restSec = Math.max(0, Math.round((t - rest.from) / 1000 - estSetSec(target))); }
        target.doneAt = t;
        const ei = exercises.findIndex(e => e.id === ex.id), si = exercises[ei].sets.findIndex(x => x.id === set.id);
        const nxt = afterSet(exercises, ei, si, s.settings.defaultRest);
        if (nxt.next != null) {
          // superseria: od razu następne ćwiczenie, bez odliczania przerwy
          const nextEx = exercises[nxt.next];
          rest = { setId: set.id, from: t, target: 0, next: lookupExercise(s, nextEx.exerciseId)?.name ?? 'następne ćwiczenie' };
          cancelBeep();
          setTimeout(() => document.getElementById('ex-' + nextEx.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
        } else {
          rest = { setId: set.id, from: t, target: nxt.rest };
          if (s.settings.sound) scheduleBeep(nxt.rest); else cancelBeep();
        }
      }
      return { ...s, rest, active: { ...s.active, exercises } };
    });
  };

  const startSet = () => {
    update(s => {
      if (!s.rest || !s.active) return s;
      const sec = Math.round((Date.now() - s.rest.from) / 1000);
      const exercises = s.active.exercises.map(e => ({ ...e, sets: e.sets.map(x => (x.id === s.rest!.setId ? { ...x, restSec: sec } : x)) }));
      return { ...s, rest: null, active: { ...s.active, exercises } };
    });
    cancelBeep();
  };

  const finish = () => {
    cancelBeep();
    const id = w.id;
    update(s => {
      if (!s.active) return s;
      const done: PWorkout = { ...s.active, endedAt: Date.now() };
      return { ...s, active: null, rest: null, last: updateLast(s.last, done), history: [done, ...s.history].slice(0, 60) };
    });
    go({ s: 'send', ids: [id] });
  };
  const discard = () => { cancelBeep(); update(s => ({ ...s, active: null, rest: null })); go({ s: 'home' }); };

  const doneSets = w.exercises.reduce((a, e) => a + e.sets.filter(x => x.doneAt).length, 0);
  const rest = st.rest;
  const restSec = rest ? (now - rest.from) / 1000 : 0;

  return (
    <>
      <header className="p-head sticky">
        <button className="p-icon" onClick={() => go({ s: 'home' })} aria-label="Ekran główny">‹</button>
        <div className="p-wt">
          <input className="p-title-in" value={w.name} placeholder="Trening" onChange={e => setW(x => ({ ...x, name: e.target.value }))} aria-label="Nazwa treningu" />
          <span className="p-clock">{fmtClock((now - w.startedAt) / 1000)}</span>
        </div>
        <button className="p-btn primary sm" onClick={() => setFinishing(true)}>Zakończ</button>
      </header>
      <main className={`p-main ${rest ? 'with-rest' : ''}`}>
        {finishing && (
          <div className="p-confirm">
            <b>Zakończyć trening?</b>
            <span>{doneSets ? `${doneSets} odhaczonych serii zostanie zapisanych. Nieodhaczone serie są pomijane.` : 'Nie odhaczyłeś żadnej serii.'}</span>
            <div className="p-confirm-row">
              {doneSets > 0 && <button className="p-btn primary" onClick={finish}>Zakończ i zapisz</button>}
              <button className="p-btn" onClick={() => setFinishing(false)}>Wróć</button>
              <button className="p-btn danger" onClick={discard}>Odrzuć trening</button>
            </div>
          </div>
        )}

        {w.exercises.map((e, ei) => {
          const ex = lookupExercise(st, e.exerciseId);
          const last = st.last[e.exerciseId];
          const grp = supersetOf(w.exercises, ei);
          const inSs = grp.length > 1, pos = grp.indexOf(ei);
          const nextEx = w.exercises[ei + 1];
          const linkedNext = !!nextEx && !!e.ss && nextEx.ss === e.ss;
          const alt = e.alt ?? null;
          const tr = trainerFor(st, w, e);
          const hasHist = exerciseHistory(st, e.exerciseId).length > 0;
          const lc = lastInContext(st, e.exerciseId, workoutContext(st, w));
          let n = 0;
          return (
            <section className={`p-ex ${inSs ? 'ss' : ''} ${inSs && pos === 0 ? 'ss-first' : ''} ${inSs && pos === grp.length - 1 ? 'ss-last' : ''}`} key={e.id} id={'ex-' + e.id}>
              {inSs && <span className="p-ss-tag">Superseria · {pos + 1}/{grp.length}{pos === grp.length - 1 ? ' · potem przerwa' : ' · bez przerwy'}</span>}
              <div className="p-ex-head">
                {ex?.img
                  ? <button className="p-thumb" onClick={() => setShowImg(v => (v === e.id ? null : e.id))} aria-label="Pokaż, jak wykonać ćwiczenie"><ExerciseThumb id={ex.id} has size={52} /></button>
                  : <span />}
                <div>
                  <h3>{ex?.name ?? e.exerciseId}</h3>
                  <span className="p-sub">
                    {e.repsMin != null || e.repsMax != null ? `Plan: ${e.sets.length} × ${e.repsMin ?? ''}${e.repsMax && e.repsMax !== e.repsMin ? '–' + e.repsMax : ''}` : ex?.eq}
                    {inSs
                      ? (pos === grp.length - 1 ? ` · przerwa po rundzie ${fmtClock(Math.max(...grp.map(k => w.exercises[k].restSec ?? st.settings.defaultRest)))}` : '')
                      : ` · przerwa ${fmtClock(e.restSec ?? st.settings.defaultRest)}`}
                  </span>
                  {(last || hasHist) && <span className="p-sub p-last">
                    {lc ? <>W tym planie: <b>{lc.kg != null ? `${fmtKg(lc.kg)} kg × ` : ''}{fmtRepsAlt(lc.reps, alt ? lc.repsAlt : null, alt)}</b> ({fmtDay(lc.d)})</>
                      : last && <>Ostatnio: <b>{last[1] != null ? `${fmtKg(last[1])} kg × ` : ''}{fmtRepsAlt(last[2], alt ? last[3] : null, alt)}</b> ({fmtDay(last[0])})</>}
                    {hasHist && <button className="p-link sm" onClick={() => setHistFor(e.id)}>Historia</button>}</span>}
                  {e.notes && <span className="p-sub">{e.notes}</span>}
                </div>
                <ExMenu onUp={ei > 0 ? () => setW(x => { const a = [...x.exercises]; [a[ei - 1], a[ei]] = [a[ei], a[ei - 1]]; return { ...x, exercises: a }; }) : undefined}
                  onLink={nextEx && !linkedNext ? () => setW(x => {
                    const id = x.exercises[ei].ss ?? x.exercises[ei + 1].ss ?? uid();
                    const oldNext = x.exercises[ei + 1].ss;
                    return { ...x, exercises: x.exercises.map((y, k) => (k === ei || k === ei + 1 || (oldNext && y.ss === oldNext) ? { ...y, ss: id } : y)) };
                  }) : undefined}
                  onUnlink={inSs ? () => setW(x => {
                    const ex2 = x.exercises.map((y, k) => (k === ei ? { ...y, ss: null } : y));
                    // jeśli w grupie zostało jedno ćwiczenie, ono też przestaje być superserią
                    for (let k = 0; k < ex2.length; k++) if (ex2[k].ss && supersetOf(ex2, k).length < 2) ex2[k] = { ...ex2[k], ss: null };
                    return { ...x, exercises: ex2 };
                  }) : undefined}
                  altOn={!!alt} onAlt={() => setAltEdit(e.id)}
                  onRemove={() => setW(x => ({ ...x, exercises: x.exercises.filter(y => y.id !== e.id) }))} />
              </div>
              <TrainerBox tr={tr} alt={alt} atTarget={setsAtTarget(e)} last={lc ? [lc.kg, lc.reps, lc.repsAlt] : last ? [last[1], last[2], last[3] ?? null] : null}
                onSet={v => setEx(e.id, y => ({ ...y, sets: fillSets(y, v) }))} />
              {altEdit === e.id && <AltEditor initial={alt ?? st.alt[e.exerciseId] ?? ['pełne', 'łatwiejsze']} on={!!alt}
                onSave={labels => {
                  update(s => ({ ...s, alt: { ...s.alt, [e.exerciseId]: labels } }));
                  setEx(e.id, y => ({ ...y, alt: labels, sets: y.sets.map(z => (z.doneAt ? z : { ...z, repsAlt: z.repsAlt ?? 0 })) }));
                  setAltEdit(null);
                }}
                onOff={() => {
                  update(s => { const a = { ...s.alt }; delete a[e.exerciseId]; return { ...s, alt: a }; });
                  setEx(e.id, y => ({ ...y, alt: null, sets: y.sets.map(z => (z.doneAt ? z : { ...z, repsAlt: null })) }));
                  setAltEdit(null);
                }}
                onCancel={() => setAltEdit(null)} />}
              {showImg === e.id && ex && <ExerciseAnim id={ex.id} alt={ex.name} />}
              <div className="p-sets">
                <div className="p-sets-h"><span>Seria</span><span>kg</span><span>{alt ? alt[0] : 'Powt.'}</span><span /></div>
                {e.sets.map(x => {
                  if (!x.warmup) n++;
                  const open = openSet === x.id;
                  const timed = x.dur != null && x.reps == null;
                  return (
                    <div key={x.id} className={`p-set ${x.doneAt ? 'done' : ''} ${x.warmup ? 'warm' : ''}`}>
                      <button className="p-setn" onClick={() => setOpenSet(open ? null : x.id)} aria-label="Opcje serii">{x.warmup ? 'R' : n}<i className={x.rpe != null ? 'rated' : ''}>{x.rpe != null ? `${effortPct(x.rpe)}%` : '⋯'}</i></button>
                      <Stepper value={x.kg} step={st.settings.kgStep} decimals onChange={v => setSet(e.id, x.id, { kg: v })} label="Ciężar" />
                      <Stepper value={timed ? x.dur : x.reps} step={timed ? 5 : 1}
                        onChange={v => setSet(e.id, x.id, timed ? { dur: v } : { reps: v })} label={timed ? 'Czas (s)' : alt ? `Powtórzenia: ${alt[0]}` : 'Powtórzenia'} suffix={timed ? 's' : ''} />
                      <button className={`p-check ${x.doneAt ? 'on' : ''}`} onClick={() => tick(e, x)} aria-label={x.doneAt ? 'Cofnij odhaczenie' : 'Odhacz serię'}>✓</button>
                      {alt && !timed && (
                        <div className="p-set-alt">
                          <span className="p-alt-l">{alt[1]}</span>
                          <Stepper value={x.repsAlt ?? 0} step={1} onChange={v => setSet(e.id, x.id, { repsAlt: v ?? 0 })} label={`Powtórzenia: ${alt[1]}`} />
                          <span className="p-alt-sum">razem {(x.reps ?? 0) + (x.repsAlt ?? 0)}</span>
                        </div>
                      )}
                      {!open && rateSet === x.id && x.doneAt && (
                        <div className="p-set-more"><EffortBar value={x.rpe} onChange={v => { setSet(e.id, x.id, { rpe: v }); if (v != null) setTimeout(() => setRateSet(r => (r === x.id ? null : r)), 350); }} /></div>
                      )}
                      {open && (
                        <div className="p-set-more">
                          <button className={`p-chip ${x.warmup ? 'on' : ''}`} onClick={() => setSet(e.id, x.id, { warmup: !x.warmup })}>Rozgrzewkowa</button>
                          <button className={`p-chip ${timed ? 'on' : ''}`} onClick={() => setSet(e.id, x.id, timed ? { dur: null, reps: 8 } : { dur: 30, reps: null })}>Na czas</button>
                          {!x.warmup && <EffortBar value={x.rpe} onChange={v => setSet(e.id, x.id, { rpe: v })} />}
                          {x.restSec != null && <span className="p-sub">przerwa po serii: {fmtClock(x.restSec)}</span>}
                          <button className="p-chip danger" onClick={() => { setEx(e.id, y => ({ ...y, sets: y.sets.filter(z => z.id !== x.id) })); setOpenSet(null); }}>Usuń serię</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <button className="p-add" onClick={() => setEx(e.id, y => { const l = y.sets[y.sets.length - 1]; return { ...y, sets: [...y.sets, l ? { ...l, id: uid(), doneAt: null, restSec: null, warmup: false, rpe: null } : newExercise(st, y.exerciseId).sets[0]] }; })}>+ Seria</button>
              {linkedNext && <div className="p-ss-link">⇣ na zmianę z następnym ćwiczeniem</div>}
            </section>
          );
        })}

        <button className="p-btn wide" onClick={() => setPicker(true)}>+ Dodaj ćwiczenie</button>
        <textarea className="p-notes" placeholder="Notatki do treningu (samopoczucie, sen…)" value={w.notes} onChange={e => setW(x => ({ ...x, notes: e.target.value }))} />
      </main>

      {rest && rest.next && (
        <div className="p-rest ss">
          <div className="p-rest-row">
            <div className="p-rest-t"><span>Superseria – teraz</span><b className="p-rest-next">{rest.next}</b><span>{fmtClock(restSec)}</span></div>
            <button className="p-btn primary" onClick={startSet}>Zaczynam</button>
          </div>
        </div>
      )}
      {rest && !rest.next && (
        <div className={`p-rest ${restSec >= rest.target ? 'over' : ''}`}>
          <div className="p-rest-bar"><i style={{ width: `${Math.min(100, (restSec / rest.target) * 100)}%` }} /></div>
          <div className="p-rest-row">
            <div className="p-rest-t"><span>Przerwa</span><b>{fmtClock(restSec)}</b><span>/ {fmtClock(rest.target)}</span></div>
            <button className="p-btn sm" onClick={() => update(s => { if (!s.rest) return s; const target = s.rest.target + 30; if (s.settings.sound) scheduleBeep(target - (Date.now() - s.rest.from) / 1000); return { ...s, rest: { ...s.rest, target } }; })}>+30 s</button>
            <button className="p-btn primary" onClick={startSet}>Zaczynam serię</button>
          </div>
        </div>
      )}

      {histFor && (() => { const e = w.exercises.find(x => x.id === histFor); return e ? <HistorySheet st={st} exerciseId={e.exerciseId} ctx={workoutContext(st, w)} alt={e.alt ?? null} onClose={() => setHistFor(null)} /> : null; })()}
      {picker && <ExercisePicker st={st} onClose={() => setPicker(false)} onPick={(id, custom) => {
        update(s => {
          const s2 = custom ? { ...s, custom: [...s.custom, custom] } : s;
          return { ...s2, active: s2.active ? { ...s2.active, exercises: [...s2.active.exercises, withTarget(s2, s2.active, newExercise(s2, id, undefined, workoutContext(s2, s2.active)))] } : s2.active };
        });
        setPicker(false);
        setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 50);
      }} />}
    </>
  );
}

/** Trudność serii: 6 pól od „lekko” do „upadek”. Ponowne stuknięcie wybranego pola kasuje ocenę. */
function EffortBar({ value, onChange }: { value: number | null; onChange: (rpe: number | null) => void }) {
  const sel = value == null ? null : EFFORT_LEVELS.reduce((a, l) => (Math.abs(l.rpe - value) < Math.abs(a.rpe - value) ? l : a)).rpe;
  return (
    <div className="p-effort" role="group" aria-label="Trudność serii">
      <span className="p-effort-t">Trudność serii – ile powtórzeń zostało w zapasie?</span>
      <div className="p-effort-bar">
        {EFFORT_LEVELS.map(l => (
          <button key={l.rpe} className={`${sel != null && l.rpe <= sel ? 'fill' : ''} ${sel === l.rpe ? 'on' : ''}`} style={{ ['--h' as any]: (l.rpe - 5) / 5 }}
            onClick={() => onChange(sel === l.rpe ? null : l.rpe)} aria-label={`${l.pct}%: ${l.label}`} aria-pressed={sel === l.rpe}>
            <b>{l.pct}%</b><span>{l.short}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const LEVEL_LABEL = { plan: 'z tego planu', mixed: 'wstępnie', other: 'szacunek z innego planu' } as const;
const OUT_LABEL = { beat: 'przebity', hit: 'trafiony', miss: 'nietrafiony' } as const;

/** Podpowiedź trenera albo postęp zbierania danych (osobno dla tego planu i dla innych). */
type Vals = [kg: number | null, reps: number | null, repsAlt: number | null];
/** Podpowiedź trenera: przy pewnym celu serie startują z celem, przycisk przełącza między celem a ostatnim wynikiem. */
function TrainerBox({ tr, alt, atTarget, last, onSet }: { tr: TrainerState; alt: [string, string] | null; atTarget: boolean; last: Vals | null; onSet: (v: Vals) => void }) {
  const [more, setMore] = useState(false);
  const g = tr.suggestion;
  if (!g) {
    const n = tr.ctxRated;
    return (
      <span className="p-trainer">
        <i>{Array.from({ length: TRAINER_MIN_SESSIONS }, (_, k) => <b key={k} className={k < n ? 'on' : ''} />)}</i>
        Trener: {Math.min(n, TRAINER_MIN_SESSIONS)}/{TRAINER_MIN_SESSIONS} ocenionych treningów w tym planie{tr.otherRated ? ` (w innych: ${tr.otherRated})` : ''}
      </span>
    );
  }
  const short = (v: Vals) => `${v[0] != null ? `${fmtKg(v[0])} × ` : ''}${alt && v[2] != null ? `${v[1] ?? 0} + ${v[2]}` : v[1] ?? '–'}`;
  const target = `${g.kg != null ? `${fmtKg(g.kg)} kg × ` : ''}${alt && g.repsAlt != null ? `${g.reps} ${alt[0]} + ${g.repsAlt} ${alt[1]}` : g.reps}`;
  const tv: Vals = [g.kg, g.reps, g.repsAlt];
  return (
    <div className={`p-coach ${g.level}`}>
      <div className="p-coach-h"><span>Trener · {LEVEL_LABEL[g.level]}</span>{atTarget && <span className="p-coach-in">✓ w seriach</span>}</div>
      <b>Cel: {target}</b>
      <span className="p-sub">ostatnia seria na ok. {effortPct(g.rpe)}% ({g.rpe >= 9 ? '1 w zapasie' : '2 w zapasie'})</span>
      {g.outcomes.length > 0 && (
        <span className="p-sub p-outs">Ostatnie cele: {g.outcomes.map((o, i) => <i key={i} className={`o-${o}`} title={OUT_LABEL[o]}>{OUT_LABEL[o]}</i>)}
          {g.pace !== 'normal' && <b className={`pace-${g.pace}`}>{g.pace === 'fast' ? 'tempo: szybciej' : 'tempo: wolniej'}</b>}</span>
      )}
      {g.warn && <span className="p-sub warn">{g.warn}</span>}
      {atTarget
        ? (last && <button className="p-btn sm p-coach-btn" onClick={() => onSet(last)}>Gorszy dzień? Wróć do ostatniego wyniku ({short(last)})</button>)
        : <button className="p-btn sm p-coach-btn" onClick={() => onSet(tv)}>Ustaw serie na cel ({short(tv)})</button>}
      <button className="p-link sm" onClick={() => setMore(m => !m)}>{more ? 'Ukryj' : 'Dlaczego?'}</button>
      {more && <span className="p-sub">{g.reason}</span>}
    </div>
  );
}

/** Historia serii ćwiczenia: najpierw treningi z bieżącego planu, potem z innych. */
function HistorySheet({ st, exerciseId, ctx, alt, onClose }: { st: PhoneState; exerciseId: string; ctx: string; alt: [string, string] | null; onClose: () => void }) {
  const all = exerciseHistory(st, exerciseId);
  const mine = all.filter(s => s.c === ctx), other = all.filter(s => s.c !== ctx);
  const fmtSet = (x: HSet) => `${x[0] != null ? `${fmtKg(x[0])} kg × ` : ''}${x[1] == null ? '–' : fmtRepsAlt(x[1], x[4] ?? null, alt)}${x[2] != null ? ` · ${effortPct(x[2])}%` : ''}`;
  const block = (title: string, list: typeof all) => list.length > 0 && (
    <section className="p-sec">
      <h2>{title}</h2>
      {list.map((s, i) => (
        <div key={i} className="p-hist">
          <div className="p-hist-h"><b>{fmtDay(s.d)}</b><span>{s.n}</span>
            {s.t && <span className="p-hist-t">cel {s.t[0] != null ? `${fmtKg(s.t[0])} × ` : ''}{s.t[2] != null ? `${s.t[1]} + ${s.t[2]}` : s.t[1]}{(() => { const o = outcome(s); return o ? <i className={`o-${o}`}>{OUT_LABEL[o]}</i> : null; })()}</span>}</div>
          <div className="p-done-list">{s.s.map((x, k) => <span key={k} className={x[3] ? 'warm' : ''}>{x[3] ? 'R · ' : ''}{fmtSet(x)}</span>)}</div>
        </div>
      ))}
    </section>
  );
  return (
    <div className="p-sheet" role="dialog" aria-label="Historia ćwiczenia">
      <div className="p-sheet-head">
        <b className="p-sheet-title">{lookupExercise(st, exerciseId)?.name ?? exerciseId}</b>
        <button className="p-btn sm" onClick={onClose}>Zamknij</button>
      </div>
      <div className="p-sheet-body">
        {all.length === 0 && <p className="p-note">Brak zapisanej historii. Historia z komputera przychodzi razem z planami („Odbierz plany z komputera”).</p>}
        {block('W tym planie', mine)}
        {block('W innych treningach', other)}
        <p className="p-note">R = seria rozgrzewkowa. Procent to trudność serii (100% = upadek). Komputer wysyła po kilka ostatnich treningów z każdego planu.</p>
      </div>
    </div>
  );
}

function ExMenu({ onUp, onRemove, onLink, onUnlink, onAlt, altOn }: { onUp?: () => void; onRemove: () => void; onLink?: () => void; onUnlink?: () => void; onAlt: () => void; altOn: boolean }) {
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState(false);
  const act = (f: () => void) => () => { f(); setOpen(false); };
  return (
    <div className="p-exmenu">
      <button className="p-icon" onClick={() => { setOpen(o => !o); setAsk(false); }} aria-label="Opcje ćwiczenia">⋯</button>
      {open && (
        <div className="p-pop">
          {onUp && <button onClick={act(onUp)}>Przesuń wyżej</button>}
          {onLink && <button onClick={act(onLink)}>Superseria z następnym</button>}
          {onUnlink && <button onClick={act(onUnlink)}>Odłącz z superserii</button>}
          <button onClick={act(onAlt)}>{altOn ? 'Warianty powtórzeń…' : 'Powtórzenia w 2 wariantach…'}</button>
          {ask ? <button className="danger" onClick={onRemove}>Na pewno usunąć?</button> : <button className="danger" onClick={() => setAsk(true)}>Usuń ćwiczenie</button>}
        </div>
      )}
    </div>
  );
}

/** Włączenie i nazwy dwóch wariantów powtórzeń w serii (np. pełne / tylko nogi). */
function AltEditor({ initial, on, onSave, onOff, onCancel }: { initial: AltLabels; on: boolean; onSave: (l: AltLabels) => void; onOff: () => void; onCancel: () => void }) {
  const [a, setA] = useState(initial[0]);
  const [b, setB] = useState(initial[1]);
  const ok = !!(a.trim() && b.trim());
  return (
    <div className="p-alt-ed">
      <b>Dwa warianty powtórzeń w jednej serii</b>
      <span className="p-sub">Np. przy wznosach: ile pełnych, a ile samych nóg. Seria liczy się do objętości raz, a oba liczniki zapisują się osobno.</span>
      <label>Wariant pełny (trudniejszy)<input value={a} onChange={x => setA(x.target.value)} maxLength={24} /></label>
      <label>Wariant łatwiejszy<input value={b} onChange={x => setB(x.target.value)} maxLength={24} /></label>
      <div className="p-confirm-row">
        <button className="p-btn primary sm" disabled={!ok} onClick={() => onSave([a.trim(), b.trim()])}>{on ? 'Zapisz' : 'Włącz'}</button>
        {on && <button className="p-btn sm" onClick={onOff}>Wyłącz</button>}
        <button className="p-btn sm" onClick={onCancel}>Anuluj</button>
      </div>
    </div>
  );
}

function Stepper({ value, step, onChange, label, decimals, suffix }: { value: number | null; step: number; onChange: (v: number | null) => void; label: string; decimals?: boolean; suffix?: string }) {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (edit) { ref.current?.focus(); ref.current?.select(); } }, [edit]);
  const commit = () => {
    const t = text.trim().replace(',', '.');
    const n = t === '' ? null : Number(t);
    if (n === null || (Number.isFinite(n) && n >= 0)) onChange(n == null ? null : decimals ? Math.round(n * 100) / 100 : Math.round(n));
    setEdit(false);
  };
  const bump = (d: number) => onChange(Math.max(0, Math.round(((value ?? 0) + d) * 100) / 100));
  return (
    <div className="p-step" aria-label={label}>
      <button onClick={() => bump(-step)} aria-label={`${label} mniej`}>−</button>
      {edit
        ? <input ref={ref} inputMode={decimals ? 'decimal' : 'numeric'} value={text} onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => e.key === 'Enter' && commit()} aria-label={label} />
        : <span role="button" tabIndex={0} onClick={() => { setText(value == null ? '' : String(value).replace('.', ',')); setEdit(true); }}>{value == null ? '–' : fmtKg(value)}{suffix && value != null ? suffix : ''}</span>}
      <button onClick={() => bump(step)} aria-label={`${label} więcej`}>+</button>
    </div>
  );
}

function ExercisePicker({ st, onClose, onPick }: { st: PhoneState; onClose: () => void; onPick: (id: string, custom?: PhoneState['custom'][number]) => void }) {
  const [q, setQ] = useState('');
  const recent = useMemo(() => {
    const ids: string[] = [];
    for (const w of st.history) for (const e of w.exercises) if (!ids.includes(e.exerciseId)) ids.push(e.exerciseId);
    for (const id of Object.keys(st.last)) if (!ids.includes(id)) ids.push(id);
    return ids;
  }, [st.history, st.last]);
  const all = useMemo(() => [...st.custom.map(c => lookupExercise(st, c.id)!), ...CATALOG.filter(c => c.vol)], [st]);
  const list = useMemo(() => {
    const t = norm(q.trim());
    if (!t) return recent.map(id => lookupExercise(st, id)).filter(Boolean).slice(0, 30) as typeof all;
    const score = (c: typeof all[number]) => (norm(c.name).startsWith(t) ? 0 : norm(c.name).includes(' ' + t) ? 1 : 2) * 2 + (c.verified ? 0 : 1);
    return all.filter(c => norm(c.name).includes(t) || norm(c.nameEn).includes(t))
      .sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name, 'pl')).slice(0, 60);
  }, [q, all, recent, st]);
  const exact = list.some(c => norm(c.name) === norm(q.trim()));
  return (
    <div className="p-sheet" role="dialog" aria-label="Dodaj ćwiczenie">
      <div className="p-sheet-head">
        <input autoFocus className="p-search" placeholder="Szukaj (np. wiosłowanie, bench)" value={q} onChange={e => setQ(e.target.value)} aria-label="Szukaj ćwiczenia" />
        <button className="p-btn sm" onClick={onClose}>Anuluj</button>
      </div>
      <div className="p-sheet-body">
        {!q && <p className="p-note">{recent.length ? 'Ostatnio wykonywane:' : 'Wpisz nazwę ćwiczenia po polsku lub angielsku.'}</p>}
        {list.map(c => (
          <button key={c.id} className="p-pick" onClick={() => onPick(c.id)}>
            <ExerciseThumb id={c.id} has={c.img} size={48} />
            <b>{c.name}</b><span>{c.eq}{c.top ? ` · ${muscleName(c.top)}` : ''}{c.custom ? ' · własne' : ''}</span>
            {st.last[c.id] && <span className="p-pick-last">Ostatnio: {st.last[c.id][1] != null ? `${fmtKg(st.last[c.id][1])} kg × ` : ''}{fmtRepsAlt(st.last[c.id][2], st.last[c.id][3], st.alt[c.id])} ({fmtDay(st.last[c.id][0])})</span>}
          </button>
        ))}
        {q.trim().length >= 3 && !exact && (
          <button className="p-pick add" onClick={() => { const c = { id: 'C_' + uid(), name: q.trim(), eq: 'inne', vol: true, top: null, local: true }; onPick(c.id, c); }}>
            <b>+ Dodaj własne: „{q.trim()}”</b><span>Mięśnie ustawisz na komputerze po przesłaniu treningu.</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ====================================================================== Wysyłanie
function SendScreen({ st, update, ids, go }: P & { ids: string[] }) {
  const ws = st.history.filter(w => ids.includes(w.id));
  const bundle = useMemo(() => phoneBundle(st, ws), [ids.join(), st.custom]);
  const [shared, setShared] = useState<string | null>(null);
  const empty = bundle.workouts.length === 0;
  const markSent = () => { update(s => ({ ...s, history: s.history.map(w => (ids.includes(w.id) ? { ...w, sentAt: Date.now() } : w)) })); go({ s: 'home' }); };
  const share = async () => {
    const name = `atlas-trening-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([bundleToFile(bundle)], name, { type: 'application/json' });
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'Trening – Atlas Treningowy' }); setShared('Plik udostępniony. Na komputerze: zakładka Telefon → „Wybierz plik z telefonu”.'); return; }
    } catch (e: any) { if (e?.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click();
    setShared('Plik zapisany w Pobranych.');
  };
  return (
    <>
      <header className="p-head"><button className="p-icon" onClick={() => go({ s: 'home' })} aria-label="Wróć">‹</button><div className="p-wt"><b>Wyślij do komputera</b></div><span /></header>
      <main className="p-main">
        {empty ? <p className="p-note">Ten trening nie ma odhaczonych serii – nie ma czego wysłać.</p> : <>
          <p className="p-note">Na komputerze: zakładka <b>Telefon → Włącz kamerkę i skanuj</b>. Podkręć jasność, trzymaj telefon ok. 30–40 cm od kamerki. Kody zmieniają się same – trzymaj, aż komputer pokaże „Odebrano”.</p>
          <div className="p-qr"><QrSender bundle={bundle} size={340} interval={650} /></div>
          <p className="p-note">{bundle.workouts.length} {bundle.workouts.length === 1 ? 'trening' : 'treningi'} · {bundle.workouts.reduce((a, w) => a + w.exercises.reduce((b, e) => b + e.sets.length, 0), 0)} serii</p>
          <button className="p-btn primary wide" onClick={markSent}>Komputer odebrał – oznacz jako wysłane</button>
          <button className="p-btn wide" onClick={share}>Kamerka nie łapie? Udostępnij jako plik</button>
          {shared && <p className="p-note ok">{shared}</p>}
          <p className="p-note">Wysłanie tego samego treningu drugi raz nic nie zdubluje – komputer rozpozna go po identyfikatorze.</p>
        </>}
      </main>
    </>
  );
}

// ====================================================================== Odbiór planów
function ReceiveScreen({ update, go }: Omit<P, 'st'>) {
  const [got, setGot] = useState<PcBundle | null>(null);
  return (
    <>
      <header className="p-head"><button className="p-icon" onClick={() => go({ s: 'home' })} aria-label="Wróć">‹</button><div className="p-wt"><b>Odbierz z komputera</b></div><span /></header>
      <main className="p-main">
        {got ? (
          <div className="p-card">
            <span className="p-eyebrow">Odebrano · profil {got.profile}</span>
            <b>{got.plans.length} {got.plans.length === 1 ? 'plan' : 'planów'}, {Object.keys(got.last).length} ostatnich wyników</b>
            <span>{got.plans.map(p => p.name).join(', ') || 'bez planów'}</span>
            <button className="p-btn primary wide" onClick={() => go({ s: 'home' })}>Gotowe</button>
          </div>
        ) : <>
          <p className="p-note">Na komputerze: zakładka <b>Telefon → Wyślij plany na telefon → Pokaż kody QR</b>. Skieruj aparat na ekran i trzymaj, aż odbierze wszystkie kody.</p>
          <QrScanner expect={Kind.PcPlans} facing="environment" onDone={b => { if (b.k === 'plans') { update(s => applyPcBundle(s, b)); setGot(b); } }} />
        </>}
      </main>
    </>
  );
}

// ====================================================================== Podgląd zakończonego treningu
function ViewScreen({ st, update, id, go }: P & { id: string }) {
  const w = st.history.find(x => x.id === id);
  const [ask, setAsk] = useState(false);
  if (!w) return <Home st={st} update={update} go={go} standalone />;
  return (
    <>
      <header className="p-head"><button className="p-icon" onClick={() => go({ s: 'home' })} aria-label="Wróć">‹</button><div className="p-wt"><b>{w.name || 'Trening'}</b><span className="p-clock">{fmtDateTime(w.startedAt)}</span></div><span /></header>
      <main className="p-main">
        {w.exercises.map(e => {
          const done = e.sets.filter(x => x.doneAt);
          if (!done.length) return null;
          return (
            <section className="p-ex" key={e.id}>
              <h3>{lookupExercise(st, e.exerciseId)?.name ?? e.exerciseId}{e.ss ? <span className="p-ss-tag inline">superseria</span> : null}</h3>
              <div className="p-done-list">{done.map((x, i) => <span key={i} className={x.warmup ? 'warm' : ''}>{x.kg != null ? `${fmtKg(x.kg)} kg × ` : ''}{x.reps == null && x.dur != null ? `${x.dur} s` : fmtRepsAlt(x.reps, e.alt ? x.repsAlt : null, e.alt)}{x.rpe != null ? ` · ${effortPct(x.rpe)}%` : ''}</span>)}</div>
            </section>
          );
        })}
        <button className="p-btn primary wide" onClick={() => go({ s: 'send', ids: [w.id] })}>{w.sentAt ? 'Wyślij ponownie' : 'Wyślij do komputera'}</button>
        {ask ? <button className="p-btn danger wide" onClick={() => { update(s => ({ ...s, history: s.history.filter(x => x.id !== id) })); go({ s: 'home' }); }}>{w.sentAt ? 'Usuń z telefonu' : 'Niewysłany! Usunąć mimo to?'}</button>
          : <button className="p-btn wide" onClick={() => setAsk(true)}>Usuń z telefonu</button>}
      </main>
    </>
  );
}

// ====================================================================== Zdjęcia offline
/** Zdjęcia zapamiętują się same po pierwszym obejrzeniu. Ten przycisk pobiera wszystkie naraz (ok. 22 MB), żeby działały bez internetu. */
function PhotoDownload() {
  const [state, setState] = useState<{ phase: 'idle' | 'run' | 'done' | 'error'; done: number; total: number; msg?: string }>({ phase: 'idle', done: 0, total: 0 });
  const [cached, setCached] = useState<number | null>(null);
  const stop = useRef(false);
  useEffect(() => {
    if (!('caches' in window)) return;
    caches.open('atlas-img').then(c => c.keys()).then(k => setCached(k.length)).catch(() => {});
  }, [state.phase]);
  useEffect(() => () => { stop.current = true; }, []); // wyjście z ekranu przerywa pobieranie
  const ids = CATALOG.filter(c => c.img).map(c => c.id);
  const files = ids.flatMap(id => [imgUrl(id, 't'), imgUrl(id, '0'), imgUrl(id, '1')]);
  const run = async () => {
    if (!('caches' in window) || !navigator.serviceWorker?.controller) { setState({ phase: 'error', done: 0, total: 0, msg: 'Pobieranie działa w zainstalowanej aplikacji (z ikony na ekranie), przy włączonym internecie.' }); return; }
    stop.current = false;
    let done = 0, failed = 0;
    setState({ phase: 'run', done, total: files.length });
    const queue = [...files];
    const cache = await caches.open('atlas-img');
    const worker = async () => {
      while (queue.length && !stop.current) {
        const f = queue.shift()!;
        try {
          if (!(await cache.match(f))) { const r = await fetch(f, { cache: 'no-store' }); if (r.ok) await cache.put(f, r); else failed++; }
        } catch { failed++; }
        done++; if (done % 15 === 0 || done === files.length) setState(s => ({ ...s, done }));
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    setState(failed ? { phase: 'error', done, total: files.length, msg: `Nie udało się pobrać ${failed} plików – sprawdź internet i spróbuj ponownie (pobrane zostaną tylko brakujące).` } : { phase: 'done', done, total: files.length });
  };
  return (
    <section className="p-sec">
      <h2>Zdjęcia ćwiczeń</h2>
      <p className="p-note">Stuknij miniaturę przy ćwiczeniu w trakcie treningu, żeby zobaczyć ruch (pozycja początkowa i końcowa). Zdjęcia zapamiętują się po pierwszym obejrzeniu. Żeby wszystkie działały bez internetu, pobierz je teraz (ok. 22 MB, najlepiej przez Wi-Fi).</p>
      {cached != null && <p className="p-note">W telefonie: {cached} z {files.length} plików.</p>}
      {state.phase === 'run'
        ? <><i className="meter" style={{ ['--w' as any]: `${(state.done / state.total) * 100}%` }} /><p className="p-note">Pobieranie: {state.done} z {state.total}…</p></>
        : <button className="p-btn wide" onClick={run}>{state.phase === 'done' ? 'Pobrano – sprawdź ponownie' : 'Pobierz wszystkie zdjęcia (ok. 22 MB)'}</button>}
      {state.phase === 'done' && <p className="p-note ok">Gotowe – zdjęcia działają teraz bez internetu.</p>}
      {state.phase === 'error' && <p className="p-note" style={{ color: 'var(--hot)' }}>{state.msg}</p>}
    </section>
  );
}

// ====================================================================== Ustawienia
function SettingsScreen({ st, update, go }: P) {
  const s = st.settings;
  const set = (patch: Partial<typeof s>) => update(x => ({ ...x, settings: { ...x.settings, ...patch } }));
  return (
    <>
      <header className="p-head"><button className="p-icon" onClick={() => go({ s: 'home' })} aria-label="Wróć">‹</button><div className="p-wt"><b>Ustawienia</b></div><span /></header>
      <main className="p-main">
        <section className="p-sec">
          <h2>Krok ciężaru (przyciski − / +)</h2>
          <div className="p-chips">{[0.5, 1, 1.25, 2.5, 5].map(v => <button key={v} className={`p-chip big ${s.kgStep === v ? 'on' : ''}`} onClick={() => set({ kgStep: v })}>{fmtKg(v)} kg</button>)}</div>
        </section>
        <section className="p-sec">
          <h2>Domyślna przerwa</h2>
          <p className="p-note">Gdy plan nie podaje przerwy dla ćwiczenia.</p>
          <div className="p-chips">{[60, 90, 120, 150, 180, 240].map(v => <button key={v} className={`p-chip big ${s.defaultRest === v ? 'on' : ''}`} onClick={() => set({ defaultRest: v })}>{fmtClock(v)}</button>)}</div>
        </section>
        <section className="p-sec">
          <h2>{IS_ANDROID ? 'Dźwięk i wibracja na koniec przerwy' : 'Dźwięk końca przerwy'}</h2>
          <div className="p-chips"><button className={`p-chip big ${s.sound ? 'on' : ''}`} onClick={() => { unlockAudio(); set({ sound: true }); scheduleBeep(0.1); }}>Włączony</button><button className={`p-chip big ${!s.sound ? 'on' : ''}`} onClick={() => set({ sound: false })}>Wyłączony</button></div>
          <p className="p-note">{IS_ANDROID
            ? 'Sygnał działa przy włączonym ekranie i otwartej aplikacji. W trakcie treningu aplikacja nie pozwala ekranowi zgasnąć. Jeśli telefon Xiaomi zamyka aplikację w tle: Ustawienia → Aplikacje → Chrome → Oszczędzanie baterii → Bez ograniczeń.'
            : 'Dźwięk gra tylko przy włączonym ekranie i otwartej aplikacji (ograniczenie iOS; iPhone nie pozwala też stronom na wibrację). W trakcie treningu aplikacja nie pozwala ekranowi zgasnąć. Wyciszenie telefonu przełącznikiem z boku też wycisza dźwięk.'}</p>
        </section>
        <PhotoDownload />
        <section className="p-sec">
          <h2>Dane w telefonie</h2>
          <p className="p-note">Treningów zapisanych w telefonie: {st.history.length} (w tym niewysłanych: {st.history.filter(w => !w.sentAt).length}). Telefon trzyma ostatnie 60. Usunięcie aplikacji z ekranu początkowego kasuje jej dane – wysyłaj treningi do komputera na bieżąco.</p>
        </section>
        <p className="p-note">Atlas Treningowy · wersja {__APP_VERSION__}</p>
      </main>
    </>
  );
}
declare const __APP_VERSION__: string;
