# Atlas Treningowy – kod źródłowy

Dziennik treningowy z modelem 3D mięśni: aplikacja na Windows (Electron) i aplikacja na iPhone'a (PWA, ten sam kod React).
Wersja 0.4.0.

## Struktura

| Folder | Zawartość |
|---|---|
| `app/src/` | Interfejs aplikacji na Windows (React + TypeScript), model 3D (Three.js), obliczenia obciążenia |
| `app/src/phone/` | Aplikacja na telefon (PWA) |
| `app/src/shared/` | Przesyłanie kodami QR (format, kompresja, skaner) – wspólne dla obu aplikacji |
| `app/src/data/` | Katalog: 43 mięśnie modelu, 908 ćwiczeń z wagami zaangażowania, model 3D (`assets/body.glb`) |
| `app/electron/` | Proces główny Electron: okno, zapis danych na dysk, kopie zapasowe, kamera |
| `app/tests/` | Testy obliczeń i protokołu QR (`npm test`) |
| `dane/` | Baza ćwiczeń + skrypty, które ją budują (reguły wag, ręczne poprawki, polskie nazwy) |
| `model3d/` | Skrypty Blendera: eksport mięśni z Z-Anatomy do `body.glb` |
| `e2e/` | Testy całej ścieżki: telefon → kody QR → nagranie „kamerki” → aplikacja na Windows i odwrotnie |

## Budowanie

Wymagane: Node.js 22.

```bash
cd app
npm ci                      # zależności
npm test                    # testy (powinno być 16/16)
npm run build               # aplikacja na Windows → app/dist/index.html
npm run build:phone         # aplikacja na telefon → app/dist-phone/ (zawartość wgrywana do katalogu głównego repozytorium)

# paczka dla Windows (działa też na Linuksie)
npx electron-packager . "Atlas Treningowy" --platform=win32 --arch=x64 --electron-version=33.2.1 \
  --out=../release --overwrite --asar --prune=true \
  --ignore='^/src($|/)' --ignore='^/tests($|/)' --ignore='^/node_modules($|/)' --ignore='^/index\.html$' \
  --ignore='^/vite\..*\.ts$' --ignore='^/tsconfig\.json$' --ignore='^/phone($|/)' --ignore='^/dist-phone($|/)' --ignore='^/scripts($|/)'
```

Podgląd w przeglądarce podczas pracy: `npm run dev` (Windows) i `npm run dev:phone` (telefon).

## Baza ćwiczeń

`dane/build/build_exercises.py <exercises.json z free-exercise-db>` składa `dane/exercises.json`:
- `rules.py` – automatyczny podział grubych grup (np. „shoulders”) na mięśnie modelu wg słów w nazwie,
- `curated.py` – ręczne wagi dla ok. 200 najpopularniejszych ćwiczeń + 33 ćwiczenia spoza bazy,
- `pl_names_*.txt` – polskie nazwy.

Po przebudowaniu skopiuj `dane/exercises.json` do `app/src/data/` i uruchom `node scripts/phone-catalog.mjs` w `app/`.

## Model 3D

`model3d/export_model.py` (Python z modułem `bpy` 4.2) wczytuje `Startup.blend` z Z-Anatomy, wybiera mięśnie wg `dane/muscles.json`,
upraszcza siatki i eksportuje `.glb`. Potem kompresja: `npx gltfpack -i body.glb -o body_c.glb -cc -kn -km -ke -vp 14`.

## Licencje

- Model 3D: Z-Anatomy – The libre 3D atlas of anatomy (CC BY-SA 4.0), na bazie BodyParts3D, The Database Center for Life Science (CC BY-SA 2.1 Japan). Plik `body.glb` jako dzieło pochodne również na CC BY-SA 4.0.
- Baza ćwiczeń: free-exercise-db (Unlicense).
- Dekoder QR: zxing-wasm (MIT) / zxing-cpp (Apache 2.0). Electron, React, Three.js: MIT.
