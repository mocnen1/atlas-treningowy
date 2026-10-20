"""Podział kobiecego modelu (Sketchfab, CC BY 4.0) na mięśnie modelu męskiego (Z-Anatomy).

1. Dopasowanie: skala do wysokości, wyśrodkowanie, potem ICP (obrót + przesunięcie + skala) do punktów modelu męskiego.
2. Etykiety: każdy trójkąt kobiecego modelu dostaje etykietę najbliższego punktu powierzchni modelu męskiego
   (mięsień + strona, „context” = mięśnie bez interakcji, „bone” = kość).
3. Model kobiecy składa się z ~450 osobno wyrzeźbionych kawałków (mięśni). Kawałek, w którym jedna etykieta
   ma wyraźną przewagę, dostaje ją w całości – granica wypada wtedy na granicy wyrzeźbionego mięśnia.
   Kawałki mieszane zostają podzielone po trójkątach, z wygładzeniem (głosowanie sąsiadów).
4. Eksport .glb w tym samym układzie węzłów co model męski: M_<id>_<strona> (extras: kind, muscleId, side), context_muscles, skeleton.

Użycie: python -I transfer.py <male body.glb (nieskompresowany)> <female scene.gltf> <wyjście.glb> <raport.json> [uproszczona kopia .glb do NICP]
"""
import sys, re, json, collections
import numpy as np, trimesh
from scipy.spatial import cKDTree
sys.path.insert(0, __import__('os').path.dirname(__file__))
from load import load_male, load_female

male_path, female_path, out_path, report_path = sys.argv[1:5]
rng = np.random.default_rng(0)
BIG_FRACTION = 0.03   # kawałek większy niż 3% powierzchni = wiele mięśni
SMOOTH_ROUNDS = 25

# ---------- etykiety modelu męskiego
male = load_male(male_path)
labels, pts, lab_idx = [], [], []
for name, m in male:
    mt = re.match(r'^M_(.+)_(l|r|c)$', name)
    lab = f'{mt.group(1)}|{mt.group(2)}' if mt else ('bone' if name == 'skeleton' else 'context')
    if lab not in labels: labels.append(lab)
    n = int(max(200, m.area * 2.0e6))  # gęstość ~2 punkty / cm²
    p, _ = trimesh.sample.sample_surface(m, n, seed=1)
    pts.append(p); lab_idx.append(np.full(len(p), labels.index(lab)))
pts = np.vstack(pts); lab_idx = np.concatenate(lab_idx)
# Z-Anatomy: rozcięgno skośnego zewnętrznego przykrywa z przodu prosty brzucha. Punkty „skośnych” leżące
# tuż nad prostym brzucha (w pasie przed nim) traktujemy jako prosty brzucha.
for side in 'lr':
    if f'abs|{side}' not in labels or f'obliques|{side}' not in labels: continue
    A, O = labels.index(f'abs|{side}'), labels.index(f'obliques|{side}')
    abs_pts = pts[lab_idx == A]; oi = np.where(lab_idx == O)[0]
    d, j = cKDTree(abs_pts).query(pts[oi])
    over = (d < 0.018) & (pts[oi, 2] > abs_pts[j, 2] - 0.002)
    lab_idx[oi[over]] = A
    print(f'skośne→prosty brzucha ({side}):', int(over.sum()), 'punktów')
print('punkty modelu męskiego:', len(pts), 'etykiet:', len(labels))

# ---------- dopasowanie modelu kobiecego
f = load_female(female_path); f.merge_vertices()
mb = trimesh.util.concatenate([m for n, m in male if n != 'skeleton']).bounds
s = (mb[1, 1] - mb[0, 1]) / (f.bounds[1, 1] - f.bounds[0, 1])
T0 = np.eye(4); T0[:3, :3] *= s
f.apply_transform(T0)
t = np.array([(mb[0, 0] + mb[1, 0]) / 2 - (f.bounds[0, 0] + f.bounds[1, 0]) / 2, mb[0, 1] - f.bounds[0, 1],
              (mb[0, 2] + mb[1, 2]) / 2 - (f.bounds[0, 2] + f.bounds[1, 2]) / 2])
f.apply_translation(t)
sample_f, _ = trimesh.sample.sample_surface(f, 40000, seed=2)
sub = pts[rng.choice(len(pts), 120000, replace=False)]
M, _, cost = trimesh.registration.icp(sample_f, sub, max_iterations=60, scale=True, reflection=False)
f.apply_transform(M)
print('ICP: średni błąd dopasowania [cm]:', round(cost * 100, 2))

# ---------- osobne dopasowanie każdej ręki (inne ustawienie ramion niż w modelu męskim)
f_before_arms = f.vertices.copy()
ARM = {'delt_front', 'delt_side', 'delt_rear', 'biceps', 'brachialis', 'triceps_long', 'triceps_short', 'brachioradialis', 'forearm_flex', 'forearm_ext'}
arm_moved = np.zeros(len(f.vertices), bool)
for side, sgn in (('r', -1), ('l', 1)):
    male_arm = pts[np.isin(lab_idx, [labels.index(f'{m}|{side}') for m in ARM if f'{m}|{side}' in labels])]
    # ręka kobieca: punkty po tej stronie, poza tułowiem (|x| większe niż szerokość klatki na danej wysokości), od łokcia w górę do barku
    v = f.vertices
    sel = (np.sign(v[:, 0]) == sgn) & (np.abs(v[:, 0]) > 0.135) & (v[:, 1] > 0.80) & (v[:, 1] < 1.45)
    if sel.sum() < 500: continue
    src = v[sel][rng.choice(sel.sum(), min(15000, sel.sum()), replace=False)]
    Ma, _, ca = trimesh.registration.icp(src, male_arm[rng.choice(len(male_arm), min(60000, len(male_arm)), replace=False)], max_iterations=50, scale=False, reflection=False)
    # płynne przejście przy barku: pełne przesunięcie od |x|>0.17, zero przy |x|=0.12
    wgt = np.clip((np.abs(v[:, 0]) - 0.12) / 0.05, 0, 1) * ((v[:, 1] > 0.75) & (v[:, 1] < 1.5)) * (np.sign(v[:, 0]) == sgn)
    moved = trimesh.transform_points(v, Ma)
    f.vertices = v + (moved - v) * wgt[:, None]
    arm_moved |= wgt > 0
    print(f'ręka {side}: przesunięcie środka [cm]', round(float(np.linalg.norm(Ma[:3, 3])) * 100, 1), 'błąd', round(ca * 100, 2))

# ---------- dopasowanie nieliniowe (Amberg i in. 2007, „optimal step NICP”) na uproszczonej kopii
proxy_path = sys.argv[5] if len(sys.argv) > 5 else None
if proxy_path:
    px = load_female(proxy_path)
    px.merge_vertices()
    px.update_faces(px.nondegenerate_faces()); px.remove_unreferenced_vertices()
    # tylko większe kawałki – drobne, oderwane elementy nie mają punktów odniesienia i psują układ równań
    px = trimesh.util.concatenate([c for c in px.split(only_watertight=False) if len(c.faces) >= 60])
    px.apply_transform(T0); px.apply_translation(t); px.apply_transform(M)
    # ten sam ruch rąk co w pełnym modelu (przez najbliższe punkty modelu przed ruchem)
    _dd, _nn = cKDTree(f_before_arms).query(px.vertices)
    px.vertices = px.vertices + (f.vertices[_nn] - f_before_arms[_nn])
    target = trimesh.util.concatenate([m for n, m in male])
    steps = [[0.02, 3, 0.5, 10], [0.007, 3, 0.5, 10], [0.002, 3, 0.5, 10], [0.0008, 1, 0.5, 10]]
    deformed = trimesh.registration.nricp_amberg(px, target, steps=steps, distance_threshold=0.25)
    disp = deformed - px.vertices
    print('NICP: średnie przesunięcie [cm]:', round(float(np.linalg.norm(disp, axis=1).mean()) * 100, 2),
          'maks.:', round(float(np.linalg.norm(disp, axis=1).max()) * 100, 1))
    ptree = cKDTree(px.vertices)
    d, nb = ptree.query(f.vertices, k=6)
    w = 1.0 / np.maximum(d, 1e-6) ** 2; w /= w.sum(axis=1, keepdims=True)
    f_rigid_vertices = f.vertices.copy()
    f.vertices = f.vertices + (disp[nb] * w[..., None]).sum(axis=1)

# ---------- etykiety trójkątów
cent = f.triangles_center
BONE, CTX = labels.index('bone'), labels.index('context')
DEEP = {i for i, l in enumerate(labels) if l.split('|')[0] in ('transversus', 'pec_minor', 'quadratus_lumb', 'hip_rotators', 'rhomboids')}
is_m = (lab_idx != BONE) & (lab_idx != CTX) & ~np.isin(lab_idx, list(DEEP))
tm, tb, tc = cKDTree(pts[is_m]), cKDTree(pts[lab_idx == BONE]), cKDTree(pts[lab_idx == CTX])
dm, nm = tm.query(cent, k=5)
db_, _ = tb.query(cent); dc, _ = tc.query(cent)
mlab = lab_idx[is_m][nm]
fwd_lab = np.array([collections.Counter(row).most_common(1)[0][0] for row in mlab])
# głosowanie odwrotne: każdy punkt modelu męskiego wskazuje najbliższy trójkąt kobiecej skorupy.
# Mięśnie powierzchowne są bliżej skorupy niż leżące pod nimi, więc to one „zajmują” powierzchnię.
ftree = cKDTree(cent)
votes = np.zeros((len(cent), len(labels)), dtype=np.float32)
for chunk in np.array_split(np.arange(len(pts)), 30):
    dd, fi = ftree.query(pts[chunk])
    ok = dd < 0.03
    # bliższe punkty ważą więcej: powierzchowny mięsień leżący tuż pod skorupą wygrywa z głębszym
    np.add.at(votes, (fi[ok], lab_idx[chunk][ok]), (1.0 / (dd[ok] + 0.003) ** 2).astype(np.float32))
for i in DEEP: votes[:, i] = 0
votes[:, BONE] *= 0.15  # kości modelu męskiego leżą płytko, ale w modelu kobiecym prawie nie są widoczne
has = votes.sum(axis=1) > 0
face_lab = np.where(has, votes.argmax(axis=1), fwd_lab)
print('trójkąty z głosami odwrotnymi:', round(float(has.mean()) * 100, 1), '%')
# kość wygrywa tylko gdy jest bliżej o ponad 1,2 cm, mięśnie „tła” (twarz, dłonie, stopy) – o ponad 0,6 cm
face_lab = np.where(~has & (db_ < dm[:, 0] - 0.012), BONE, face_lab)
face_lab = np.where(~has & (dc < dm[:, 0] - 0.006) & (face_lab != BONE), CTX, face_lab)
area = f.area_faces

# ---------- decyzja na poziomie wyrzeźbionych kawałków
# Autor rzeźbił większość mięśni osobno – taki kawałek dostaje jedną etykietę w całości.
# Kilka dużych kawałków (całe plecy, tułów) obejmuje wiele mięśni – te dzielimy po trójkątach i mocno wygładzamy.
comp = trimesh.graph.connected_component_labels(f.face_adjacency, node_count=len(f.faces))
total_area = area.sum()
final = face_lab.copy()
big_pieces = []
whole, mixed = 0, 0
# Model kobiecy jest symetryczny: kawałek i jego lustrzane odbicie (środek < 1,5 cm, liczba trójkątów ±15%)
# głosują razem – etykiety drugiej strony zamienione l↔r. Dwa razy więcej danych i ta sama decyzja po obu stronach.
SW = np.array([labels.index(l[:-1] + {'l': 'r', 'r': 'l'}[l[-1]]) if l[-2:] in ('|l', '|r') and (l[:-1] + {'l': 'r', 'r': 'l'}[l[-1]]) in labels else i
               for i, l in enumerate(labels)])
piece_ids = {c: np.where(comp == c)[0] for c in np.unique(comp)}
pc = {c: cent[idx].mean(axis=0) for c, idx in piece_ids.items()}
def mirror_of(c):
    t = pc[c] * np.array([-1, 1, 1]); n = len(piece_ids[c])
    cand = [(np.linalg.norm(pc[q] - t), q) for q in piece_ids if abs(len(piece_ids[q]) - n) <= 0.15 * n and q != c]
    if not cand: return None
    d_, q = min(cand)
    return q if d_ < 0.015 else None
paired = 0
for c, idx in piece_ids.items():
    if area[idx].sum() / total_area > BIG_FRACTION:
        big_pieces.append(idx); mixed += 1; continue
    q = mirror_of(c) if abs(pc[c][0]) > 0.01 else None
    if q is not None and area[piece_ids[q]].sum() / total_area <= BIG_FRACTION:
        qi = piece_ids[q]; paired += 1
        fl = np.concatenate([face_lab[idx], SW[face_lab[qi]]]); ar = np.concatenate([area[idx], area[qi]])
        hv = np.concatenate([has[idx], has[qi]]); vt = np.vstack([votes[idx], votes[qi][:, SW]])
    else:
        fl, ar, hv, vt = face_lab[idx], area[idx], has[idx], votes[idx]
    w = collections.Counter()
    for l_, a_ in zip(fl, ar): w[l_] += a_
    maj = w.most_common(1)[0][0]
    pa = ar.sum()
    voted = ar[hv].sum() / pa
    maj_rev = ar[hv & (vt.argmax(axis=1) == maj)].sum() / pa
    # zwycięzca większości bez własnych głosów odwrotnych (tylko z sąsiedztwa) → decyduje suma wag głosów
    final[idx] = vt.sum(axis=0).argmax() if (voted >= 0.10 and maj_rev < 0.05) else maj; whole += 1
print('kawałki sparowane lustrzanie:', paired)
# ---------- reguły anatomiczne dla mięśni powierzchownych, które przegrywają z leżącymi pod nimi
L = {l: i for i, l in enumerate(labels)}
fn = f.face_normals
for side in 'lr':
    # naramienny: kawałek z największą liczbą głosów naramiennego (dowolny akton)
    dl = [L[f'{m}|{side}'] for m in ('delt_front', 'delt_side', 'delt_rear') if f'{m}|{side}' in L]
    best = max(piece_ids, key=lambda c: votes[piece_ids[c]][:, dl].sum())
    idx = piece_ids[best]
    if votes[idx][:, dl].sum() > 0:
        # podział na aktony według kierunku powierzchni: przód (+z), tył (−z), bok (na zewnątrz i w górę)
        z, xo = fn[idx, 2], np.abs(fn[idx, 0])
        final[idx] = np.where((z > 0.5) & (z > xo), L[f'delt_front|{side}'],
                     np.where((z < -0.5) & (-z > xo), L[f'delt_rear|{side}'], L[f'delt_side|{side}']))
        print(f'naramienny {side}: kawałek {best}, trójkątów {len(idx)}')
    # biceps leży na mięśniu ramiennym: przy zbliżonej liczbie głosów wygrywa biceps
    B, R = L.get(f'biceps|{side}'), L.get(f'brachialis|{side}')
    for c, idx in piece_ids.items():
        vb, vr = votes[idx, B].sum(), votes[idx, R].sum()
        if final[idx[0]] == R and vb >= 0.7 * vr and len(idx) > 300:
            final[idx] = B

# wygładzanie tylko w dużych kawałkach: głosowanie sąsiadów ważone polem trójkąta
adj = collections.defaultdict(list)
for a, b in f.face_adjacency: adj[a].append(b); adj[b].append(a)
in_big = np.zeros(len(final), bool)
for idx in big_pieces: in_big[idx] = True
big_idx = np.where(in_big)[0]
for _ in range(SMOOTH_ROUNDS):
    nxt = final.copy()
    for i in big_idx:
        cnt = collections.Counter(); cnt[final[i]] += area[i]
        for j in adj[i]: cnt[final[j]] += area[j]
        nxt[i] = cnt.most_common(1)[0][0]
    final = nxt
# usunięcie drobnych wysepek w dużych kawałkach: spójne obszary jednej etykiety poniżej 0,3% kawałka → etykieta sąsiadów
for idx in big_pieces:
    sub_set = set(idx.tolist()); piece_area = area[idx].sum()
    seen = set()
    for i in idx:
        if i in seen: continue
        lab_i = final[i]; stack = [i]; region = []
        seen.add(i)
        while stack:
            k = stack.pop(); region.append(k)
            for j in adj[k]:
                if j in sub_set and j not in seen and final[j] == lab_i: seen.add(j); stack.append(j)
        if area[region].sum() < 0.003 * piece_area:
            border = collections.Counter(final[j] for k in region for j in adj[k] if j in sub_set and final[j] != lab_i)
            if border: final[region] = border.most_common(1)[0][0]
# piersiowy większy: autor wyrzeźbił trzy osobne części (obojczykowa, mostkowo-żebrowa, brzuszna).
# Kawałki, w których rodzina „chest” ma najwięcej głosów (odwrotne + w przód), dostają część wg wysokości.
CH = ('chest_clav', 'chest_stern', 'chest_abd')
rayi = trimesh.ray.ray_triangle.RayMeshIntersector(f)
for side in 'lr':
    cands = []
    for c, idx in piece_ids.items():
        if len(idx) < 100 or area[idx].sum() / total_area > BIG_FRACTION: continue
        fam = collections.Counter()
        for arr in (np.where(has[idx], votes[idx].argmax(axis=1), -1), fwd_lab[idx]):
            for l, a_ in zip(arr, area[idx]):
                if l < 0 or l in (BONE, CTX): continue
                nm_ = labels[l]
                fam['chest' if nm_.split('|')[0] in CH else nm_] += a_
        if fam and fam.most_common(1)[0][0] == 'chest' and (cent[idx, 0].mean() > 0) == (side == 'l'):
            # tylko kawałki widoczne z przodu (głębokie warstwy pod spodem pomijamy)
            sub = idx[::max(1, len(idx) // 150)]
            hit = rayi.intersects_any(cent[sub] + fn[sub] * 1e-4 + np.array([0, 0, 2e-4]), np.tile([0, 0, 1.0], (len(sub), 1)))
            if (~hit).mean() > 0.2:
                cands.append((cent[idx, 1].mean(), c))
    cands.sort(reverse=True)
    print(f'piersiowy {side}: kawałki', [(c, round(y, 3), len(piece_ids[c])) for y, c in cands])
    if len(cands) == 3 and side == 'l':
        for (y, c), part in zip(cands, CH): final[piece_ids[c]] = L[f'{part}|{side}']
    if side == 'l': chest_left = [c for _, c in cands]

if len(chest_left) == 3:
    for c, part in zip(chest_left, CH):
        q = mirror_of(c)
        print('piersiowy lustro', c, '->', q)
        if q is not None: final[piece_ids[q]] = L[f'{part}|r']
# pozostałe kawałki prawej strony z etykietą „chest”, których lustro po lewej nie jest piersiowym → lustro lewej
for c, idx in piece_ids.items():
    lab_c = labels[final[idx[0]]]
    if lab_c.split('|')[0] in CH and pc[c][0] < 0:
        q = mirror_of(c)
        if q is not None and labels[final[piece_ids[q][0]]].split('|')[0] not in CH:
            ml = labels[final[piece_ids[q][0]]]
            final[idx] = L[ml.split('|')[0] + '|r'] if ml.endswith('|l') else final[piece_ids[q][0]]
            print('prawa klatka: kawałek', c, lab_c, '->', labels[final[idx[0]]])

# zębaty przedni widoczny od tyłu (okolica łopatki) → najbliższy z: obły większy, stożek rotatorów, zębaty (wg punktów męskich)
alt = [l for l in labels if l.split('|')[0] in ('teres_major', 'rotator_cuff', 'serratus')]
alt_m = np.isin(lab_idx, [L[l] for l in alt]); alt_tree = cKDTree(pts[alt_m]); alt_lab = lab_idx[alt_m]
for c, idx in piece_ids.items():
    if labels[final[idx[0]]].split('|')[0] != 'serratus' or area[idx].sum() / total_area > BIG_FRACTION: continue
    sub = idx[::max(1, len(idx) // 150)]
    hit = rayi.intersects_any(cent[sub] - fn[sub] * 0 - np.array([0, 0, 2e-4]), np.tile([0, 0, -1.0], (len(sub), 1)))
    if (~hit).mean() > 0.2:
        new_l = L[f"teres_major|{'l' if pc[c][0] > 0 else 'r'}"]
        print('zębaty widoczny z tyłu: kawałek', c, '->', labels[new_l]); final[idx] = new_l


# czworoboczny: część wg wysokości (granice w połowie między medianami części w modelu męskim); strona wg x
TRL = [f'{p_}|{sd}' for p_ in ('traps_upper', 'traps_mid', 'traps_lower') for sd in 'lr' if f'{p_}|{sd}' in L]
TR = [L[l] for l in TRL]
ty = {p_: np.median(pts[np.isin(lab_idx, [L[f'{p_}|{sd}'] for sd in 'lr']), 1]) for p_ in ('traps_upper', 'traps_mid', 'traps_lower')}
cut_um, cut_ml = (ty['traps_upper'] + ty['traps_mid']) / 2, (ty['traps_mid'] + ty['traps_lower']) / 2
print('czworoboczny: granice', round(cut_um, 3), round(cut_ml, 3))
for i in np.where(np.isin(final, TR))[0]:
    sd = 'l' if cent[i, 0] > 0 else 'r'; yy = cent[i, 1]
    final[i] = L[f"{'traps_upper' if yy > cut_um else 'traps_mid' if yy > cut_ml else 'traps_lower'}|{sd}"]
# najszerszy grzbietu: w kawałku z największym polem „lats” wszystko poza czworobocznym, skośnymi i dolnym odcinkiem prostownika → lats
ERECT_Y = np.percentile(pts[np.isin(lab_idx, [L['lats|l'], L['lats|r']]), 1], 8)
lp = max(big_pieces, key=lambda idx: area[idx][np.isin(final[idx], [L['lats|l'], L['lats|r']])].sum())
keep = np.isin(final[lp], TR + [L['obliques|l'], L['obliques|r']]) | (np.isin(final[lp], [L['erectors|l'], L['erectors|r']]) & (cent[lp, 1] < ERECT_Y))
ch = lp[~keep]
final[ch] = np.where(cent[ch, 0] > 0, L['lats|l'], L['lats|r'])
print('najszerszy: przejęto', len(ch), 'trójkątów')
# płaszczkowaty: w modelu kobiecym łydka to jeden kawałek „brzuchaty”; poniżej dolnego końca brzuchatego
# w modelu męskim (8. percentyl wysokości) jest płaszczkowaty
for sd in 'lr':
    G, S_ = L[f'gastrocnemius|{sd}'], L[f'soleus|{sd}']
    gy = np.percentile(pts[lab_idx == G, 1], 8)
    m_ = (final == G) & (cent[:, 1] < gy)
    final[m_] = S_
    print(f'płaszczkowaty {sd}: poniżej {gy:.3f} m, trójkątów {int(m_.sum())}')
# dłonie: wszystko z etykietą przedramienia dalej niż koniec ramienno-promieniowego (nadgarstek) → tło
FA = [L[f'{m}|{sd}'] for m in ('forearm_flex', 'forearm_ext', 'brachioradialis') for sd in 'lr']
wrist = np.percentile(pts[np.isin(lab_idx, [L['brachioradialis|l'], L['brachioradialis|r']]), 1], 0.5) - 0.01
m_ = np.isin(final, FA) & (cent[:, 1] < wrist)
final[m_] = CTX
print(f'dłonie (y < {wrist:.3f} m) → tło:', int(m_.sum()))
# kawałki z mięśniem leżące poza zasięgiem tego mięśnia w modelu męskim (np. palce oznaczone jako prostowniki) → tło
yr = {}
for li in set(final.tolist()):
    if li in (BONE, CTX): continue
    ys = pts[lab_idx == li, 1]
    if len(ys): yr[li] = (np.percentile(ys, 1) - 0.03, np.percentile(ys, 99) + 0.03)
outside = 0
for c, idx in piece_ids.items():
    li = final[idx[0]]
    if li in yr and (final[idx] == li).all() and not (yr[li][0] <= pc[c][1] <= yr[li][1]):
        final[idx] = CTX; outside += len(idx)
print('poza zasięgiem mięśnia → tło:', outside, 'trójkątów')
print('czworoboczny:', {l: int((final == L[l]).sum()) for l in TRL})
final = np.where(final == BONE, CTX, final)
print('kawałki w całości:', whole, 'mieszane:', mixed)

# ---------- eksport (kształt kobiecy po dopasowaniu sztywnym – bez nieliniowego „naginania”)
np.savez_compressed(out_path + '.debug.npz', verts=f.vertices, faces=f.faces, final=final, labels=np.array(labels), fwd=fwd_lab, rev=np.where(has, votes.argmax(axis=1), -1), comp=comp, area=area)
if proxy_path: f.vertices = f_rigid_vertices
scene = trimesh.Scene()
summary = {}
for li, lab in enumerate(labels):
    idx = np.where(final == li)[0]
    if not len(idx): continue
    sub_m = f.submesh([idx], append=True); sub_m.visual = trimesh.visual.ColorVisuals(); sub_m.fix_normals(); _ = sub_m.vertex_normals
    if lab in ('bone', 'context'):
        name, extras = ('skeleton', {'kind': 'bone'}) if lab == 'bone' else ('context_muscles', {'kind': 'context'})
    else:
        mid, side = lab.split('|'); name, extras = f'M_{mid}_{side}', {'kind': 'muscle', 'muscleId': mid, 'side': side}
    scene.add_geometry(sub_m, node_name=name, geom_name=name, metadata={'extras': extras})
    summary[name] = int(len(idx))
scene.export(out_path, file_type='glb', include_normals=True)
from glbextras import fix; fix(out_path)
json.dump({'scale': s, 'icp_cm': cost * 100, 'whole': whole, 'mixed': mixed, 'faces': summary,
           'missing': sorted({l for l in labels if l not in ('bone', 'context')} - {k[2:].rsplit('_', 1)[0] + '|' + k.rsplit('_', 1)[1] for k in summary if k.startswith('M_')})},
          open(report_path, 'w'), indent=1)
print('zapisano', out_path)
