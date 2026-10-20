import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BUILTIN_EXERCISES, type Exercise } from '../data/catalog';
import { emptyDb, normalizeDb, type Db, type Profile } from './types';

// ---------- Zapis: w Electronie plik na dysku (przez preload), w przeglądarce localStorage.
interface DesktopApi {
  load(): Promise<string | null>;
  save(json: string): Promise<void>;
  exportFile(json: string, suggestedName: string): Promise<boolean>;
  importFile(): Promise<string | null>;
  dataPath(): Promise<string>;
  openDataFolder(): Promise<void>;
}
declare global { interface Window { atlasApi?: DesktopApi } }

const LS_KEY = 'atlas-treningowy-db';
export const isDesktop = () => typeof window !== 'undefined' && !!window.atlasApi;

async function loadRaw(): Promise<string | null> {
  if (window.atlasApi) return window.atlasApi.load();
  try { return localStorage.getItem(LS_KEY); } catch { return null; }
}
async function saveRaw(json: string) {
  if (window.atlasApi) return window.atlasApi.save(json);
  try { localStorage.setItem(LS_KEY, json); } catch { /* podgląd bez pamięci przeglądarki */ }
}

type SaveState = 'saved' | 'saving' | 'error';

interface Store {
  db: Db;
  update: (fn: (draft: Db) => void) => void;
  replaceDb: (db: Db) => void;
  profile: Profile | null;
  exercises: Exercise[];
  lookup: (id: string) => Exercise | undefined;
  saveState: SaveState;
  saveError: string | null;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Db | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef<Db | null>(null);

  useEffect(() => {
    loadRaw().then(raw => setDb(raw ? normalizeDb(JSON.parse(raw)) : emptyDb()))
      .catch(e => setLoadError(String(e?.message ?? e)));
  }, []);

  const flush = useCallback(() => {
    const d = latest.current; if (!d) return;
    setSaveState('saving');
    saveRaw(JSON.stringify(d)).then(() => { setSaveState('saved'); setSaveError(null); })
      .catch(e => { setSaveState('error'); setSaveError(String(e?.message ?? e)); });
  }, []);

  const schedule = useCallback((d: Db) => {
    latest.current = d;
    setSaveState('saving');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 400);
  }, [flush]);

  useEffect(() => {
    const onUnload = () => { if (timer.current) { window.clearTimeout(timer.current); flush(); } };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [flush]);

  const update = useCallback((fn: (draft: Db) => void) => {
    setDb(prev => {
      if (!prev) return prev;
      const draft = structuredClone(prev);
      fn(draft);
      schedule(draft);
      return draft;
    });
  }, [schedule]);

  const replaceDb = useCallback((next: Db) => { setDb(next); schedule(next); }, [schedule]);

  const exercises = useMemo<Exercise[]>(() => {
    if (!db) return [];
    const builtin = BUILTIN_EXERCISES.map(e => db.weightOverrides[e.id] ? { ...e, muscles: db.weightOverrides[e.id] } : e);
    const custom: Exercise[] = db.customExercises.map(c => ({
      id: c.id, name: c.name, nameEn: c.nameEn, category: 'strength', categoryPl: 'własne', equipmentPl: c.equipmentPl,
      muscles: c.muscles, countsForVolume: c.countsForVolume, weightsSource: 'własne', instructionsEn: [], source: 'własne',
    }));
    return [...custom, ...builtin];
  }, [db?.customExercises, db?.weightOverrides]);

  const byId = useMemo(() => new Map(exercises.map(e => [e.id, e])), [exercises]);
  const lookup = useCallback((id: string) => byId.get(id), [byId]);

  if (loadError) return <div className="fatal"><h1>Nie udało się wczytać danych</h1><p>{loadError}</p>
    <p>Plik z danymi może być uszkodzony. Kopia zapasowa jest w tym samym folderze (plik z końcówką .bak.json).</p></div>;
  if (!db) return <div className="fatal"><p>Wczytywanie…</p></div>;

  const profile = db.profiles.find(p => p.id === db.activeProfileId) ?? db.profiles[0] ?? null;
  return <Ctx.Provider value={{ db, update, replaceDb, profile, exercises, lookup, saveState, saveError }}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore poza StoreProvider');
  return s;
}
