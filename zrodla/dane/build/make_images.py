"""Zdjęcia ćwiczeń z free-exercise-db (domena publiczna) → WebP dla aplikacji.
img/<id>/0.webp, 1.webp – pozycja początkowa i końcowa (maks. 480 px); img/<id>/t.webp – miniatura 128 px.
Użycie: python -I make_images.py <free-exercise-db/exercises> <exercises.json> <katalog wyjściowy>
"""
import os, sys, json
from concurrent.futures import ProcessPoolExecutor
from PIL import Image, ImageOps

src, exjson, out = sys.argv[1:4]

def one(i):
    d = os.path.join(out, i); os.makedirs(d, exist_ok=True)
    for k in (0, 1):
        im = ImageOps.exif_transpose(Image.open(f'{src}/{i}/{k}.jpg')).convert('RGB')
        big = im.copy(); big.thumbnail((480, 480), Image.LANCZOS); big.save(f'{d}/{k}.webp', 'WEBP', quality=68, method=6)
        if k == 0:
            # miniatura: kwadratowy kadr ze środka (osoba zwykle stoi pośrodku)
            w, h = im.size; s = min(w, h)
            t = im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s)).resize((128, 128), Image.LANCZOS)
            t.save(f'{d}/t.webp', 'WEBP', quality=62, method=6)
    return i

ids = [e['id'] for e in json.load(open(exjson)) if e['source'] == 'free-exercise-db' and os.path.exists(f'{src}/{e["id"]}/1.jpg')]
with ProcessPoolExecutor() as p:
    done = list(p.map(one, ids, chunksize=20))
json.dump(sorted(done), open(os.path.join(out, 'lista.json'), 'w'))
print('ćwiczeń ze zdjęciami:', len(done))
