"""Buduje gymtracker/data/exercises.json z free-exercise-db + reguł + ręcznych poprawek + tłumaczeń.
Użycie: python -I build_exercises.py <exercises.json z free-exercise-db>
"""
import json, sys, glob, os, collections
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from rules import auto_weights
from curated import CURATED, EXTRA

src = json.load(open(sys.argv[1], encoding="utf-8"))
muscles = json.load(open(os.path.join(HERE, "..", "muscles.json"), encoding="utf-8"))["muscles"]
MIDS = {m["id"] for m in muscles}

pl = {}
for f in sorted(glob.glob(os.path.join(HERE, "pl_names_*.txt"))):
    for line in open(f, encoding="utf-8"):
        line = line.rstrip("\n")
        if not line.strip():
            continue
        en, _, plname = line.partition(" = ")
        assert plname, f"Zła linia w {f}: {line!r}"
        pl[en.strip()] = plname.strip()

EQUIP_PL = {"barbell": "sztanga", "dumbbell": "hantle", "other": "inne", "body only": "masa ciała", "cable": "wyciąg",
            "machine": "maszyna", "kettlebells": "kettlebell", "bands": "gumy", "medicine ball": "piłka lekarska",
            "exercise ball": "piłka gimnastyczna", "foam roll": "roller", "e-z curl bar": "sztanga łamana", None: "brak"}
CAT_PL = {"strength": "siłowe", "stretching": "rozciąganie", "plyometrics": "plyometria", "powerlifting": "trójbój",
          "olympic weightlifting": "podnoszenie ciężarów", "strongman": "strongman", "cardio": "cardio"}
LEVEL_PL = {"beginner": "początkujący", "intermediate": "średniozaawansowany", "expert": "zaawansowany"}

out, problems = [], []
src_ids = {e["id"] for e in src}
for cid in CURATED:
    if cid not in src_ids:
        problems.append(f"Ręczna poprawka dla nieistniejącego id: {cid}")

for e in src:
    name_pl = pl.get(e["name"])
    if not name_pl:
        problems.append(f"Brak tłumaczenia: {e['name']}")
        name_pl = e["name"]
    if e["id"] in CURATED:
        w = {k: v for k, v in CURATED[e["id"]].items() if v > 0}
        curated = True
    else:
        w = auto_weights(e)
        curated = False
    bad = set(w) - MIDS
    if bad:
        problems.append(f"{e['id']}: nieznane mięśnie {bad}")
    out.append(dict(
        id=e["id"], name=name_pl, nameEn=e["name"], category=e["category"], categoryPl=CAT_PL[e["category"]],
        equipment=e["equipment"], equipmentPl=EQUIP_PL[e["equipment"]], mechanic=e["mechanic"], force=e["force"],
        level=e["level"], levelPl=LEVEL_PL[e["level"]],
        muscles={k: round(v, 2) for k, v in sorted(w.items(), key=lambda kv: -kv[1])},
        countsForVolume=e["category"] not in ("stretching", "cardio"),
        weightsSource="ręczne" if curated else "automatyczne",
        sourceMuscles=dict(primary=e["primaryMuscles"], secondary=e["secondaryMuscles"]),
        instructionsEn=e["instructions"], images=e["images"], source="free-exercise-db",
    ))

for x in EXTRA:
    w = {k: v for k, v in x["muscles"].items() if v > 0}
    bad = set(w) - MIDS
    if bad:
        problems.append(f"{x['id']}: nieznane mięśnie {bad}")
    out.append(dict(
        id=x["id"], name=x["name"], nameEn=x["nameEn"], category=x["category"], categoryPl=CAT_PL[x["category"]],
        equipment=x["equipment"], equipmentPl=EQUIP_PL[x["equipment"]], mechanic=x["mechanic"], force=x["force"],
        level=x["level"], levelPl=LEVEL_PL[x["level"]],
        muscles={k: round(v, 2) for k, v in sorted(w.items(), key=lambda kv: -kv[1])},
        countsForVolume=True, weightsSource="ręczne", sourceMuscles=None, instructionsEn=[], images=[], source="uzupełnienie",
    ))

ids = collections.Counter(o["id"] for o in out)
problems += [f"Duplikat id: {k}" for k, v in ids.items() if v > 1]
names = collections.Counter(o["name"] for o in out)
problems += [f"Duplikat polskiej nazwy: {k}" for k, v in names.items() if v > 1]
problems += [f"Brak mięśni: {o['id']}" for o in out if not o["muscles"]]
used = {e for e in pl}
problems += [f"Tłumaczenie bez ćwiczenia: {k}" for k in used - {e['name'] for e in src}]

json.dump(out, open(os.path.join(HERE, "..", "exercises.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

print("ćwiczeń:", len(out), "| ręczne wagi:", sum(o["weightsSource"] == "ręczne" for o in out),
      "| liczone do objętości:", sum(o["countsForVolume"] for o in out))
cov = collections.Counter()
cov_main = collections.Counter()
for o in out:
    if not o["countsForVolume"]:
        continue
    for m, v in o["muscles"].items():
        cov[m] += 1
        if v >= 0.8:
            cov_main[m] += 1
print("mięsień: wszystkie / jako główny (>=0.8)")
for m in muscles:
    print(f"  {m['id']:16s} {cov[m['id']]:4d} {cov_main[m['id']]:4d}")
print("PROBLEMY:", len(problems))
for p in problems[:80]:
    print("  ", p)
