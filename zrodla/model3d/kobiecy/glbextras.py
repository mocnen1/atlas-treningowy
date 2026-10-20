"""Dopisuje do węzłów pliku .glb opis rodzaju (extras) na podstawie nazwy węzła: M_<id>_<strona>, context_muscles, skeleton."""
import json, re, struct, sys

def fix(path):
    b = open(path, 'rb').read()
    magic, ver, _ = struct.unpack_from('<III', b, 0)
    jl, jt = struct.unpack_from('<II', b, 12)
    js = json.loads(b[20:20 + jl])
    rest = b[20 + jl:]
    for n in js.get('nodes', []):
        name = n.get('name', '')
        m = re.match(r'^M_(.+)_(l|r|c)$', name)
        if m: n['extras'] = {'kind': 'muscle', 'muscleId': m.group(1), 'side': m.group(2)}
        elif name == 'skeleton': n['extras'] = {'kind': 'bone'}
        elif name == 'context_muscles': n['extras'] = {'kind': 'context'}
    j = json.dumps(js, separators=(',', ':')).encode()
    j += b' ' * ((4 - len(j) % 4) % 4)
    out = struct.pack('<III', magic, ver, 12 + 8 + len(j) + len(rest)) + struct.pack('<II', len(j), jt) + j + rest
    open(path, 'wb').write(out)

if __name__ == '__main__':
    fix(sys.argv[1])
