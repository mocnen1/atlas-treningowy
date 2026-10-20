"""Eksport mięśni + szkieletu z Z-Anatomy do lekkiego pliku .glb dla przeglądarki.
Użycie: python -I export_model.py <Startup.blend> <muscles.json> <out.glb>
"""
import bpy, bmesh, sys, json, re
from mathutils import Vector

blend, muscles_json, out = sys.argv[-3:]
cfg = json.load(open(muscles_json, encoding="utf-8"))
base2id = {}
for m in cfg["muscles"]:
    for mesh in m["meshes"]:
        base2id[mesh] = m["id"]

# Siatki pomijane w całości (wewnętrzne, niewidoczne, zasłaniające)
EXCLUDE_PATTERNS = [
    r"rectus muscle$", r"oblique muscle$", r"tarsus", r"Levator palpebrae", r"Common tendinous ring", r"Trochlea",
    r"arytenoid", r"cricothyroid", r"pharyngeal", r"Stylopharyngeus", r"Palatopharyngeus", r"glossus",
    r"intercostal", r"Innermost", r"Diaphragm", r"Transversus thoracis", r"Levatores", r"Serratus posterior",
    r"Iliotibial tract", r"retinacul", r"aponeurosis", r"Platysma", r"ligament", r"Coccygeus", r"coccygeus",
    r"Pubo-analis", r"anal sphincter", r"Tendinous arch", r"Linea alba", r"Intertransversarii", r"intertransversarii",
    r"Interspinales colli", r"Semispinalis capitis", r"capitis muscle$" ,
]
KEEP_CAPITIS = {"Splenius capitis muscle", "Longissimus capitis muscle", "Spinalis capitis muscle"}

def base_side(name):
    m = re.match(r"^(.*)\.(l|r)$", name)
    return (m.group(1), m.group(2)) if m else (name, "c")

def excluded(base):
    if base in base2id or base in KEEP_CAPITIS:
        return False
    return any(re.search(p, base) for p in EXCLUDE_PATTERNS)

bpy.ops.wm.read_factory_settings(use_empty=True)
with bpy.data.libraries.load(blend, link=False) as (df, dt):
    dt.collections = ["Muscles", "Skeletal system"]
scene = bpy.context.scene
for c in list(bpy.data.collections):
    if c.name in ("Muscles", "Skeletal system"):
        try:
            scene.collection.children.link(c)
        except RuntimeError:
            pass

skel_objs = set(bpy.data.collections["Skeletal system"].all_objects)
mus_objs = set(bpy.data.collections["Muscles"].all_objects)
deps = bpy.context.evaluated_depsgraph_get()

def realize(o):
    """Zastosuj modyfikatory i transformację -> nowy samodzielny obiekt-siatka."""
    ev = o.evaluated_get(deps)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=False, depsgraph=deps)
    me.transform(o.matrix_world)
    for a in list(me.attributes):
        if not a.is_internal and a.name not in ("position",) and not a.name.startswith("."):
            try:
                me.attributes.remove(a)
            except Exception:
                pass
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    me.materials.clear()
    n = bpy.data.objects.new(o.name + "_R", me)
    scene.collection.objects.link(n)
    return n

def tri_count(me):
    return sum(len(p.vertices) - 2 for p in me.polygons)

def decimate(o, ratio, min_tris):
    t = tri_count(o.data)
    if t <= min_tris:
        return
    r = max(ratio, min_tris / t)
    if r >= 0.98:
        return
    mod = o.modifiers.new("dec", "DECIMATE")
    mod.ratio = r
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = o
    with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]):
        bpy.ops.object.modifier_apply(modifier="dec")

def join(objs, name):
    if not objs:
        return None
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, selected_objects=objs):
        bpy.ops.object.join()
    j = objs[0]
    j.name = name
    j.data.name = name
    return j

seen_bases = set()
groups = {}      # (id, side) -> [obj]
context = []
skipped = []
unmatched_bases = set()
for o in sorted(mus_objs, key=lambda x: x.name):
    if o.type != "MESH":
        continue
    base, side = base_side(o.name)
    seen_bases.add(base)
    if excluded(base):
        skipped.append(o.name)
        continue
    r = realize(o)
    if base in base2id:
        decimate(r, 0.16, 500)
        groups.setdefault((base2id[base], side), []).append(r)
    else:
        unmatched_bases.add(base)
        decimate(r, 0.10, 150)
        context.append(r)

bones = []
for o in sorted(skel_objs, key=lambda x: x.name):
    if o.type != "MESH":
        continue
    r = realize(o)
    decimate(r, 0.09, 120)
    bones.append(r)

# usuń oryginały
for o in list(mus_objs | skel_objs):
    bpy.data.objects.remove(o, do_unlink=True)
for c in ("Muscles", "Skeletal system"):
    if c in bpy.data.collections:
        bpy.data.collections.remove(bpy.data.collections[c])

result = []
for (mid, side), objs in sorted(groups.items()):
    j = join(objs, f"M_{mid}_{side}")
    j["kind"] = "muscle"; j["muscleId"] = mid; j["side"] = side
    result.append(j)
cj = join(context, "context_muscles"); cj["kind"] = "context"
# kości: odfiltruj obiekty daleko poza sylwetką (np. luźne elementy poza ciałem)
mus_min = Vector((min(v.co[i] for o in result for v in o.data.vertices) for i in range(3)))
mus_max = Vector((max(v.co[i] for o in result for v in o.data.vertices) for i in range(3)))
pad = 0.05
def inside(o):
    cs = sum((v.co for v in o.data.vertices), Vector()) / max(1, len(o.data.vertices))
    return all(mus_min[i] - pad <= cs[i] <= mus_max[i] + pad for i in range(3))
keep_b = [b for b in bones if len(b.data.vertices) and inside(b)]
for b in bones:
    if b not in keep_b:
        bpy.data.objects.remove(b, do_unlink=True)
bj = join(keep_b, "skeleton"); bj["kind"] = "bone"

for o in scene.objects:
    for p in o.data.polygons:
        p.use_smooth = True

stats = {
    "muscle_objects": len(result),
    "muscle_tris": sum(tri_count(o.data) for o in result),
    "context_tris": tri_count(cj.data),
    "bone_tris": tri_count(bj.data),
    "skipped": len(skipped),
    "context_bases": sorted(unmatched_bases),
    "missing_from_model": sorted(set(base2id) - seen_bases),
    "bbox": [list(mus_min), list(mus_max)],
}
print("STATS", json.dumps(stats, ensure_ascii=False))

kw = dict(filepath=out, export_format="GLB", export_extras=True, export_apply=True, export_materials="NONE",
          export_texcoords=False, export_normals=True, export_yup=True)
try:
    bpy.ops.export_scene.gltf(**kw, export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=12, export_draco_normal_quantization=8)
    print("EXPORT draco ok")
except Exception as e:
    print("DRACO FAILED", e)
    bpy.ops.export_scene.gltf(**kw)
    print("EXPORT plain ok")
