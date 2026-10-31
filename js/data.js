/* Pit Wall: loads a saved race and answers "what was happening at time t?" */
(function () {
  "use strict";

  const FILES = ["meta", "drivers", "laps", "positions", "intervals", "stints",
                 "pits", "track", "locations", "results"];
  const OPTIONAL = new Set(["results", "intervals", "pits", "stints"]);

  /** index of the last element <= t in a sorted numeric array, or -1 */
  function lastLE(arr, t) {
    let lo = 0, hi = arr.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  async function loadJSON(url, optional) {
    const res = await fetch(url);
    if (!res.ok) {
      if (optional) return null;
      throw new Error(`Could not load ${url} (${res.status})`);
    }
    return res.json();
  }

  async function listRaces() {
    const races = await loadJSON("data/races.json", true);
    return races || [];
  }

  async function loadRace(key) {
    const parts = await Promise.all(FILES.map((f) =>
      loadJSON(`data/${key}/${f}.json`, OPTIONAL.has(f))));
    const raw = {};
    FILES.forEach((f, i) => { raw[f] = parts[i]; });
    return new Race(raw);
  }

  class Race {
    constructor(raw) {
      this.meta = raw.meta;
      this.track = raw.track || [];
      this.results = raw.results || [];
      this.drivers = raw.drivers.slice();
      this.byNumber = new Map(this.drivers.map((d) => [d.number, d]));
      for (const d of this.drivers) {
        d.colour = "#" + String(d.colour || "888888").replace(/^#/, "");
      }

      // --- GPS: columnar typed arrays per driver for fast interpolation
      this.loc = new Map();
      for (const [num, rows] of Object.entries(raw.locations || {})) {
        const n = rows.length, t = new Float64Array(n), x = new Float32Array(n), y = new Float32Array(n);
        rows.forEach((r, i) => { t[i] = r[0]; x[i] = r[1]; y[i] = r[2]; });
        this.loc.set(Number(num), { t, x, y });
      }

      // --- timelines (event lists) per driver
      this.posTL = this._timeline(raw.positions || [], "position");
      this.gapTL = this._timeline(raw.intervals || [], "gap");

      // --- laps
      this.laps = new Map();
      for (const [num, rows] of Object.entries(raw.laps || {})) {
        const list = rows.filter((l) => l.lap != null).sort((a, b) => a.lap - b.lap);
        // fill missing lap-1 start (OpenF1 sometimes omits it)
        list.forEach((l, i) => {
          if (l.t_start == null && list[i + 1] && list[i + 1].t_start != null && l.duration)
            l.t_start = list[i + 1].t_start - l.duration;
        });
        if (list[0] && list[0].lap === 1 && list[0].t_start == null) list[0].t_start = 0;
        this.laps.set(Number(num), list);
      }
      this.totalLaps = this.meta.total_laps ||
        Math.max(0, ...[...this.laps.values()].map((l) => l.length));

      // --- stints & pits
      this.stints = new Map();
      for (const s of raw.stints || []) {
        if (!this.stints.has(s.number)) this.stints.set(s.number, []);
        this.stints.get(s.number).push(s);
      }
      for (const list of this.stints.values()) list.sort((a, b) => (a.lap_start || 0) - (b.lap_start || 0));
      this.pits = (raw.pits || []).filter((p) => p.t != null).sort((a, b) => a.t - b.t);

      // --- fastest lap of the race (ignore lap 1 and pit laps)
      this.fastest = null;
      for (const [num, list] of this.laps) {
        for (const l of list) {
          if (!l.duration || l.lap < 2 || l.pit_out) continue;
          if (!this.fastest || l.duration < this.fastest.duration)
            this.fastest = { number: num, lap: l.lap, duration: l.duration, t: l.t_start + l.duration };
        }
      }

      this.start = this.meta.start != null ? this.meta.start : -5;
      this.duration = this.meta.duration ||
        Math.max(...[...this.loc.values()].map((l) => l.t[l.t.length - 1] || 0));

      // track bounds
      const pts = this.track.length ? this.track : [].concat(...[...this.loc.values()].slice(0, 1)
        .map((l) => Array.from(l.x, (x, i) => [x, l.y[i]])));
      this.bounds = pts.reduce((b, p) => ({
        minX: Math.min(b.minX, p[0]), maxX: Math.max(b.maxX, p[0]),
        minY: Math.min(b.minY, p[1]), maxY: Math.max(b.maxY, p[1]),
      }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
      if (!this.track.length) this.track = pts;
    }

    _timeline(events, field) {
      const tl = new Map();
      for (const e of events) {
        if (e.t == null) continue;
        if (!tl.has(e.number)) tl.set(e.number, { t: [], v: [] });
        const x = tl.get(e.number);
        x.t.push(e.t); x.v.push(e[field]);
      }
      for (const x of tl.values()) {
        const idx = x.t.map((_, i) => i).sort((a, b) => x.t[a] - x.t[b]);
        x.t = idx.map((i) => x.t[i]); x.v = idx.map((i) => x.v[i]);
      }
      return tl;
    }

    _valueAt(tl, n, t) {
      const x = tl.get(n);
      if (!x) return null;
      const i = lastLE(x.t, t);
      return i < 0 ? (x.v.length ? x.v[0] : null) : x.v[i];
    }

    /** interpolated car position, or null if no data yet */
    carXY(n, t) {
      const l = this.loc.get(n);
      if (!l || !l.t.length) return null;
      const i = lastLE(l.t, t);
      if (i < 0) return { x: l.x[0], y: l.y[0], stale: false };
      if (i >= l.t.length - 1) return { x: l.x[i], y: l.y[i], stale: t - l.t[i] > 8 };
      const dt = l.t[i + 1] - l.t[i];
      // big gaps in GPS (garage, red flag): hold position rather than glide
      if (dt > 6) return { x: l.x[i], y: l.y[i], stale: t - l.t[i] > 8 };
      const u = dt > 0 ? (t - l.t[i]) / dt : 0;
      return { x: l.x[i] + (l.x[i + 1] - l.x[i]) * u, y: l.y[i] + (l.y[i + 1] - l.y[i]) * u, stale: false };
    }

    position(n, t) { return this._valueAt(this.posTL, n, t); }

    gap(n, t) {
      const x = this.gapTL.get(n);
      if (!x) return null;
      const i = lastLE(x.t, t);
      if (i < 0) return null;
      const v = x.v[i];
      // interpolate numeric gaps between samples so they "tick"
      if (typeof v === "number" && i + 1 < x.t.length && typeof x.v[i + 1] === "number") {
        const dt = x.t[i + 1] - x.t[i];
        if (dt > 0 && dt < 15) return v + (x.v[i + 1] - v) * ((t - x.t[i]) / dt);
      }
      return v;
    }

    /** laps completed by driver n at time t */
    lapsDone(n, t) {
      const list = this.laps.get(n) || [];
      let done = 0;
      for (const l of list) {
        if (l.t_start != null && l.duration && l.t_start + l.duration <= t) done = l.lap;
      }
      return done;
    }

    /** the lap the leader is on (1-based), clamped to total laps */
    raceLap(t, order) {
      if (t < 0) return 0;
      const lead = order && order[0];
      if (lead == null) return 0;
      return Math.min(this.totalLaps, this.lapsDone(lead, t) + 1);
    }

    stintAt(n, lap) {
      const list = this.stints.get(n) || [];
      let s = null;
      for (const x of list) if ((x.lap_start || 1) <= Math.max(lap, 1)) s = x;
      return s;
    }

    tyreAt(n, t) {
      const lap = this.lapsDone(n, t) + 1;
      const s = this.stintAt(n, lap);
      if (!s) return null;
      return { compound: s.compound, age: (s.tyre_age || 0) + Math.max(0, lap - (s.lap_start || 1)) };
    }

    inPit(n, t) {
      for (const p of this.pits) {
        if (p.t > t) break;
        if (p.number === n && t <= p.t + Math.min(p.duration || 22, 40)) return p;
      }
      return null;
    }

    retired(n, t) {
      const r = this.results.find((x) => x.number === n);
      if (!r || r.status === "Finished") return false;
      const l = this.loc.get(n);
      return !l || !l.t.length || t > l.t[l.t.length - 1] + 3;
    }

    /** drivers ordered by race position at time t */
    order(t) {
      const list = this.drivers.map((d) => d.number);
      const key = (n) => {
        const p = this.position(n, t);
        return (this.retired(n, t) ? 1000 : 0) + (p == null ? 99 : p);
      };
      return list.sort((a, b) => key(a) - key(b) || a - b);
    }

    finishTime() {
      // time the leader takes the flag
      const winner = this.results.length ? this.results[0].number : this.order(this.duration)[0];
      const list = this.laps.get(winner) || [];
      const last = list.find((l) => l.lap === this.totalLaps) || list[list.length - 1];
      return last && last.t_start != null ? last.t_start + (last.duration || 0) : this.duration;
    }

    lapTimes(n) {
      return (this.laps.get(n) || []).filter((l) => l.duration);
    }

    /** time each driver crossed the line at the end of lap k */
    crossing(n, k) {
      const l = (this.laps.get(n) || []).find((x) => x.lap === k);
      return l && l.t_start != null && l.duration ? l.t_start + l.duration : null;
    }
  }

  window.PitData = { listRaces, loadRace, lastLE };
})();
