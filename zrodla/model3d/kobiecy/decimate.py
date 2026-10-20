# Uproszczona kopia modelu kobiecego (ok. 12 tys. trójkątów) jako szkielet do nieliniowego dopasowania.
import bpy, sys
src, dst = sys.argv[-2:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.join()
o = bpy.context.view_layer.objects.active
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=1e-5)
bpy.ops.object.mode_set(mode='OBJECT')
n = len(o.data.polygons)
mod = o.modifiers.new('d', 'DECIMATE')
mod.ratio = 12000 / n
bpy.ops.object.modifier_apply(modifier='d')
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_materials='NONE', export_apply=True)
print('PROXY', n, '->', len(o.data.polygons))
