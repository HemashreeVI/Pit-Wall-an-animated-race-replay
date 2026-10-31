/* Pit Wall: wires the race clock to the track map, leaderboard and charts. */
(function () {
  "use strict";
  const { RaceClock, fmtClock } = window.PitReplay;
  const $ = (id) => document.getElementById(id);

  const clock = new RaceClock(0, 1);
  const state = { race: null, map: null, board: null, tyres: null, selected: new Set(), tab: "tyres",
                  lastT: null, lastTyreDraw: 0, lastH2HLap: null, h2h: [null, null], token: 0 };

  // ------------------------------------------------------------ bootstrap
  async function boot() {
    const intro = window.PitIntro.playIntro();
    window.PitCharts.bindDriverCard();
    bindControls();
    let races = [];
    try { races = await window.PitData.listRaces(); } catch (e) { /* handled below */ }
    if (!races.length) {
      await intro;
      return fail("No races found. Run <code>python generate_demo.py</code> or " +
        "<code>python fetch_race.py --year 2024 --race Monza</code>, then serve this folder " +
        "with <code>python -m http.server 8000</code>.");
    }
    const picker = $("racePicker");
    picker.innerHTML = races.map((r) =>
      `<option value="${r.key}">${r.synthetic ? "🧪 " : "🏁 "}${window.PitLeaderboard.esc(r.name)}</option>`).join("");
    const wanted = new URLSearchParams(location.search).get("race");
    const first = races.find((r) => r.key === wanted) || races.find((r) => !r.synthetic) || races[0];
    picker.value = first.key;
    picker.addEventListener("change", () => {
      const url = new URL(location.href); url.searchParams.set("race", picker.value);
      history.replaceState(null, "", url);
      load(picker.value, false);
    });
    await load(first.key, true, intro);
  }

  function fail(html) {
    $("raceName").textContent = "No race loaded";
    $("leaderboard").innerHTML = `<p class="muted" style="padding:8px">${html}</p>`;
  }

  async function load(key, autoplay, intro) {
    const token = ++state.token;
    clock.pause();
    $("raceName").textContent = "Loading…";
    let race;
    try {
      race = await window.PitData.loadRace(key);
    } catch (e) {
      console.error(e);
      return fail(`Could not load race <b>${window.PitLeaderboard.esc(key)}</b>: ${window.PitLeaderboard.esc(e.message)}. ` +
        "Are you serving the folder over HTTP (<code>python -m http.server</code>)?");
    }
    if (token !== state.token) return;
    if (state.map) state.map.destroy();
    if (state.tyres) state.tyres.destroy();
    state.race = race;
    state.selected = new Set();
    state.lastT = null;

    const m = race.meta;
    $("raceName").textContent = m.name;
    $("raceSub").textContent = [m.circuit, m.country, m.date].filter(Boolean).join(" · ");
    $("demoBadge").hidden = !m.synthetic;
    $("lapTotal").textContent = race.totalLaps;
    document.title = `${m.name} · Pit Wall`;

    state.map = new window.PitTrackMap.TrackMap($("trackCanvas"), race, pick);
    state.board = new window.PitLeaderboard.Leaderboard($("leaderboard"), race, openCard);
    state.tyres = new window.PitTyres.TyreChart($("tyreCanvas"), race, openCard);
    window.PitTyres.legend($("tyreLegend"), race);
    setupH2H(race);

    clock.start = race.start;
    clock.end = race.duration;
    $("scrub").min = race.start; $("scrub").max = race.duration;
    clock.seek(race.start);
    if (intro) await intro;
    if (token !== state.token) return;
    if (autoplay) { clock.setSpeed(5); clock.play(); }
  }

  // --------------------------------------------------------------- frame
  clock.on((t, force) => {
    const race = state.race; if (!race) return;
    const jumped = force && state.lastT != null && Math.abs(t - state.lastT) > 5;
    const order = race.order(t);
    const sel = currentSelection();
    state.map.draw(t, order, sel);
    state.board.update(t, order, sel, jumped || state.lastT == null);

    const lap = race.raceLap(t, order);
    $("lapNow").textContent = t < 0 ? "–" : lap;
    $("clock").textContent = fmtClock(Math.max(0, t));
    const flag = $("flag");
    if (t >= race.finishTime()) { flag.hidden = false; flag.className = "flag chequered"; flag.textContent = "CHEQUERED FLAG"; }
    else if (t >= 0 && t < 8) { flag.hidden = false; flag.className = "flag green"; flag.textContent = "LIGHTS OUT"; }
    else if (t < 0) { flag.hidden = false; flag.className = "flag"; flag.textContent = "ON THE GRID"; }
    else flag.hidden = true;

    const scrub = $("scrub");
    if (document.activeElement !== scrub || force) scrub.value = t;
    $("playBtn").textContent = clock.playing ? "❚❚" : "▶";
    $("playBtn").setAttribute("aria-label", clock.playing ? "Pause" : "Play");
    document.querySelectorAll("[data-speed]").forEach((b) =>
      b.classList.toggle("active", Number(b.dataset.speed) === clock.speed));

    // pit stop toasts as they happen
    if (!jumped && state.lastT != null && t > state.lastT && clock.playing) {
      for (const p of race.pits) {
        if (p.t > t) break;
        if (p.t > state.lastT) toast(p);
      }
    }

    const now = performance.now();
    if (state.tab === "tyres" && (force || now - state.lastTyreDraw > 400)) {
      state.tyres.draw(t, sel); state.lastTyreDraw = now;
    }
    if (state.tab === "h2h" && (force || lap !== state.lastH2HLap)) {
      state.lastH2HLap = lap; drawH2H(t);
    }
    state.lastT = t;
  });

  function toast(p) {
    const d = state.race.byNumber.get(p.number); if (!d) return;
    const box = $("pitToast");
    const el = document.createElement("div");
    el.className = "toast";
    el.style.borderLeftColor = d.colour;
    const stop = p.stop ? ` · ${p.stop.toFixed(1)}s stop` : p.duration ? ` · ${p.duration.toFixed(1)}s in pit lane` : "";
    el.textContent = `🛞 ${d.code} pits, lap ${p.lap || "?"}${stop}`;
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => el.remove(), 4200);
  }

  // ------------------------------------------------------------ selection
  function currentSelection() {
    if (state.tab === "h2h") return new Set(state.h2h.filter((n) => n != null));
    return state.selected;
  }
  function pick(n) { openCard(n); }
  function openCard(n) {
    state.selected = new Set([n]);
    window.PitCharts.showDriverCard(state.race, n, clock.t);
    clock._emit(true);
  }

  // -------------------------------------------------------------- h2h tab
  function setupH2H(race) {
    const order = race.results.length ? race.results.map((r) => r.number) : race.drivers.map((d) => d.number);
    const opts = order.map((n) => {
      const d = race.byNumber.get(n);
      return d ? `<option value="${n}">${d.code} · ${window.PitLeaderboard.esc(d.name)}</option>` : "";
    }).join("");
    $("h2hA").innerHTML = opts; $("h2hB").innerHTML = opts;
    // default: the top two finishers
    state.h2h = [order[0], order[1]];
    $("h2hA").value = order[0]; $("h2hB").value = order[1];
  }
  function drawH2H(t) {
    const [a, b] = state.h2h;
    if (a != null && b != null) window.PitCharts.drawH2H(state.race, a, b, t);
  }

  // ------------------------------------------------------------- controls
  function bindControls() {
    $("playBtn").addEventListener("click", () => clock.toggle());
    $("back10").addEventListener("click", () => clock.seek(clock.t - 10));
    $("fwd10").addEventListener("click", () => clock.seek(clock.t + 10));
    $("scrub").addEventListener("input", (e) => clock.seek(Number(e.target.value)));
    document.querySelectorAll("[data-speed]").forEach((b) =>
      b.addEventListener("click", () => clock.setSpeed(Number(b.dataset.speed))));
    $("trackCanvas").addEventListener("click", () => {
      // clicking empty track clears the highlight (car clicks are handled by the map)
      setTimeout(() => { if ($("driverCard").hidden) { state.selected = new Set(); clock._emit(true); } }, 0);
    });
    document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
      state.tab = tab.dataset.tab;
      document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === tab));
      document.querySelectorAll(".tab-body").forEach((x) => { x.hidden = x.dataset.body !== state.tab; });
      state.lastH2HLap = null;
      clock._emit(true);
    }));
    $("h2hA").addEventListener("change", (e) => { state.h2h[0] = Number(e.target.value); clock._emit(true); });
    $("h2hB").addEventListener("change", (e) => { state.h2h[1] = Number(e.target.value); clock._emit(true); });
    window.addEventListener("resize", () => clock._emit(true));

    const speeds = [1, 2, 5, 10, 30];
    document.addEventListener("keydown", (e) => {
      if (e.target.closest("select, input, textarea") || !$("driverCard").hidden) return;
      if (e.code === "Space") { e.preventDefault(); clock.toggle(); }
      else if (e.key === "ArrowRight") clock.seek(clock.t + (e.shiftKey ? 60 : 10));
      else if (e.key === "ArrowLeft") clock.seek(clock.t - (e.shiftKey ? 60 : 10));
      else if (/^[1-5]$/.test(e.key)) clock.setSpeed(speeds[Number(e.key) - 1]);
    });
  }

  boot();
})();
