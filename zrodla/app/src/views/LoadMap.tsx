import { useMemo, useState } from 'react';
import { useStore } from '../store/store';
import { todayIso } from '../store/types';
import { DEFAULT_TARGETS, GROUPS, MUSCLES, shortName } from '../data/catalog';
import { periodStats, targetState, type TargetState } from '../lib/stats';
import { BodyViewer } from '../three/BodyViewer';
import { STATE_LABEL, STATE_SHORT, addDays, fmtDate, fmtNum, rampColor, stateColor } from '../ui/common';

type Period = '7' | '28' | '84' | 'all';
const PERIODS: { id: Period; label: string }[] = [
  { id: '7', label: '7 dni' }, { id: '28', label: '4 tygodnie' }, { id: '84', label: '12 tygodni' }, { id: 'all', label: 'Cały okres' },
];
type Metric = 'target' | 'freq';

export function LoadMapView() {
  const { db, update, profile, lookup } = useStore();
  const [period, setPeriod] = useState<Period>('28');
  const [metric, setMetric] = useState<Metric>('target');
  const [sel, setSel] = useState<string | null>(null);
  const [sort, setSort] = useState<'body' | 'deficit'>('deficit');

  const mine = useMemo(() => db.workouts.filter(w => w.profileId === profile!.id), [db.workouts, profile]);
  const to = todayIso();
  const first = mine.reduce((a, w) => (w.date < a ? w.date : a), to);
  const from = period === 'all' ? first : addDays(to, -(Number(period) - 1));
  const { stats, weeks, workoutCount } = useMemo(() => periodStats(mine, from, to, lookup), [mine, from, to, lookup]);

  const target = (m: string) => (m in profile!.targets ? profile!.targets[m] : DEFAULT_TARGETS[m]) ?? null;
  const state = (m: string): TargetState => targetState(stats[m]?.perWeek ?? 0, target(m));
  const maxFreq = Math.max(1, ...Object.values(stats).map(s => s.freqPerWeek));

  const rows = useMemo(() => {
    const r = MUSCLES.map(m => {
      const s = stats[m.id], t = target(m.id), pw = s?.perWeek ?? 0;
      const deficit = t ? (pw < t[0] ? (t[0] - pw) / t[0] : pw > t[1] ? -0.01 : -1) : -2;
      return { m, s, t, pw, st: state(m.id), deficit };
    });
    if (sort === 'deficit') r.sort((a, b) => b.deficit - a.deficit);
    return r;
  }, [stats, profile, sort]);

  const counts = rows.reduce((a, r) => { a[r.st] = (a[r.st] ?? 0) + 1; return a; }, {} as Record<TargetState, number>);
  const setTarget = (m: string, v: [number, number] | null) => update(d => { const p = d.profiles.find(x => x.id === profile!.id)!; p.targets[m] = v; });
  const resetTarget = (m: string) => update(d => { const p = d.profiles.find(x => x.id === profile!.id)!; delete p.targets[m]; });

  return (
    <div className="page">
      <div className="page-head">
        <div><div className="eyebrow">Profil: {profile!.name}</div><h1>Mapa obciążenia</h1></div>
        <div className="seg" role="group" aria-label="Okres">
          {PERIODS.map(p => <button key={p.id} aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}>{p.label}</button>)}
        </div>
        <div className="seg" role="group" aria-label="Co pokazać">
          <button aria-pressed={metric === 'target'} onClick={() => setMetric('target')}>Serie względem celu</button>
          <button aria-pressed={metric === 'freq'} onClick={() => setMetric('freq')}>Częstotliwość</button>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi"><b>{workoutCount}</b><span>treningów ({fmtDate(from)} – {fmtDate(to)})</span></div>
        <div className="kpi"><b>{fmtNum(weeks)}</b><span>tygodni w okresie</span></div>
        <div className="kpi"><b style={{ color: 'var(--ok)' }}>{counts.ok ?? 0}</b><span>mięśni w celu</span></div>
        <div className="kpi"><b style={{ color: 'var(--cold)' }}>{(counts.below ?? 0) + rows.filter(r => r.t && r.st === 'none').length}</b><span>poniżej celu</span></div>
        <div className="kpi"><b style={{ color: 'var(--hot)' }}>{counts.above ?? 0}</b><span>powyżej celu</span></div>
      </div>

      {workoutCount === 0 && <div className="empty"><h2>Brak treningów w tym okresie</h2><p>Zapisz treningi albo wybierz dłuższy okres. Mapa liczy efektywne serie: serie robocze × udział mięśnia w ćwiczeniu.</p></div>}

      <div className="split map">
        <div style={{ position: 'relative' }}>
          <BodyViewer paintKey={[stats, metric, profile!.targets]} selected={sel}
            colorOf={m => metric === 'freq' ? rampColor(Math.min(1, (stats[m]?.freqPerWeek ?? 0) / maxFreq)) : stateColor(state(m))}
            tooltip={m => metric === 'freq'
              ? `${shortName(m)}: ${fmtNum(stats[m]?.freqPerWeek ?? 0)} × w tygodniu`
              : `${shortName(m)}: ${fmtNum(stats[m]?.perWeek ?? 0)} serii/tydz. · ${STATE_LABEL[state(m)]}`}
            onPick={m => setSel(m === sel ? null : m)} />
          <div className="legend">
            {metric === 'target' ? <>
              <div className="eyebrow">Efektywne serie / tydzień</div>
              {(['none', 'below', 'ok', 'above', 'notarget'] as TargetState[]).map(s => <div key={s} className="li"><i className="sw" style={{ background: stateColor(s) }} />{STATE_LABEL[s]}</div>)}
            </> : <>
              <div className="eyebrow">Treningi z mięśniem / tydzień</div>
              <div className="ramp" /><div className="ramp-l"><span>0</span><span>{fmtNum(maxFreq)}</span></div>
            </>}
          </div>
        </div>
        <div className="panel" style={{ alignContent: 'start' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h2>Mięśnie</h2>
            <div className="seg" role="group" aria-label="Sortowanie">
              <button aria-pressed={sort === 'deficit'} onClick={() => setSort('deficit')}>Największe braki</button>
              <button aria-pressed={sort === 'body'} onClick={() => setSort('body')}>Wg partii</button>
            </div>
          </div>
          <div className="scroll">
            <table className="mtable">
              <thead><tr><th>Mięsień</th><th className="r">Serie / tydz.</th><th>Cel (serie)</th><th className="r">Tren. / tydz.</th><th>Stan</th></tr></thead>
              <tbody>
                {rows.map(({ m, s, t, pw, st }) => (
                  <tr key={m.id} className={sel === m.id ? 'sel' : ''} onClick={() => setSel(sel === m.id ? null : m.id)}>
                    <td>{shortName(m.id)}{sort === 'body' && <div className="muted" style={{ fontSize: 11 }}>{GROUPS.find(g => g.id === m.group)?.name}</div>}</td>
                    <td className="r num">{fmtNum(pw)}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <TargetCell value={t} isDefault={!(m.id in profile!.targets)} onChange={v => setTarget(m.id, v)} onReset={() => resetTarget(m.id)} />
                    </td>
                    <td className="r num">{fmtNum(s?.freqPerWeek ?? 0)}</td>
                    <td><span className="pill" style={{ background: stateColor(st) }}>{STATE_SHORT[st]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">Cel to zakres efektywnych serii na tydzień. Wartości domyślne możesz zmienić w tabeli; puste pola = bez celu (mięśnie stabilizujące). „Tren./tydz.” to średnia liczba treningów w tygodniu, w których mięsień dostał co najmniej 1 efektywną serię.</p>
        </div>
      </div>
    </div>
  );
}

function TargetCell(p: { value: [number, number] | null; isDefault: boolean; onChange: (v: [number, number] | null) => void; onReset: () => void }) {
  const [a, b] = p.value ?? [null, null];
  const num = (s: string) => { const n = Number(s.replace(',', '.')); return s.trim() === '' || !Number.isFinite(n) ? null : Math.max(0, n); };
  const commit = (x: number | null, y: number | null) => {
    if (x == null && y == null) return p.onChange(null);
    const lo = x ?? 0, hi = y ?? Math.max(lo, 1);
    p.onChange([Math.min(lo, hi), Math.max(lo, hi)]);
  };
  return (
    <span className="tgt">
      <input aria-label="Cel minimum" inputMode="decimal" defaultValue={a ?? ''} key={`a${a}`} onBlur={e => commit(num(e.target.value), b)} />
      –
      <input aria-label="Cel maksimum" inputMode="decimal" defaultValue={b ?? ''} key={`b${b}`} onBlur={e => commit(a, num(e.target.value))} />
      {!p.isDefault && <button className="btn ghost small" title="Przywróć cel domyślny" onClick={p.onReset}>↺</button>}
    </span>
  );
}
