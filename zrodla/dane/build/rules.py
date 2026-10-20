"""Automatyczne przypisanie wag zaangażowania (0–1) do 43 mięśni modelu.

Wejście: ćwiczenie z free-exercise-db (primaryMuscles / secondaryMuscles to 17 grubych grup).
Mięsień główny ma poziom 1.0, pomocniczy 0.5. Każda gruba grupa jest rozdzielana na konkretne
mięśnie modelu wg słów kluczowych w nazwie ćwiczenia. Wynik dla mięśnia = max ze wszystkich źródeł.
To są szacunki biomechaniczne, nie pomiary EMG.
"""
import re

def has(n, *words):
    return any(re.search(w, n) for w in words)

PRIMARY, SECONDARY = 1.0, 0.5


def split_group(group, n, e):
    """Zwraca {mięsień_modelu: udział} dla jednej grubej grupy z bazy."""
    force = e.get("force")
    mech = e.get("mechanic")
    if group == "chest":
        if has(n, r"\bdecline\b", r"\bdip", r"dips"):
            return {"chest_abd": 1.0, "chest_stern": 0.8, "chest_clav": 0.2}
        if has(n, r"incline", r"low cable crossover", r"low-pulley", r"low pulley", r"front raise", r"guillotine"):
            return {"chest_clav": 1.0, "chest_stern": 0.6, "chest_abd": 0.2}
        if has(n, r"pullover"):
            return {"chest_stern": 0.7, "chest_abd": 0.7, "serratus": 0.4}
        out = {"chest_stern": 1.0, "chest_clav": 0.6, "chest_abd": 0.6}
        if has(n, r"push-?up", r"pushup"):
            out["serratus"] = 0.4
        return out

    if group == "shoulders":
        if has(n, r"rear", r"reverse fl", r"face pull", r"pull apart", r"back fly", r"reverse machine", r"bent over .*lateral",
               r"bent-over .*raise", r"iron cross", r"crucifix", r"sled reverse"):
            return {"delt_rear": 1.0, "traps_mid": 0.5, "rhomboids": 0.5, "rotator_cuff": 0.4}
        if has(n, r"pullover"):
            return {"delt_rear": 0.4, "delt_front": 0.3}
        if has(n, r"external rotation", r"internal rotation", r"cuban", r"rotation with"):
            return {"rotator_cuff": 1.0, "delt_rear": 0.3}
        if has(n, r"upright"):
            return {"delt_side": 1.0, "traps_upper": 0.7, "delt_front": 0.4}
        if has(n, r"lateral", r"side lateral", r"deltoid raise", r"laterals", r"\bside raise"):
            return {"delt_side": 1.0, "delt_front": 0.3, "traps_upper": 0.3, "rotator_cuff": 0.2}
        if has(n, r"front.*raise", r"front cable raise", r"front plate", r"front .*raise", r"shoulder raise", r"straight raises",
               r"scaption", r"raise over head", r"raise above head", r"front delt"):
            return {"delt_front": 1.0, "delt_side": 0.4, "chest_clav": 0.3}
        if has(n, r"press", r"jerk", r"handstand", r"arnold", r"military", r"push press", r"bradford", r"see-saw", r"thruster",
               r"jammer"):
            return {"delt_front": 1.0, "delt_side": 0.5, "serratus": 0.3, "traps_upper": 0.3}
        if has(n, r"clean", r"snatch", r"high pull", r"swing", r"halo", r"around the world", r"get-up"):
            return {"delt_side": 0.7, "delt_front": 0.7, "delt_rear": 0.4, "rotator_cuff": 0.4}
        if force == "push":
            return {"delt_front": 1.0, "delt_side": 0.3}
        if force == "pull":
            return {"delt_rear": 1.0, "delt_side": 0.3}
        return {"delt_front": 0.6, "delt_side": 0.6, "delt_rear": 0.5}

    if group == "triceps":
        if has(n, r"overhead", r"behind the head", r"french", r"lying", r"skull", r"over head", r"halo", r"incline barbell triceps",
               r"incline triceps", r"bent-over", r"bent over", r"pullover"):
            return {"triceps_long": 1.0, "triceps_short": 0.7}
        if has(n, r"pushdown", r"kickback", r"dip", r"press", r"push-?up", r"pushup", r"tate"):
            return {"triceps_short": 1.0, "triceps_long": 0.6}
        return {"triceps_short": 1.0, "triceps_long": 0.8}

    if group == "biceps":
        if has(n, r"hammer", r"reverse", r"zottman", r"cross body", r"palms? in", r"neutral"):
            return {"brachialis": 1.0, "brachioradialis": 1.0, "biceps": 0.6}
        if has(n, r"curl"):
            if has(n, r"preacher", r"spider", r"concentration", r"prone"):
                return {"biceps": 1.0, "brachialis": 0.8, "brachioradialis": 0.2}
            return {"biceps": 1.0, "brachialis": 0.6, "brachioradialis": 0.3}
        return {"biceps": 1.0, "brachialis": 0.8, "brachioradialis": 0.5}

    if group == "forearms":
        if has(n, r"palms?-down", r"reverse wrist", r"wrist roller", r"wrist rotation", r"pronation", r"supination", r"extension"):
            return {"forearm_ext": 1.0, "forearm_flex": 0.5, "brachioradialis": 0.3}
        if has(n, r"reverse.*curl", r"reverse plate", r"hammer", r"zottman"):
            return {"brachioradialis": 1.0, "forearm_ext": 0.6, "forearm_flex": 0.3}
        if has(n, r"wrist curl", r"palms?-up", r"finger", r"pinch", r"squeeze", r"grip"):
            return {"forearm_flex": 1.0, "forearm_ext": 0.3}
        return {"forearm_flex": 1.0, "brachioradialis": 0.4, "forearm_ext": 0.4}

    if group == "lats":
        if has(n, r"pullover", r"straight-arm", r"straight arm"):
            return {"lats": 1.0, "teres_major": 0.8, "triceps_long": 0.3}
        if has(n, r"row"):
            return {"lats": 1.0, "teres_major": 0.7, "rhomboids": 0.4}
        return {"lats": 1.0, "teres_major": 0.8, "traps_lower": 0.3}

    if group == "middle back":
        if has(n, r"shrug"):
            return {"traps_mid": 1.0, "rhomboids": 1.0}
        return {"rhomboids": 1.0, "traps_mid": 1.0, "traps_lower": 0.5, "delt_rear": 0.4}

    if group == "lower back":
        if has(n, r"side bend", r"quadratus"):
            return {"quadratus_lumb": 1.0, "erectors": 0.5}
        return {"erectors": 1.0, "quadratus_lumb": 0.4}

    if group == "traps":
        if has(n, r"shrug"):
            if has(n, r"middle back"):
                return {"traps_mid": 1.0, "rhomboids": 0.8}
            return {"traps_upper": 1.0, "levator_scap": 0.6, "traps_mid": 0.3}
        if has(n, r"upright"):
            return {"traps_upper": 1.0, "delt_side": 0.6, "levator_scap": 0.3}
        if has(n, r"face pull", r"rear", r"row", r"reverse fl"):
            return {"traps_mid": 1.0, "traps_lower": 0.5, "traps_upper": 0.4}
        return {"traps_upper": 1.0, "traps_mid": 0.6, "traps_lower": 0.3}

    if group == "abdominals":
        if has(n, r"oblique", r"twist", r"side bend", r"russian", r"wood ?chop", r"windmill", r"side bridge", r"side plank",
               r"cable lift", r"judo", r"landmine 180", r"cross[- ]body", r"elbow to knee", r"heel touch", r"wiper", r"side jack",
               r"car drivers", r"plate twist", r"pallof", r"see-?saw", r"figure 8", r"spell caster", r"pirate"):
            return {"obliques": 1.0, "abs": 0.5, "transversus": 0.5}
        if has(n, r"leg raise", r"knee raise", r"knee/hip", r"reverse crunch", r"hip raise", r"pull-?in", r"tuck", r"hanging",
               r"flutter", r"leg lift", r"pike", r"jackknife", r"gorilla", r"butt-?ups", r"bottoms up", r"leg pull", r"climber"):
            return {"abs": 1.0, "hip_flexors": 0.7, "obliques": 0.4, "transversus": 0.3}
        if has(n, r"plank", r"rollout", r"ab roller", r"fallout", r"dead bug", r"body-up", r"bridge", r"hollow", r"stir"):
            return {"abs": 1.0, "transversus": 0.8, "obliques": 0.6}
        if has(n, r"sit-?up", r"v-up", r"cocoon"):
            return {"abs": 1.0, "hip_flexors": 0.6, "obliques": 0.4}
        if has(n, r"crunch"):
            return {"abs": 1.0, "obliques": 0.4}
        if mech == "compound":
            return {"transversus": 1.0, "abs": 0.6, "obliques": 0.6}
        return {"abs": 1.0, "obliques": 0.4, "transversus": 0.3}

    if group == "quadriceps":
        if has(n, r"hip flexion", r"leg raise", r"knee raise", r"knee up"):
            return {"hip_flexors": 1.0, "rectus_fem": 0.8, "abs": 0.3}
        if has(n, r"leg extension", r"sissy", r"leg extensions"):
            return {"rectus_fem": 1.0, "vasti": 1.0}
        if has(n, r"sprint", r"run", r"skip", r"bike", r"bicycl", r"kick", r"step mill", r"stairmaster", r"knee raise"):
            return {"rectus_fem": 0.8, "vasti": 1.0, "hip_flexors": 0.4}
        return {"vasti": 1.0, "rectus_fem": 0.5}

    if group == "hamstrings":
        if has(n, r"leg curl", r"glute.?ham", r"hamstring", r"\bcurl\b", r"slides"):
            return {"hamstrings": 1.0, "gastrocnemius": 0.3}
        return {"hamstrings": 1.0}

    if group == "glutes":
        if has(n, r"hip thrust", r"bridge", r"kickback", r"pull through", r"hip extension", r"butt lift", r"hip lift", r"hip raise",
               r"reverse hyper"):
            return {"glute_max": 1.0, "glute_med": 0.4}
        if has(n, r"monster walk", r"lateral", r"side"):
            return {"glute_med": 1.0, "glute_max": 0.6, "tfl": 0.4}
        return {"glute_max": 1.0, "glute_med": 0.3, "hip_rotators": 0.2}

    if group == "abductors":
        return {"glute_med": 1.0, "tfl": 0.7, "hip_rotators": 0.4}

    if group == "adductors":
        return {"adductors": 1.0}

    if group == "calves":
        if has(n, r"tibialis", r"toe raise", r"dorsiflex", r"reverse calf"):
            return {"tibialis_ant": 1.0}
        if has(n, r"seated.*calf", r"seated calf"):
            return {"soleus": 1.0, "gastrocnemius": 0.4}
        if has(n, r"calf"):
            return {"gastrocnemius": 1.0, "soleus": 0.7, "fibularis": 0.2}
        return {"gastrocnemius": 1.0, "soleus": 0.8}

    if group == "neck":
        if has(n, r"face up", r"front"):
            if has(n, r"back"):
                return {"neck_front": 1.0, "neck_back": 1.0}
            return {"neck_front": 1.0}
        if has(n, r"face down", r"harness", r"back"):
            return {"neck_back": 1.0}
        if has(n, r"side"):
            return {"neck_front": 0.8, "neck_back": 0.8}
        return {"neck_front": 1.0, "neck_back": 1.0}

    raise ValueError(group)


def auto_weights(e):
    n = e["name"].lower()
    w = {}
    for level, groups in ((PRIMARY, e["primaryMuscles"]), (SECONDARY, e["secondaryMuscles"])):
        for g in groups:
            for m, f in split_group(g, n, e).items():
                w[m] = max(w.get(m, 0.0), round(level * f, 2))
    # Ćwiczenia wiosłujące/podciągające: dorzuć bicepsy, jeśli baza ich nie wymieniła
    if e.get("force") == "pull" and e.get("mechanic") == "compound" and has(n, r"row", r"pull-?up", r"pullup", r"chin", r"pulldown"):
        for m, f in {"biceps": 0.4, "brachialis": 0.4}.items():
            w.setdefault(m, f)
    return {k: v for k, v in sorted(w.items(), key=lambda kv: -kv[1]) if v >= 0.15}
