#!/usr/bin/env python3
"""
Download one Formula 1 race from the free OpenF1 API (https://openf1.org)
and save it as static JSON files that the Pit Wall app can replay.

    python fetch_race.py --year 2024 --race "Monza"
    python fetch_race.py --year 2023 --race "Silverstone" --sample 0.5
    python fetch_race.py --list 2024            # show races for a season

The free tier allows roughly 30 requests a minute, so the script paces its
requests. A full race takes a few minutes to download; after that the
replay is instant and works offline. Only the Python standard library is
needed.

Output: data/<year>-<slug>/{meta,drivers,laps,positions,intervals,stints,
pits,track,locations,results}.json, plus an entry in data/races.json.
All timestamps are converted to seconds after lights out.
"""
import argparse
import bisect
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

API = "https://api.openf1.org/v1"
HERE = os.path.dirname(os.path.abspath(__file__))
MIN_INTERVAL = 2.1  # seconds between requests (~28/min)
_last_request = 0.0


# ------------------------------------------------------------------ http
def get(endpoint, **params):
    """GET an OpenF1 endpoint. Keys may carry an operator, e.g. 'date>'."""
    global _last_request
    parts = []
    for key, value in params.items():
        op = "="
        m = re.match(r"^(\w+)([<>]=?)$", key)
        if m:
            key, op = m.group(1), m.group(2)
        parts.append(f"{key}{op}{urllib.parse.quote(str(value), safe=':-.T+')}")
    url = f"{API}/{endpoint}?{'&'.join(parts)}"
    for attempt in range(6):
        wait = MIN_INTERVAL - (time.time() - _last_request)
        if wait > 0:
            time.sleep(wait)
        _last_request = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "pit-wall/1.0"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return []
            if e.code in (429, 500, 502, 503, 504):
                back = int(e.headers.get("Retry-After") or 0) or 5 * (attempt + 1)
                print(f"  {e.code} from OpenF1, retrying in {back}s ...", file=sys.stderr)
                time.sleep(back)
                continue
            raise
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"  network error ({e}), retrying ...", file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    raise SystemExit(f"Giving up on {url}")


def parse_date(s):
    if s is None:
        return None
    s = s.replace("Z", "+00:00")
    # normalise fractional seconds to 6 digits for older Pythons
    m = re.match(r"^(.*T\d\d:\d\d:\d\d)(\.\d+)?(.*)$", s)
    if m:
        frac = (m.group(2) or ".0")[1:7].ljust(6, "0")
        s = f"{m.group(1)}.{frac}{m.group(3) or '+00:00'}"
    dt = datetime.fromisoformat(s)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


# ------------------------------------------------------------ discovery
def find_session(year, race):
    meetings = get("meetings", year=year)
    q = race.lower()
    hits = [m for m in meetings if any(
        q in str(m.get(f, "")).lower()
        for f in ("meeting_name", "meeting_official_name", "location",
                  "country_name", "circuit_short_name"))]
    if not hits:
        names = ", ".join(m.get("meeting_name", "?") for m in meetings)
        raise SystemExit(f"No {year} race matching '{race}'. Races: {names}")
    meeting = hits[0]
    sessions = get("sessions", meeting_key=meeting["meeting_key"], session_name="Race")
    if not sessions:
        raise SystemExit(f"{meeting['meeting_name']} has no Race session in OpenF1 yet.")
    return meeting, sessions[0]


def list_races(year):
    for m in get("meetings", year=year):
        print(f"  {m.get('date_start', '')[:10]}  {m.get('meeting_name')}  "
              f"({m.get('location')}, {m.get('country_name')})")


# ------------------------------------------------------------- download
def main():
    global MIN_INTERVAL
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--year", type=int, help="season, 2023 or later")
    ap.add_argument("--race", help="race name, city, country or circuit, e.g. Monza")
    ap.add_argument("--list", type=int, metavar="YEAR", help="list the races of a season")
    ap.add_argument("--sample", type=float, default=1.0,
                    help="seconds between saved GPS points per car (default 1.0)")
    ap.add_argument("--chunk", type=int, default=15,
                    help="minutes of GPS data per request (default 15)")
    ap.add_argument("--delay", type=float, default=MIN_INTERVAL,
                    help="seconds between requests (default 2.1)")
    args = ap.parse_args()
    MIN_INTERVAL = args.delay

    if args.list:
        list_races(args.list)
        return
    if not (args.year and args.race):
        ap.error("--year and --race are required (or use --list YEAR)")

    meeting, session = find_session(args.year, args.race)
    skey = session["session_key"]
    name = meeting.get("meeting_name") or f"{session.get('country_name')} Grand Prix"
    print(f"Found {args.year} {name} (session {skey})")

    print("drivers ...")
    drivers_raw = get("drivers", session_key=skey)
    print("laps ...")
    laps_raw = get("laps", session_key=skey)
    print("positions ...")
    pos_raw = get("position", session_key=skey)
    print("intervals ...")
    int_raw = get("intervals", session_key=skey)
    print("stints ...")
    stints_raw = get("stints", session_key=skey)
    print("pit stops ...")
    pits_raw = get("pit", session_key=skey)
    print("results ...")
    try:
        results_raw = get("session_result", session_key=skey)
    except urllib.error.HTTPError:
        results_raw = []

    # race start = earliest lap-1 start; fall back to the session start
    starts = [parse_date(l["date_start"]) for l in laps_raw
              if l.get("lap_number") == 1 and l.get("date_start")]
    if not starts:
        starts = [parse_date(l["date_start"]) - timedelta(seconds=l.get("lap_duration") or 0)
                  for l in laps_raw if l.get("lap_number") == 2 and l.get("date_start")]
    t0 = min(starts) if starts else parse_date(session["date_start"])
    session_end = parse_date(session.get("date_end")) or (t0 + timedelta(hours=2, minutes=30))

    def rel(s):
        d = parse_date(s)
        return None if d is None else round((d - t0).total_seconds(), 2)

    # ---- drivers
    seen, drivers = set(), []
    for d in drivers_raw:
        n = d.get("driver_number")
        if n in seen:
            continue
        seen.add(n)
        drivers.append({
            "number": n,
            "code": d.get("name_acronym") or str(n),
            "name": d.get("full_name") or d.get("broadcast_name") or str(n),
            "team": d.get("team_name") or "",
            "colour": (d.get("team_colour") or "888888").lstrip("#"),
            "headshot": d.get("headshot_url"),
        })
    numbers = {d["number"] for d in drivers}

    # ---- laps
    laps = {}
    for l in sorted(laps_raw, key=lambda l: (l["driver_number"], l["lap_number"])):
        n = l["driver_number"]
        if n not in numbers:
            continue
        laps.setdefault(str(n), []).append({
            "lap": l["lap_number"],
            "t_start": rel(l.get("date_start")),
            "duration": l.get("lap_duration"),
            "pit_out": bool(l.get("is_pit_out_lap")),
        })
    total_laps = max((l["lap"] for v in laps.values() for l in v), default=0)

    # ---- positions (keep from 2 min before the start onwards)
    positions = sorted(
        ({"t": rel(p["date"]), "number": p["driver_number"], "position": p["position"]}
         for p in pos_raw if p.get("date") and p["driver_number"] in numbers),
        key=lambda p: p["t"])
    if positions:
        # collapse everything before the start into one snapshot at t = -5
        pre = {}
        rest = []
        for p in positions:
            if p["t"] < -5:
                pre[p["number"]] = p["position"]
            else:
                rest.append(p)
        positions = [{"t": -5.0, "number": n, "position": pos} for n, pos in pre.items()] + rest

    # ---- intervals
    intervals = []
    for i in int_raw:
        if i["driver_number"] not in numbers or not i.get("date"):
            continue
        g = i.get("gap_to_leader")
        if isinstance(g, str):
            g = g.strip().upper()
        intervals.append({"t": rel(i["date"]), "number": i["driver_number"], "gap": g})
    intervals = [i for i in intervals if i["t"] >= -5]
    intervals.sort(key=lambda i: i["t"])

    # ---- stints
    stints = [{"number": s["driver_number"], "stint": s.get("stint_number"),
               "compound": (s.get("compound") or "UNKNOWN").upper(),
               "lap_start": s.get("lap_start"), "lap_end": s.get("lap_end"),
               "tyre_age": s.get("tyre_age_at_start")}
              for s in stints_raw if s["driver_number"] in numbers]

    # ---- pits
    pits = []
    for p in pits_raw:
        if p["driver_number"] not in numbers:
            continue
        pits.append({"number": p["driver_number"], "lap": p.get("lap_number"),
                     "t": rel(p.get("date")),
                     "duration": p.get("pit_duration") or p.get("lane_duration"),
                     "stop": p.get("stop_duration")})

    # ---- GPS locations, chunked per driver
    raw_loc = {}
    chunk = timedelta(minutes=args.chunk)
    loc_from = t0 - timedelta(seconds=30)
    windows = []
    a = loc_from
    while a < session_end:
        windows.append((a, min(a + chunk, session_end)))
        a += chunk
    total_req = len(windows) * len(drivers)
    print(f"GPS locations: {total_req} requests (~{total_req * MIN_INTERVAL / 60:.0f} min) ...")
    done = 0
    for d in drivers:
        n = d["number"]
        rows = []
        for a, b in windows:
            data = get("location", session_key=skey, driver_number=n,
                       **{"date>": iso(a), "date<": iso(b)})
            for r in data:
                x, y = r.get("x"), r.get("y")
                if x is None or y is None or (x == 0 and y == 0 and r.get("z", 0) == 0):
                    continue
                rows.append((rel(r["date"]), int(x), int(y)))
            done += 1
            print(f"\r  {done}/{total_req}", end="", flush=True)
        rows.sort()
        raw_loc[n] = rows
    print()

    # ---- track outline from a clean, representative lap
    track = build_track(raw_loc, laps)

    # ---- downsample locations
    locations = {}
    for n, rows in raw_loc.items():
        out, last = [], -1e9
        for t, x, y in rows:
            if t - last >= args.sample - 1e-6:
                out.append([t, x, y])
                last = t
        locations[str(n)] = out

    # ---- results
    results = []
    for r in sorted(results_raw, key=lambda r: (r.get("position") or 99)):
        status = "Finished"
        if r.get("dnf"):
            status = "DNF"
        elif r.get("dns"):
            status = "DNS"
        elif r.get("dsq"):
            status = "DSQ"
        results.append({"number": r["driver_number"], "position": r.get("position"),
                        "status": status, "laps": r.get("number_of_laps")})

    # grid = first known position
    first_pos = {}
    for p in positions:
        first_pos.setdefault(p["number"], p["position"])
    for d in drivers:
        d["grid"] = first_pos.get(d["number"])

    ends = [l["t_start"] + (l["duration"] or 0) for v in laps.values() for l in v
            if l["t_start"] is not None]
    duration = round(max(ends) + 30, 1) if ends else round((session_end - t0).total_seconds(), 1)

    key = f"{args.year}-{slugify(meeting.get('location') or name)}"
    meta = {
        "key": key, "year": args.year, "name": f"{args.year} {name}",
        "circuit": meeting.get("circuit_short_name") or meeting.get("location"),
        "country": meeting.get("country_name"), "date": iso(t0)[:10],
        "total_laps": total_laps, "duration": duration, "start": -5.0,
        "synthetic": False, "session_key": skey,
        "note": "Data from OpenF1 (openf1.org). Unofficial fan project.",
    }

    out = os.path.join(HERE, "data", key)
    os.makedirs(out, exist_ok=True)
    files = {"meta": meta, "drivers": drivers, "laps": laps, "positions": positions,
             "intervals": intervals, "stints": stints, "pits": pits, "track": track,
             "locations": locations, "results": results}
    for fname, obj in files.items():
        with open(os.path.join(out, f"{fname}.json"), "w") as fh:
            json.dump(obj, fh, separators=(",", ":"))
    update_index(os.path.join(HERE, "data"), meta)
    print(f"Saved to data/{key}/ - start the app with: python -m http.server 8000")


def build_track(raw_loc, laps):
    """Use the GPS trace of the fastest clean lap (no pit, lap 3+) as the outline."""
    best = None
    for n, rows in raw_loc.items():
        if len(rows) < 100:
            continue
        times = [r[0] for r in rows]
        for l in laps.get(str(n), []):
            if (l["pit_out"] or not l["duration"] or l["t_start"] is None
                    or l["lap"] < 3):
                continue
            a = bisect.bisect_left(times, l["t_start"])
            b = bisect.bisect_right(times, l["t_start"] + l["duration"])
            pts = rows[a:b]
            if len(pts) < 150:
                continue
            score = l["duration"]
            if best is None or score < best[0]:
                best = (score, pts)
    if best is None:
        return []
    pts = best[1]
    # thin to ~1 point per 2 samples and close the loop
    thinned = [[x, y] for _, x, y in pts[::2]]
    if thinned and thinned[0] != thinned[-1]:
        thinned.append(thinned[0])
    return thinned


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
