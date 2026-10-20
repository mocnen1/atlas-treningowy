"""Poprawki modelu męskiego (body.glb z Z-Anatomy):
1. Nazwy części czworobocznego w Z-Anatomy są odwrócone względem położenia: siatka „Descending part” leży nisko
   (środek pleców), „Ascending part” – wysoko (szyja). Zamieniamy traps_upper <-> traps_lower według położenia.
2. Rozcięgno skośnego zewnętrznego przykrywa z przodu prosty brzucha, więc „skośne” podświetlały cały brzuch.
   Trójkąty skośnych leżące tuż przed prostym brzucha (< 1,8 cm) przenosimy do prostego brzucha.
Użycie: python3 -I fix_male.py wejście.glb wyjście.glb
"""
import sys, re, numpy as np, trimesh
from scipy.spatial import cKDTree
sys.path.insert(0, '/home/claude/scripts/female')
from load import load_male
from glbextras import fix

src, dst = sys.argv[1:3]
parts = dict(load_male(src))
order = list(parts)

# 1. czworoboczny – zamiana tylko, jeśli „górna” rzeczywiście leży niżej niż „dolna”
for sd in 'lr':
    up, lo = f'M_traps_upper_{sd}', f'M_traps_lower_{sd}'
    if np.median(parts[up].vertices[:, 1]) < np.median(parts[lo].vertices[:, 1]):
        parts[up], parts[lo] = parts[lo], parts[up]
        print('czworoboczny', sd, ': zamieniono górną i dolną część')

# 2. skośne nad prostym brzucha
for sd in 'lr':
    A, O = f'M_abs_{sd}', f'M_obliques_{sd}'
    a, o = parts[A], parts[O]
    ap, _ = trimesh.sample.sample_surface(a, 200000, seed=1)
    c = o.triangles_center
    d, j = cKDTree(ap).query(c)
    over = (d < 0.018) & (c[:, 2] > ap[j, 2] - 0.002)
    moved = o.submesh([np.where(over)[0]], append=True)
    parts[O] = o.submesh([np.where(~over)[0]], append=True)
    parts[A] = trimesh.util.concatenate([a, moved])
    print(f'skośne→prosty brzucha {sd}: {int(over.sum())} z {len(o.faces)} trójkątów')

sc = trimesh.Scene()
for n in order:
    m = parts[n]; m.visual = trimesh.visual.ColorVisuals(); _ = m.vertex_normals
    sc.add_geometry(m, node_name=n, geom_name=n)
sc.export(dst, file_type='glb', include_normals=True)
fix(dst)
print('zapisano', dst)
