#!/usr/bin/env python3
"""
Generate a SYNTHETIC demo race so Pit Wall works out of the box, offline.

Everything here is made up: a fictional circuit, fictional drivers and
fictional teams. It is written in exactly the same format that
fetch_race.py produces from real OpenF1 data, so the app treats both
the same way. The race is flagged `"synthetic": true` and the app shows
a "DEMO DATA" badge for it.

    python generate_demo.py            # writes data/demo/
    python generate_demo.py --seed 7   # a different race
"""
import argparse
import bisect
import json
import math
import os
import random

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------- circuit
# An original circuit shape (control points, roughly metres before scaling).
CONTROL = [
    (0, 0), (700, 0), (1300, 30), (1620, 220), (1600, 470), (1380, 560),
    (1150, 520), (980, 640), (1040, 900), (900, 1120), (600, 1180),
    (380, 1020), (330, 800), (120, 700), (-160, 820), (-420, 700),
    (-480, 420), (-330, 230), (-180, 60),
]
TRACK_LENGTH_M = 5200.0

TEAMS = [
    ("Aurora Racing", "E10600"), ("Vantage GP", "1E5BC6"),
    ("Helix Motorsport", "00A19C"), ("Kestrel F1 Team", "FF8700"),
    ("Nordwind Racing", "52E252"), ("Solstice Engineering", "B6BABD"),
    ("Pioneer Racing", "6692FF"), ("Tempest GP", "C92D4B"),
    ("Quasar Motorsport", "F5B841"), ("Lumen Racing", "9B59F6"),
]
DRIVERS = [
    (3, "ALV", "Marco Alvarez"), (7, "BRK", "Elin Brekke"),
    (11, "CHO", "Daniel Cho"), (14, "DUV", "Sophie Duval"),
    (18, "EKW", "Kwame Ekwueme"), (21, "FAR", "Luca Farina"),
    (24, "GRN", "Ava Green"), (27, "HAS", "Yusuf Hassan"),
    (30, "IVA", "Nina Ivanova"), (33, "JNS", "Oscar Jensen"),
    (36, "KAT", "Ren Kato"), (40, "LAR", "Mateo Larsen"),
    (44, "MOR", "Clara Moreau"), (47, "NOV", "Tomas Novak"),
    (51, "OKA", "Hana Okafor"), (55, "PIR", "Leo Pires"),
    (61, "QUI", "Isla Quinn"), (66, "ROS", "Felix Rossi"),
    (72, "SAN", "Maya Santos"), (88, "TAN", "Arjun Tanaka"),
]

COMPOUNDS = {
    # name: (pace offset s, degradation s/lap, cliff lap, cliff penalty s/lap)
    "SOFT": (-0.55, 0.075, 16, 0.35),
    "MEDIUM": (0.0, 0.045, 26, 0.25),
    "HARD": (0.45, 0.028, 40, 0.20),
}


def catmull_rom(points, per_seg=60):
    out = []
    n = len(points)
    for i in range(n):
        p0, p1, p2, p3 = (points[(i - 1) % n], points[i],
                          points[(i + 1) % n], points[(i + 2) % n])
        for k in range(per_seg):
            t = k / per_seg
            t2, t3 = t * t, t * t * t
            out.append(tuple(
                0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t
                       + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2
                       + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)
                for j in (0, 1)))
    return out


def build_track():
    pts = catmull_rom(CONTROL)
    seg = [math.dist(pts[i], pts[(i + 1) % len(pts)]) for i in range(len(pts))]
    scale = TRACK_LENGTH_M / sum(seg)
    pts = [(x * scale, y * scale) for x, y in pts]
    seg = [d * scale for d in seg]
    n = len(pts)

    # curvature -> cornering speed limit
    vmax, lat = 92.0, 38.0
    v = []
    for i in range(n):
        a, b, c = pts[i - 1], pts[i], pts[(i + 1) % n]
        h1 = math.atan2(b[1] - a[1], b[0] - a[0])
        h2 = math.atan2(c[1] - b[1], c[0] - b[0])
        dh = abs((h2 - h1 + math.pi) % (2 * math.pi) - math.pi)
        ds = (seg[i - 1] + seg[i]) / 2
        k = dh / ds if ds else 0
        v.append(min(vmax, math.sqrt(lat / k)) if k > 1e-6 else vmax)
    # acceleration / braking limits (two laps of passes so it wraps)
    acc, brk = 9.0, 30.0
    for _ in range(2):
        for i in range(n):
            j = (i + 1) % n
            v[j] = min(v[j], math.sqrt(v[i] ** 2 + 2 * acc * seg[i]))
        for i in range(n - 1, -1, -1):
            j = (i + 1) % n
            v[i] = min(v[i], math.sqrt(v[j] ** 2 + 2 * brk * seg[i]))

    # time fraction table: tau[i] = fraction of lap time spent reaching point i
    times = [0.0]
    for i in range(n):
        times.append(times[-1] + seg[i] / ((v[i] + v[(i + 1) % n]) / 2))
    total = times[-1]
    tau = [t / total for t in times]
    return pts, tau


def point_at_fraction(pts, tau, f):
    """Position on track after fraction f (0..1) of the lap *time*."""
    f = min(max(f, 0.0), 0.999999)
    i = bisect.bisect_right(tau, f) - 1
    i = max(0, min(i, len(pts) - 1))
    span = tau[i + 1] - tau[i]
    u = (f - tau[i]) / span if span else 0
    a, b = pts[i], pts[(i + 1) % len(pts)]
    return a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u


# ------------------------------------------------------------- simulation
def simulate(seed, total_laps):
    rng = random.Random(seed)
    base_lap = 86.0

    drivers = []
    for idx, (num, code, name) in enumerate(DRIVERS):
        team, colour = TEAMS[idx // 2]
        drivers.append({
            "number": num, "code": code, "name": name, "team": team,
            "colour": colour, "headshot": None,
            "pace": rng.gauss(0, 0.2) + (idx // 2) * 0.07,
            "consistency": rng.uniform(0.18, 0.4),
        })
    # grid: mostly by pace, with qualifying noise
    grid = sorted(drivers, key=lambda d: d["pace"] + rng.gauss(0, 0.35))

    # strategies
    for d in drivers:
        plan = rng.choice([
            [("MEDIUM", 0.45), ("HARD", 1.0)],
            [("SOFT", 0.3), ("HARD", 1.0)],
            [("HARD", 0.55), ("MEDIUM", 1.0)],
            [("SOFT", 0.28), ("MEDIUM", 0.62), ("SOFT", 1.0)],
            [("MEDIUM", 0.38), ("HARD", 0.75), ("SOFT", 1.0)],
        ])
        stints, start = [], 1
        for i, (comp, frac) in enumerate(plan):
            end = total_laps if i == len(plan) - 1 else max(
                start + 4, round(total_laps * frac + rng.randint(-3, 3)))
            stints.append({"compound": comp, "lap_start": start, "lap_end": end})
            start = end + 1
        d["stints"] = stints
        d["pit_laps"] = {s["lap_end"]: round(rng.uniform(2.1, 3.4), 1)
                         for s in stints[:-1]}

    dnf_driver = rng.choice(grid[6:])
    dnf_lap = rng.randint(total_laps // 3, total_laps * 2 // 3)

    # lap-by-lap crossing times with simple "dirty air" interaction
    T = {d["number"]: [0.0] for d in drivers}  # T[n][k] = time crossing line after k laps
    stationary = {d["number"]: {} for d in drivers}  # lap -> stop time at start of lap
    for gi, d in enumerate(grid):
        T[d["number"]][0] = gi * 0.22  # staggered grid (time behind the line)
    alive = {d["number"]: True for d in drivers}
    retired_at = {}

    for lap in range(1, total_laps + 2):
        order = sorted([d for d in drivers if alive[d["number"]]
                        and len(T[d["number"]]) == lap],
                       key=lambda d: T[d["number"]][lap - 1])
        prev_cross = None
        for d in order:
            n = d["number"]
            if d is dnf_driver and lap == dnf_lap:
                alive[n] = False
                retired_at[n] = (lap, T[n][lap - 1] + rng.uniform(15, 60))
                continue
            stint = next((s for s in d["stints"] if s["lap_start"] <= lap <= s["lap_end"]),
                         d["stints"][-1])
            off, deg, cliff, pen = COMPOUNDS[stint["compound"]]
            age = lap - stint["lap_start"]
            t = (base_lap + d["pace"] + off + deg * age
                 + max(0, age - cliff) * pen
                 - 0.055 * lap  # fuel burn
                 + rng.gauss(0, d["consistency"]))
            if lap == 1:
                t += 6.5 + rng.uniform(0, 1.5)
            if (lap - 1) in d["pit_laps"]:   # pit-out lap
                stop = d["pit_laps"][lap - 1]
                stationary[n][lap] = stop
                t += 17.0 + stop
            if lap in d["pit_laps"]:         # pit-in lap
                t += 3.5
            cross = T[n][lap - 1] + t
            if prev_cross is not None and cross < prev_cross + 0.25:
                # trying to pass: only succeeds with a clear pace advantage
                if rng.random() > 0.35 or cross > prev_cross - 0.4:
                    cross = prev_cross + rng.uniform(0.25, 0.9)
            T[n].append(cross)
            prev_cross = cross

    # race finishes when the leader completes total_laps
    leader_finish = min(T[d["number"]][total_laps] for d in drivers
                        if len(T[d["number"]]) > total_laps)
    finish = {}
    for d in drivers:
        n = d["number"]
        if not alive[n]:
            continue
        k = next(i for i in range(1, len(T[n])) if T[n][i] >= leader_finish - 1e-9)
        T[n] = T[n][:k + 1]
        finish[n] = (k, T[n][k])

    return drivers, grid, T, stationary, retired_at, finish, leader_finish


def progress_at(T, stationary, n, t, retired):
    """(laps completed, fraction of current lap's time) for driver n at time t."""
    times = T[n]
    if t < times[0]:
        return 0, 0.0
    k = bisect.bisect_right(times, t) - 1
    if k >= len(times) - 1:
        if retired:
            return k, None  # stopped on track
        return len(times) - 1, 0.0  # finished
    lt = times[k + 1] - times[k]
    stop = stationary[n].get(k + 1, 0.0)
    el = t - times[k]
    if el < stop:
        return k, 0.0
    return k, (el - stop) / (lt - stop)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seed", type=int, default=2024)
    ap.add_argument("--laps", type=int, default=44)
    ap.add_argument("--out", default=os.path.join(HERE, "data", "demo"))
    args = ap.parse_args()

    pts, tau = build_track()
    drivers, grid, T, stationary, retired_at, finish, leader_finish = simulate(
        args.seed, args.laps)
    nums = [d["number"] for d in drivers]
    end_time = max(f[1] for f in finish.values()) + 25
    t0 = -6.0  # a few seconds on the grid before lights out

    def xy(p):
        return [round(p[0] * 10), round(p[1] * 10)]  # decimetres, like OpenF1

    # ---------- locations (2 Hz)
    locations = {}
    grid_slot = {d["number"]: i for i, d in enumerate(grid)}
    step = 0.5
    for d in drivers:
        n = d["number"]
        rows, t = [], t0
        retired = n in retired_at
        stop_xy = None
        while t <= end_time:
            if retired and t >= retired_at[n][1]:
                break
            k, f = progress_at(T, stationary, n, t, retired)
            if t < T[n][0]:
                # sitting on the grid: behind the line, 8 m per slot
                gi = grid_slot[n]
                p = pts[-(1 + gi * 2)]
                p = (p[0], p[1] + (6 if gi % 2 else -6))
            elif f is None:
                p = stop_xy
            elif n in finish and k >= finish[n][0]:
                # cool-down: roll on slowly after the flag
                over = t - finish[n][1]
                p = point_at_fraction(pts, tau, min(0.25, over / 120))
            else:
                p = point_at_fraction(pts, tau, f)
            stop_xy = p
            rows.append([round(t, 2)] + xy(p))
            t += step
        if retired:
            # car parks at the side of the track
            k, f = progress_at(T, stationary, n, retired_at[n][1] - 0.01, False)
            p = point_at_fraction(pts, tau, f or 0)
            rows.append([round(retired_at[n][1], 2), round(p[0] * 10 + 60), round(p[1] * 10 + 60)])
        locations[str(n)] = rows

    # ---------- laps
    laps = {}
    for d in drivers:
        n = d["number"]
        rows = []
        for k in range(1, len(T[n])):
            rows.append({"lap": k, "t_start": round(T[n][k - 1], 3),
                         "duration": round(T[n][k] - T[n][k - 1], 3),
                         "pit_out": k in stationary[n]})
        laps[str(n)] = rows

    # ---------- positions + intervals (sampled)
    def race_progress(n, t):
        retired = n in retired_at
        if retired and t >= retired_at[n][1]:
            return -1e6 + retired_at[n][1]
        k, f = progress_at(T, stationary, n, t, retired)
        if t < T[n][0]:
            return -grid_slot[n] * 1e-3
        if n in finish and k >= finish[n][0]:
            # frozen at finish; earlier finisher with same laps ranks ahead
            return finish[n][0] + 0.999 - finish[n][1] * 1e-6
        return k + (f or 0)

    positions, intervals = [], []
    last_pos = {}
    t = t0
    while t <= end_time:
        order = sorted(nums, key=lambda n: -race_progress(n, t))
        for i, n in enumerate(order):
            if last_pos.get(n) != i + 1:
                positions.append({"t": round(t, 2), "number": n, "position": i + 1})
                last_pos[n] = i + 1
        if t >= 0 and abs((t / 4) - round(t / 4)) < 1e-9:
            lead = order[0]
            for n in order:
                if n in retired_at and t >= retired_at[n][1]:
                    continue
                pl, pn = race_progress(lead, t), race_progress(n, t)
                if n == lead:
                    gap = 0.0
                elif pl - pn >= 1:
                    gap = f"+{int(pl - pn)} LAP"
                else:
                    # time since the leader was at this car's spot
                    k = int(pn)
                    frac = pn - k
                    if k + 1 < len(T[lead]):
                        lt = T[lead][k + 1] - T[lead][k]
                        stop = stationary[lead].get(k + 1, 0)
                        when = T[lead][k] + stop + frac * (lt - stop)
                    else:
                        when = T[lead][-1]
                    gap = round(max(0.0, t - when), 3)
                intervals.append({"t": round(t, 2), "number": n, "gap": gap})
        t = round(t + step, 2)

    # ---------- stints + pits
    stints, pits = [], []
    for d in drivers:
        n = d["number"]
        last_lap = len(T[n]) - 1 if n not in retired_at else retired_at[n][0]
        for i, s in enumerate(d["stints"]):
            if s["lap_start"] > last_lap:
                break
            stints.append({"number": n, "stint": i + 1, "compound": s["compound"],
                           "lap_start": s["lap_start"],
                           "lap_end": min(s["lap_end"], last_lap)})
        for lap, stop in d["pit_laps"].items():
            if lap < last_lap:
                pits.append({"number": n, "lap": lap, "t": round(T[n][lap], 2),
                             "duration": round(stop + 19.5, 1), "stop": stop})

    # ---------- results
    results = []
    for n in sorted(nums, key=lambda n: -race_progress(n, end_time)):
        results.append({"number": n, "position": len(results) + 1,
                        "status": "DNF" if n in retired_at else "Finished",
                        "laps": len(T[n]) - 1 if n not in retired_at else retired_at[n][0] - 1})

    track = [xy(p) for p in pts[::2]]
    meta = {
        "key": "demo", "year": 2026, "name": "Demo Grand Prix (synthetic)",
        "circuit": "Pit Wall Park", "country": "Nowhere", "date": "2026-01-01",
        "total_laps": args.laps, "duration": round(end_time, 1), "start": t0,
        "synthetic": True,
        "note": "Fictional circuit, drivers and teams. Generated by generate_demo.py.",
    }
    out_drivers = [{k: d[k] for k in ("number", "code", "name", "team", "colour", "headshot")}
                   | {"grid": grid_slot[d["number"]] + 1} for d in drivers]

    os.makedirs(args.out, exist_ok=True)
    files = {"meta": meta, "drivers": out_drivers, "laps": laps, "positions": positions,
             "intervals": intervals, "stints": stints, "pits": pits, "track": track,
             "locations": locations, "results": results}
    for name, obj in files.items():
        with open(os.path.join(args.out, f"{name}.json"), "w") as fh:
            json.dump(obj, fh, separators=(",", ":"))
    update_index(os.path.join(HERE, "data"), meta)
    print(f"wrote synthetic demo race to {args.out}")


def update_index(data_dir, meta):
    path = os.path.join(data_dir, "races.json")
    races = []
    if os.path.exists(path):
        with open(path) as fh:
            races = json.load(fh)
    races = [r for r in races if r["key"] != meta["key"]]
    races.append({k: meta[k] for k in ("key", "year", "name", "circuit", "synthetic")})
    races.sort(key=lambda r: (r["synthetic"], -r["year"], r["name"]))
    with open(path, "w") as fh:
        json.dump(races, fh, indent=2)


if __name__ == "__main__":
    main()
