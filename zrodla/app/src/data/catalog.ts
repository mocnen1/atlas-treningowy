// Katalog: mięśnie (43 mięśnie treningowe modelu 3D) i wbudowana baza ćwiczeń.
import musclesJson from './muscles.json';
import exercisesJson from './exercises.json';

export type MuscleId = string;
export type Weights = Record<MuscleId, number>; // 0–1: udział mięśnia w ćwiczeniu

export interface Muscle { id: MuscleId; group: string; name: string; latin: string }
export interface MuscleGroup { id: string; name: string }

export interface Exercise {
  id: string;
  name: string;
  nameEn: string;
  category: string;
  categoryPl: string;
  equipmentPl: string;
  level?: string | null;
  levelPl?: string;
  muscles: Weights;
  countsForVolume: boolean;
  weightsSource: 'ręczne' | 'automatyczne' | 'własne';
  instructionsEn: string[];
  source: 'free-exercise-db' | 'uzupełnienie' | 'własne';
}

export const GROUPS: MuscleGroup[] = musclesJson.groups;
export const MUSCLES: Muscle[] = musclesJson.muscles.map(({ id, group, name, latin }) => ({ id, group, name, latin }));
export const MUSCLE_BY_ID: Record<MuscleId, Muscle> = Object.fromEntries(MUSCLES.map(m => [m.id, m]));
export const shortName = (id: MuscleId) => (MUSCLE_BY_ID[id]?.name ?? id).replace(/\s*\(.*\)$/, '');

export const BUILTIN_EXERCISES: Exercise[] = (exercisesJson as any[]).map(e => ({
  id: e.id, name: e.name, nameEn: e.nameEn, category: e.category, categoryPl: e.categoryPl, equipmentPl: e.equipmentPl,
  level: e.level, levelPl: e.levelPl, muscles: e.muscles, countsForVolume: e.countsForVolume,
  weightsSource: e.weightsSource, instructionsEn: e.instructionsEn ?? [], source: e.source,
}));

export const EQUIPMENT = ['sztanga', 'sztanga łamana', 'hantle', 'kettlebell', 'wyciąg', 'maszyna', 'masa ciała', 'gumy',
  'piłka lekarska', 'piłka gimnastyczna', 'roller', 'inne', 'brak'];

/**
 * Domyślne cele: efektywne serie na tydzień [min, max].
 * Duże mięśnie ~10–20 (typowy zakres z metaanaliz objętości treningowej, liczony na grupę mięśniową).
 * Części tego samego mięśnia dostają niższe progi, bo i tak pracują razem.
 * null = brak celu (mięśnie stabilizujące, które dostają pracę „przy okazji”).
 */
export const DEFAULT_TARGETS: Record<MuscleId, [number, number] | null> = {
  chest_clav: [6, 14], chest_stern: [8, 16], chest_abd: [4, 12], pec_minor: null, serratus: null,
  delt_front: [4, 12], delt_side: [8, 18], delt_rear: [6, 14], rotator_cuff: null,
  traps_upper: [4, 12], traps_mid: [6, 14], traps_lower: null, rhomboids: [6, 14], levator_scap: null,
  lats: [10, 20], teres_major: null, erectors: [4, 10], quadratus_lumb: null,
  neck_front: null, neck_back: null,
  biceps: [8, 16], brachialis: [4, 12], triceps_long: [6, 14], triceps_short: [6, 14],
  brachioradialis: null, forearm_flex: null, forearm_ext: null,
  abs: [6, 14], obliques: [4, 10], transversus: null,
  glute_max: [8, 16], glute_med: [4, 10], tfl: null, hip_flexors: null, hip_rotators: null,
  rectus_fem: [4, 12], vasti: [10, 20], hamstrings: [8, 16], adductors: [4, 12],
  gastrocnemius: [6, 14], soleus: [4, 12], tibialis_ant: null, fibularis: null,
};
