import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import maleUrl from '../assets/body.glb?url';
import femaleUrl from '../assets/body_f.glb?url';
import type { MuscleId } from '../data/catalog';
import type { BodyModel } from '../store/types';
import { useStore } from '../store/store';

const modelPromises: Partial<Record<BodyModel, Promise<GLTF>>> = {};
function loadModel(model: BodyModel) {
  if (!modelPromises[model]) {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    modelPromises[model] = loader.loadAsync(model === 'female' ? femaleUrl : maleUrl);
  }
  return modelPromises[model]!;
}

export const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export interface BodyViewerProps {
  /** Kolor mięśnia (dowolny kolor CSS). Brak = kolor bazowy mięśnia. */
  colorOf?: (id: MuscleId) => string | null;
  /** Mięsień wyróżniony obwódką/świeceniem */
  selected?: MuscleId | null;
  onHover?: (id: MuscleId | null) => void;
  onPick?: (id: MuscleId | null) => void;
  tooltip?: (id: MuscleId) => string;
  /** Zmień tę wartość, gdy kolory zależą od danych, żeby model się przemalował */
  paintKey?: unknown;
  compact?: boolean;
  /** Model 3D; domyślnie model aktywnego profilu */
  model?: BodyModel;
}

type Inst = {
  renderer: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera; controls: OrbitControls; scene: THREE.Scene;
  muscles: { mesh: THREE.Mesh; id: MuscleId; mat: THREE.MeshStandardMaterial }[];
  bones: THREE.Mesh[]; context: THREE.Mesh[]; pickables: THREE.Object3D[];
  center: THREE.Vector3; dist: number; hover: MuscleId | null;
};

export function BodyViewer(p: BodyViewerProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const inst = useRef<Inst | null>(null);
  const props = useRef(p); props.current = p;
  const { profile } = useStore();
  const model: BodyModel = p.model ?? profile?.bodyModel ?? 'male';
  const [hasBones, setHasBones] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bones, setBones] = useState(true);
  const [spin, setSpin] = useState(false);

  const paint = () => {
    const i = inst.current; if (!i) return;
    const base = new THREE.Color(cssVar('--muscle')), acc = new THREE.Color(cssVar('--accent'));
    for (const m of i.muscles) {
      const c = props.current.colorOf?.(m.id);
      const col = c ? new THREE.Color(c) : base.clone();
      const sel = m.id === props.current.selected, hov = m.id === i.hover;
      if (hov && !sel) col.lerp(acc, 0.45);
      m.mat.color.copy(col);
      m.mat.emissive.set(0x000000);
      if (sel) m.mat.emissive.copy(acc).multiplyScalar(0.35);
      else if (hov) m.mat.emissive.copy(acc).multiplyScalar(0.12);
    }
    for (const b of i.bones) (b.material as THREE.MeshStandardMaterial).color.set(cssVar('--bone'));
    for (const c of i.context) (c.material as THREE.MeshStandardMaterial).color.set(cssVar('--context'));
  };

  useEffect(() => {
    let disposed = false, raf = 0;
    const renderer = new THREE.WebGLRenderer({ canvas: canvas.current!, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 20);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 0.35; controls.autoRotateSpeed = 1.2;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6b6157, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(1.5, 2.5, 2.5); scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.9); rim.position.set(-2, 1.5, -2.5); scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(0, -1, 2); scene.add(fill);
    const i: Inst = { renderer, camera, controls, scene, muscles: [], bones: [], context: [], pickables: [], center: new THREE.Vector3(0, 0.9, 0), dist: 3.2, hover: null };
    inst.current = i;

    const resize = () => {
      const r = wrap.current!.getBoundingClientRect();
      renderer.setSize(r.width, r.height, false);
      camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize); ro.observe(wrap.current!); resize();

    setReady(false); setError(null);
    loadModel(model).then(gltf => {
      if (disposed) return;
      const root = gltf.scene.clone(true);
      root.traverse(o => {
        if (!(o as THREE.Mesh).isMesh) return;
        const mesh = o as THREE.Mesh;
        let q: THREE.Object3D | null = mesh; while (q && !q.userData.kind) q = q.parent;
        const ud = q?.userData ?? {};
        if (ud.kind === 'muscle') {
          const mat = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0 });
          mesh.material = mat; mesh.userData.muscleId = ud.muscleId;
          i.muscles.push({ mesh, id: ud.muscleId, mat }); i.pickables.push(mesh);
        } else {
          mesh.material = new THREE.MeshStandardMaterial({ roughness: ud.kind === 'bone' ? 0.8 : 0.7 });
          (ud.kind === 'bone' ? i.bones : i.context).push(mesh); i.pickables.push(mesh);
        }
      });
      const box = new THREE.Box3().setFromObject(root), c = box.getCenter(new THREE.Vector3());
      root.position.set(-c.x, -box.min.y, -c.z);
      scene.add(root);
      const h = box.max.y - box.min.y;
      i.center.set(0, h * 0.52, 0); i.dist = h * (props.current.compact ? 2.15 : 1.95); controls.maxDistance = h * 4;
      setHasBones(i.bones.length > 0);
      setView('front');
      paint(); setReady(true);
    }).catch(e => setError(String(e?.message ?? e)));

    // najechanie i kliknięcie
    const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
    let pending: [number, number] | null = null, down: [number, number] | null = null;
    const pick = (x: number, y: number) => {
      const r = renderer.domElement.getBoundingClientRect();
      ptr.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      const hit = ray.intersectObjects(i.pickables.filter(o => o.visible), false)[0];
      return (hit?.object.userData.muscleId as string | undefined) ?? null;
    };
    const el = renderer.domElement;
    const onMove = (e: PointerEvent) => { if (e.pointerType === 'mouse' && !e.buttons) pending = [e.clientX, e.clientY]; };
    const onLeave = () => {
      pending = null; if (tipRef.current) tipRef.current.hidden = true;
      if (i.hover) { i.hover = null; paint(); props.current.onHover?.(null); }
      el.style.cursor = '';
    };
    const onDown = (e: PointerEvent) => { down = [e.clientX, e.clientY]; };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
      props.current.onPick?.(pick(e.clientX, e.clientY));
    };
    el.addEventListener('pointermove', onMove); el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointerdown', onDown); el.addEventListener('pointerup', onUp);

    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (pending) {
        const [x, y] = pending; pending = null;
        const id = pick(x, y);
        const tip = tipRef.current!, r = wrap.current!.getBoundingClientRect();
        if (id) {
          tip.hidden = false; tip.style.left = `${x - r.left}px`; tip.style.top = `${y - r.top}px`;
          tip.textContent = props.current.tooltip?.(id) ?? id; el.style.cursor = 'pointer';
        } else { tip.hidden = true; el.style.cursor = ''; }
        if (id !== i.hover) { i.hover = id; paint(); props.current.onHover?.(id); }
      }
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', paint);
    return () => {
      disposed = true; cancelAnimationFrame(raf); ro.disconnect(); mq.removeEventListener('change', paint);
      el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp);
      controls.dispose();
      for (const m of i.muscles) m.mat.dispose();
      renderer.dispose(); renderer.forceContextLoss(); inst.current = null;
    };
  }, [model]);

  useEffect(() => { paint(); }, [p.paintKey, p.selected, p.colorOf]);
  useEffect(() => { inst.current?.bones.forEach(b => (b.visible = bones)); }, [bones, ready]);
  useEffect(() => { if (inst.current) inst.current.controls.autoRotate = spin; }, [spin]);

  function setView(dir: 'front' | 'back' | 'side') {
    const i = inst.current; if (!i) return;
    const v = { front: [0, 0.05, 1], back: [0, 0.05, -1], side: [1, 0.05, 0] }[dir] as [number, number, number];
    i.camera.position.copy(i.center).add(new THREE.Vector3(...v).normalize().multiplyScalar(i.dist));
    i.controls.target.copy(i.center); i.controls.update();
  }

  return (
    <div className="viewer" ref={wrap}>
      <canvas key={model} ref={canvas} aria-label="Model 3D mięśni" />
      {!ready && <div className="viewer-msg">{error ? `Nie udało się wczytać modelu: ${error}` : 'Wczytywanie modelu…'}</div>}
      <div className="viewer-tip" ref={tipRef} hidden />
      <div className="viewer-tools">
        <button onClick={() => setView('front')}>Przód</button>
        <button onClick={() => setView('back')}>Tył</button>
        <button onClick={() => setView('side')}>Bok</button>
        {hasBones && <button aria-pressed={bones} onClick={() => setBones(b => !b)}>Szkielet</button>}
        {!p.compact && <button aria-pressed={spin} onClick={() => setSpin(s => !s)}>Obrót</button>}
      </div>
    </div>
  );
}
