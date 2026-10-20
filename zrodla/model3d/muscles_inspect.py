import bpy, sys
p=sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
with bpy.data.libraries.load(p, link=False) as (df, dt):
    dt.collections=['Muscles']
root=bpy.data.collections['Muscles']
out=[]
def walk(c,d=0):
    m=[o for o in c.objects if o.type=='MESH']
    out.append('  '*d+f"[{c.name}] meshes={len(m)} other={len(c.objects)-len(m)}")
    for o in c.objects:
        if o.type=='MESH':
            out.append('  '*(d+1)+f"- {o.name}  tris={sum(len(pp.vertices)-2 for pp in o.data.polygons)} mods={[x.type for x in o.modifiers]}")
        else: out.append('  '*(d+1)+f"* {o.name} ({o.type})")
    for ch in c.children: walk(ch,d+1)
walk(root)
open('/root/scripts/muscles_tree.txt','w').write('\n'.join(out))
ms=[o for o in bpy.data.objects if o.type=='MESH']
print('mesh objs',len(ms),'tris',sum(sum(len(pp.vertices)-2 for pp in o.data.polygons) for o in ms))
