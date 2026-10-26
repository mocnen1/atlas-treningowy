# Atlas Treningowy – kod źródłowy

Dziennik treningowy z modelem 3D mięśni: aplikacja na Windows (Electron) i aplikacja na iPhone'a (PWA, ten sam kod React).
Wersja 0.9.0.

## Struktura

| Folder | Zawartość |
|---|---|
| `app/src/` | Interfejs aplikacji na Windows (React + TypeScript), model 3D (Three.js), obliczenia obciążenia |
| `app/src/phone/` | Aplikacja na telefon (PWA) |
| `app/src/shared/` | Przesyłanie kodami QR (format, kompresja, skaner) – wspólne dla obu aplikacji |
| `app/src/data/` | Katalog: 43 mięśnie modelu, 908 ćwiczeń z wagami zaangażowania, modele 3D (`assets/body.glb` – męski, `assets/body_f.glb` – damski) |
| `app/electron/` | Proces główny Electron: okno, zapis danych na dysk, kopie zapasowe, kamera |
| `app/tests/` | Testy obliczeń i protokołu QR (`npm test`) |
| `dane/` | Baza ćwiczeń + skrypty, które ją budują (reguły wag, ręczne poprawki, polskie nazwy) |
| `model3d/` | Skrypty Blendera: eksport mięśni z Z-Anatomy do `body.glb`; `model3d/kobiecy/` – poprawki modelu męskiego i przeniesienie podziału na mięśnie na model damski |
| `e2e/` | Testy całej ścieżki: telefon → kody QR → nagranie „kamerki” → aplikacja na Windows i odwrotnie |

## Budowanie

Wymagane: Node.js 22.

```bash
cd app
npm ci                      # zależności
npm test                    # testy (powinno być 33/33)
npm run build               # aplikacja na Windows → app/dist/index.html
npm run build:phone         # aplikacja na telefon → app/dist-phone/ (zawartość wgrywana do katalogu głównego repozytorium)

# paczka dla Windows (działa też na Linuksie)
npx electron-packager . "Atlas Treningowy" --platform=win32 --arch=x64 --electron-version=33.2.1 \
  --out=../release --overwrite --asar --prune=true \
  --ignore='^/src($|/)' --ignore='^/tests($|/)' --ignore='^/node_modules($|/)' --ignore='^/index\.html$' \
  --ignore='^/vite\..*\.ts$' --ignore='^/tsconfig\.json$' --ignore='^/phone($|/)' --ignore='^/dist-phone($|/)' --ignore='^/scripts($|/)' --ignore='^/public-pc($|/)'
```

Podgląd w przeglądarce podczas pracy: `npm run dev` (Windows) i `npm run dev:phone` (telefon).

## Trener

`app/src/shared/trainer.ts` – podpowiedź ciężaru i powtórzeń liczona osobno dla każdego planu (kontekstu): to samo ćwiczenie
w innym planie robione jest przy innym zmęczeniu. Kontekst = plan, z którego zaczęto trening; dla treningu bez planu – plan o tej samej
nazwie albo sama nazwa. Poziomy: „z tego planu” (≥ 3 ocenione treningi), „wstępnie” (1–2 z tego planu), „szacunek z innego planu”
(przeliczony stosunkiem szacowanego 1RM między planami, ograniczonym do 0,75–1,15). Reguły wg zapasu powtórzeń (RPE) i zakresu
powtórzeń z planu (podwójna progresja); przy spadku formy na dwóch treningach z rzędu bez podnoszenia ciężaru.
Historia serii idzie z komputera na telefon razem z planami (`lib/pcBundle.ts`, format zwarty w `shared/transfer.ts`).

## Baza ćwiczeń

`dane/build/build_exercises.py <exercises.json z free-exercise-db>` składa `dane/exercises.json`:
- `rules.py` – automatyczny podział grubych grup (np. „shoulders”) na mięśnie modelu wg słów w nazwie,
- `curated.py` – ręczne wagi dla ok. 200 najpopularniejszych ćwiczeń + 33 ćwiczenia spoza bazy,
- `pl_names_*.txt` – polskie nazwy.

Po przebudowaniu skopiuj `dane/exercises.json` do `app/src/data/` i uruchom `node scripts/phone-catalog.mjs` w `app/`.

## Zdjęcia ćwiczeń

`dane/build/make_images.py <free-exercise-db/exercises> dane/exercises.json <wyjście>` tworzy `img/<id>/0.webp`, `1.webp` (pozycja początkowa i końcowa) i `t.webp` (miniatura) oraz `lista.json`.
Wynik: kopia w katalogu głównym repozytorium (`img/` – dla telefonu, przez GitHub Pages) i w `app/public-pc/img/` (wbudowane w aplikację na Windows; folder nie jest trzymany w `zrodla/`, żeby nie dublować 22 MB). `lista.json` → `app/src/data/img-list.json`.

## Model 3D

`model3d/export_model.py` (Python z modułem `bpy` 4.2) wczytuje `Startup.blend` z Z-Anatomy, wybiera mięśnie wg `dane/muscles.json`,
upraszcza siatki i eksportuje `.glb`. Potem kompresja: `npx gltfpack -i body.glb -o body_c.glb -cc -kn -km -ke -vp 14`.

### Poprawki modelu męskiego

`model3d/kobiecy/fix_male.py wejście.glb wyjście.glb` (trimesh): zamienia nazwy górnej i dolnej części czworobocznego
(w Z-Anatomy siatka „Descending part” leży nisko, „Ascending part” – przy szyi) oraz przenosi do prostego brzucha
trójkąty rozcięgna skośnych, które w Z-Anatomy przykrywają go z przodu.

### Model damski

Źródło: „Female Body Muscular System – Anatomy Study” (Ruslan Gadzhiev, Sketchfab, CC BY 4.0) – jedna rzeźba
podzielona na ok. 450 kawałków bez nazw mięśni. Podział na 43 mięśnie aplikacji jest przenoszony z modelu męskiego:

1. `decimate.py` (Blender) – uproszczona kopia (~12 tys. trójkątów) do dopasowania nieliniowego.
2. `transfer.py męski.glb scene.gltf body_f.glb raport.json proxy.glb`:
   dopasowanie sztywne (ICP ze skalą), osobno ramiona, nieliniowe (NICP, trimesh) na kopii uproszczonej;
   „głosowanie odwrotne” – punkty mięśni modelu męskiego wskazują najbliższy trójkąt modelu damskiego
   (bliżej = większa waga, więc wygrywają mięśnie powierzchowne); decyzja dla całych kawałków, z lustrzanym
   kawałkiem drugiej strony; reguły anatomiczne (naramienny wg kierunku powierzchni, trzy części piersiowego
   i czworobocznego, najszerszy grzbietu, płaszczkowaty, dłonie jako tło).
3. Kompresja jak dla modelu męskiego (`gltfpack … -cc -kn -km -ke -vp 14`).

Wynik jest przybliżony: zębaty przedni nie jest widoczny osobno, piersi należą do części brzusznej piersiowego,
mięśnie głębokie (np. poprzeczny brzucha, równoległoboczne) nie mają odpowiednika.

## Licencje

- Model 3D męski: Z-Anatomy – The libre 3D atlas of anatomy (CC BY-SA 4.0), na bazie BodyParts3D, The Database Center for Life Science (CC BY-SA 2.1 Japan). Plik `body.glb` jako dzieło pochodne również na CC BY-SA 4.0.
- Model 3D damski: This work is based on "Female Body Muscular System - Anatomy Study" (https://sketchfab.com/3d-models/female-body-muscular-system-anatomy-study-9a596b6c24b344bfbe6bb5246290df0e) by Ruslan Gadzhiev (https://sketchfab.com/ruslangadzhiev) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/). Zmiany: podział na mięśnie, kwantyzacja i kompresja. Plik `body_f.glb`.
- Baza ćwiczeń: free-exercise-db (Unlicense).
- Dekoder QR: zxing-wasm (MIT) / zxing-cpp (Apache 2.0). Electron, React, Three.js: MIT.
