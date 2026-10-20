import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { EQUIPMENT, MUSCLES, shortName, type Exercise, type MuscleId } from '../data/catalog';
import { cssVar } from '../three/BodyViewer';
import type { TargetState } from '../lib/stats';
import { EFFORT_LEVELS, effortLevel } from '../shared/effort';

// ---------- Kolory
function mix(a: string, b: string, t: number) {
  const pa = hex(a), pb = hex(b);
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}
function hex(c: string): number[] {
  const h = c.replace('#', '');
  const f = h.length === 3 ? h.split('').map(x => x + x).join('') : h.slice(0, 6);
  return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16));
}
/** Skala zaangażowania 0–1: szary → akcent → czerwony */
export function rampColor(w: number) {
  if (!w) return cssVar('--none');
  return w < 0.5 ? mix(cssVar('--none'), cssVar('--accent'), w * 2) : mix(cssVar('--accent'), cssVar('--hot'), (w - 0.5) * 2);
}
export function stateColor(s: TargetState) {
  return cssVar({ none: '--none', below: '--cold', ok: '--ok', above: '--hot', notarget: '--notarget' }[s]);
}
export const STATE_SHORT: Record<TargetState, string> = {
  none: 'brak', below: 'za mało', ok: 'w celu', above: 'za dużo', notarget: 'bez celu',
};
export const STATE_LABEL: Record<TargetState, string> = {
  none: 'nietrenowany', below: 'poniżej celu', ok: 'w celu', above: 'powyżej celu', notarget: 'bez celu',
};

// ---------- Formatowanie
const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const MONTHS_FULL = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
const DAYS = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'];
export const fmtDate = (d: string) => { const x = new Date(d + 'T12:00:00'); return `${x.getDate()} ${MONTHS[x.getMonth()]} ${x.getFullYear()}`; };
export const dayOfMonth = (d: string) => new Date(d + 'T12:00:00').getDate();
export const monthShort = (d: string) => MONTHS[new Date(d + 'T12:00:00').getMonth()];
export const weekday = (d: string) => DAYS[new Date(d + 'T12:00:00').getDay()];
export const monthTitle = (d: string) => { const x = new Date(d + 'T12:00:00'); return `${MONTHS_FULL[x.getMonth()]} ${x.getFullYear()}`; };
export const fmtNum = (n: number, digits = 1) => n.toLocaleString('pl-PL', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
export const fmtKg = (n: number) => n >= 1000 ? `${fmtNum(n / 1000, 1)} t` : `${fmtNum(n, 0)} kg`;
export const fmtDur = (sec: number) => {
  if (!sec) return '0 min';
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
};
export const pct = (w: number) => `${Math.round(w * 100)}%`;
export const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
export const addDays = (d: string, n: number) => {
  const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

// ---------- Okno dialogowe
export function Dialog(p: { title: string; onClose: () => void; children: ReactNode; foot?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [p.onClose]);
  return (
    <div className="backdrop" onMouseDown={e => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div className={`dialog${p.wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={p.title}>
        <div className="dialog-head"><h2>{p.title}</h2><button className="btn ghost x" onClick={p.onClose} aria-label="Zamknij">✕</button></div>
        <div className="dialog-body">{p.children}</div>
        {p.foot && <div className="dialog-foot">{p.foot}</div>}
      </div>
    </div>
  );
}

/** Przycisk z potwierdzeniem w miejscu (bez systemowych okienek). */
export function ConfirmButton(p: { label: string; confirm: string; onConfirm: () => void; className?: string }) {
  const [ask, setAsk] = useState(false);
  useEffect(() => { if (!ask) return; const t = setTimeout(() => setAsk(false), 4000); return () => clearTimeout(t); }, [ask]);
  return ask
    ? <button className={`btn danger ${p.className ?? ''}`} onClick={() => { setAsk(false); p.onConfirm(); }}>{p.confirm}</button>
    : <button className={`btn ${p.className ?? ''}`} onClick={() => setAsk(true)}>{p.label}</button>;
}

// ---------- Lista ćwiczeń z filtrami (atlas, wybór do treningu, baza ćwiczeń)
export interface ExerciseFilterState { q: string; eq: string; muscle: string; stretch: boolean }
export const emptyFilter = (): ExerciseFilterState => ({ q: '', eq: '', muscle: '', stretch: false });

export function useFilteredExercises(all: Exercise[], f: ExerciseFilterState, focusMuscle: MuscleId | null, minWeight = 0.3, recent: string[] = []) {
  return useMemo(() => {
    const q = norm(f.q.trim());
    const m = focusMuscle || f.muscle || null;
    const rank = new Map(recent.map((id, i) => [id, i]));
    let list = all.filter(e => (f.stretch || e.countsForVolume) && (!f.eq || e.equipmentPl === f.eq)
      && (!q || norm(e.name).includes(q) || norm(e.nameEn).includes(q)));
    if (m) {
      list = list.filter(e => (e.muscles[m] || 0) >= minWeight);
      list.sort((a, b) => (b.muscles[m] - a.muscles[m]) || verified(b) - verified(a) || a.name.localeCompare(b.name, 'pl'));
    } else {
      list.sort((a, b) => ((rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9)) || verified(b) - verified(a) || a.name.localeCompare(b.name, 'pl'));
    }
    return { list, muscle: m };
  }, [all, f.q, f.eq, f.muscle, f.stretch, focusMuscle, minWeight, recent]);
}
const verified = (e: Exercise) => (e.weightsSource === 'automatyczne' ? 0 : 1);

export function ExerciseFilters(p: { f: ExerciseFilterState; set: (f: ExerciseFilterState) => void; showMuscle?: boolean; autoFocus?: boolean }) {
  const { f, set } = p;
  return (
    <div className="filters">
      <input id="ex-q" type="search" placeholder="Szukaj ćwiczenia (po polsku lub angielsku)" value={f.q} autoFocus={p.autoFocus}
        onChange={e => set({ ...f, q: e.target.value })} aria-label="Szukaj ćwiczenia" />
      <select id="ex-eq" value={f.eq} onChange={e => set({ ...f, eq: e.target.value })} aria-label="Sprzęt">
        <option value="">każdy sprzęt</option>
        {EQUIPMENT.map(x => <option key={x}>{x}</option>)}
      </select>
      {p.showMuscle && (
        <select id="ex-m" className="full" value={f.muscle} onChange={e => set({ ...f, muscle: e.target.value })} aria-label="Mięsień">
          <option value="">każdy mięsień</option>
          {MUSCLES.map(m => <option key={m.id} value={m.id}>{shortName(m.id)}</option>)}
        </select>
      )}
      <label className="check full"><input type="checkbox" checked={f.stretch} onChange={e => set({ ...f, stretch: e.target.checked })} /> pokaż rozciągania i cardio</label>
    </div>
  );
}

export function ExerciseList(p: { list: Exercise[]; muscle: MuscleId | null; selected?: string | null; onSelect: (e: Exercise) => void; limit?: number; extra?: (e: Exercise) => ReactNode }) {
  const [limit, setLimit] = useState(p.limit ?? 40);
  useEffect(() => setLimit(p.limit ?? 40), [p.list, p.limit]);
  return (
    <>
      <ul className="exlist">
        {p.list.slice(0, limit).map(e => {
          const w = p.muscle ? e.muscles[p.muscle] : 0;
          const top = Object.keys(e.muscles)[0];
          return (
            <li key={e.id}>
              <button className={`ex${e.id === p.selected ? ' sel' : ''}`} onClick={() => p.onSelect(e)}>
                <span className="nm">{e.name}</span>
                <span className="bar">{p.muscle ? <><i className="meter" style={{ ['--w' as any]: pct(w) }} /><span>{pct(w)}</span></> : null}</span>
                <span className="meta">
                  <span>{e.equipmentPl}</span>
                  {!p.muscle && top && <span>{shortName(top)}</span>}
                  {!e.countsForVolume && <span>{e.categoryPl}</span>}
                  {e.source === 'własne' ? <span className="tag-ok">własne</span> : e.weightsSource === 'ręczne' ? <span className="tag-ok">zweryfikowane</span> : null}
                  {p.extra?.(e)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {p.list.length > limit && <button className="btn small" style={{ justifySelf: 'center' }} onClick={() => setLimit(l => l + 60)}>Pokaż więcej ({p.list.length - limit})</button>}
      {p.list.length === 0 && <p className="note">Brak ćwiczeń dla tych filtrów.</p>}
    </>
  );
}

/** Lista mięśni ćwiczenia z paskami zaangażowania. */
export function MuscleBars(p: { weights: Record<MuscleId, number>; onClick?: (m: MuscleId) => void }) {
  return (
    <div className="mlist">
      {Object.entries(p.weights).sort((a, b) => b[1] - a[1]).map(([m, w]) => (
        <div key={m} className="mrow" onClick={() => p.onClick?.(m)} style={{ cursor: p.onClick ? 'pointer' : undefined }}>
          <span className="mn">{shortName(m)}</span>
          <i className="meter" style={{ ['--w' as any]: pct(w), ['--c' as any]: rampColor(w) }} />
          <span className="v">{pct(w)}</span>
        </div>
      ))}
    </div>
  );
}

/** Wybór trudności serii (komputer): te same poziomy co na telefonie. */
export function EffortSelect(p: { value: number | null; onChange: (rpe: number | null) => void; id: string }) {
  const lvl = effortLevel(p.value);
  return (
    <select id={p.id} className="effort-sel" value={lvl ? String(lvl.rpe) : ''} onChange={e => p.onChange(e.target.value ? Number(e.target.value) : null)}
      aria-label="Trudność serii" title={lvl?.label ?? 'Bez oceny'} style={lvl ? { ['--c' as any]: effortColor(lvl.rpe) } : undefined}>
      <option value="">–</option>
      {EFFORT_LEVELS.map(l => <option key={l.rpe} value={l.rpe}>{l.pct}% · {l.short}</option>)}
    </select>
  );
}
export const effortColor = (rpe: number) => (rpe >= 10 ? cssVar('--hot') : mix(cssVar('--none'), cssVar('--accent'), Math.max(0, Math.min(1, (rpe - 5) / 4))));
