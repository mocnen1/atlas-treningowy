"""Wczytanie modelu męskiego (z etykietami mięśni) i kobiecego do wspólnego układu: Y w górę, metry, stopy na y=0."""
import numpy as np, trimesh

def load_male(path):
    sc = trimesh.load(path, force='scene')
    parts = []
    for name in sc.graph.nodes_geometry:
        T, gname = sc.graph[name]
        m = sc.geometry[gname].copy(); m.apply_transform(T)
        ex = sc.graph.transforms.node_data[name].get('metadata', {}) if hasattr(sc.graph.transforms, 'node_data') else {}
        parts.append((name, m))
    return parts

def load_female(path):
    sc = trimesh.load(path, force='scene')
    meshes = []
    for name in sc.graph.nodes_geometry:
        T, gname = sc.graph[name]
        m = sc.geometry[gname].copy(); m.apply_transform(T); meshes.append(m)
    return trimesh.util.concatenate(meshes)
