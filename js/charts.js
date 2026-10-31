/* Pit Wall: driver cards and head-to-head (lap-time and gap charts). */
(function () {
  "use strict";
  const { fmtLap } = window.PitReplay;
  const { esc } = window.PitLeaderboard;

  /** Simple multi-series line chart on a canvas. */
  function lineChart(canvas, opts) {
    const w = canvas.parentElement.clientWidth - (opts.inset || 0);
    const h = opts.height || 220;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const panels = opts.panels;
    const gapBetween = 26;
    const totalWeight = panels.reduce((s, p) => s + (p.weight || 1), 0);
    let top = 8;
    const L = 58, R = 12, usableH = h - 8 - 22 - gapBetween * (panels.length - 1);
    const xs = panels.flatMap((p) => p.series.flatMap((s) => s.points.map((q) => q[0])));
    const xmin = Math.min(...xs), xmax = Math.max(...xs);
    const X = (v) => L + ((v - xmin) / Math.max(1, xmax - xmin)) * (w - L - R);

    for (const p of panels) {
      const ph = usableH * (p.weight || 1) / totalWeight;
      const ys = p.series.flatMap((s) => s.points.map((q) => q[1])).filter(isFinite);
      if (!ys.length) { top += ph + gapBetween; continue; }
      let ymin = p.ymin != null ? p.ymin : Math.min(...ys), ymax = p.ymax != null ? p.ymax : Math.max(...ys);
      if (p.symmetric) { const m = Math.max(Math.abs(ymin), Math.abs(ymax), 0.5); ymin = -m; ymax = m; }
      if (ymax - ymin < 1e-6) { ymax += 1; ymin -= 1; }
      const pad = (ymax - ymin) * 0.08; ymin -= pad; ymax += pad;
      const Y = (v) => top + (1 - (Math.min(ymax, Math.max(ymin, v)) - ymin) / (ymax - ymin)) * ph;

      // grid & labels
      ctx.font = "11px 'Fira Code', monospace"; ctx.textAlign = "right"; ctx.fillStyle = "#8b8b9a";
      for (let i = 0; i <= 3; i++) {
        const v = ymin + ((ymax - ymin) * i) / 3, y = Y(v);
        ctx.fillStyle = "rgba(255,255,255,.06)"; ctx.fillRect(L, Math.round(y), w - L - R, 1);
        ctx.fillStyle = "#8b8b9a"; ctx.fillText(p.yFmt ? p.yFmt(v) : v.toFixed(1), L - 6, y + 4);
      }
      if (p.zero && ymin < 0 && ymax > 0) {
        ctx.fillStyle = "rgba(255,255,255,.25)"; ctx.fillRect(L, Math.round(Y(0)), w - L - R, 1);
      }
      if (p.title) {
        ctx.textAlign = "left"; ctx.fillStyle = "#cfcfd8"; ctx.font = "600 12px 'Titillium Web', sans-serif";
        ctx.fillText(p.title, L + 4, top + 12);
      }
      for (const s of p.series) {
        if (s.fill) {
          ctx.beginPath(); ctx.moveTo(X(s.points[0][0]), Y(0));
          for (const q of s.points) ctx.lineTo(X(q[0]), Y(q[1]));
          ctx.lineTo(X(s.points[s.points.length - 1][0]), Y(0)); ctx.closePath();
          ctx.fillStyle = s.fill; ctx.fill();
        }
        ctx.strokeStyle = s.colour; ctx.lineWidth = 2; ctx.lineJoin = "round";
        if (s.dash) ctx.setLineDash(s.dash);
        ctx.beginPath();
        s.points.forEach((q, i) => (i ? ctx.lineTo(X(q[0]), Y(q[1])) : ctx.moveTo(X(q[0]), Y(q[1]))));
        ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = s.colour;
        for (const q of s.points) {
          const clipped = q[1] > ymax || q[1] < ymin;
          ctx.beginPath(); ctx.arc(X(q[0]), Y(q[1]), clipped ? 3.5 : 2, 0, Math.PI * 2);
          clipped ? (ctx.strokeStyle = s.colour, ctx.stroke()) : ctx.fill();
        }
      }
      if (opts.marker != null) {
        ctx.fillStyle = "rgba(225,6,0,.7)"; ctx.fillRect(X(opts.marker), top, 1.5, ph);
      }
      top += ph + gapBetween;
    }
    // x axis
    ctx.textAlign = "center"; ctx.fillStyle = "#8b8b9a"; ctx.font = "11px 'Fira Code', monospace";
    const step = xmax - xmin > 50 ? 10 : 5;
    for (let v = Math.ceil(xmin / step) * step; v <= xmax; v += step) ctx.fillText(String(v), X(v), h - 6);
    ctx.textAlign = "left"; ctx.fillText(opts.xLabel || "lap", 4, h - 6);
  }

  /** y-range that ignores safety-car / pit outliers */
  function paceRange(values) {
    const v = values.filter(isFinite).sort((a, b) => a - b);
    if (!v.length) return {};
    const med = v[Math.floor(v.length / 2)];
    return { ymin: v[0], ymax: Math.min(v[v.length - 1], med * 1.08) };
  }

  // ------------------------------------------------------------ driver card
  function showDriverCard(race, n, t) {
    const d = race.byNumber.get(n); if (!d) return;
    const root = document.getElementById("driverCard");
    const card = root.querySelector(".driver-card");
    card.style.setProperty("--team", d.colour);
    document.getElementById("dcNumber").textContent = `#${d.number} · ${d.code}`;
    document.getElementById("dcName").textContent = d.name;
    document.getElementById("dcTeam").textContent = d.team;
    const photo = document.getElementById("dcPhoto");
    photo.innerHTML = "";
    const initials = d.name.split(/\s+/).map((s) => s[0]).slice(0, 2).join("");
    if (d.headshot) {
      const img = new Image(); img.alt = d.name; img.referrerPolicy = "no-referrer";
      img.onerror = () => { photo.textContent = initials; };
      img.src = d.headshot; photo.appendChild(img);
    } else photo.textContent = initials;

    const laps = race.lapTimes(n);
    const clean = laps.filter((l) => l.lap > 1 && !l.pit_out);
    const best = clean.reduce((b, l) => (!b || l.duration < b.duration ? l : b), null);
    const res = race.results.find((r) => r.number === n);
    const finishPos = res ? res.position : race.order(race.duration).indexOf(n) + 1;
    const grid = d.grid || race.position(n, race.start);
    const delta = grid && finishPos ? grid - finishPos : null;
    const stops = race.pits.filter((p) => p.number === n).length;
    const nowPos = race.order(t).indexOf(n) + 1;
    const stats = [
      ["Now", t >= 0 ? `P${nowPos}` : "–"],
      ["Grid → finish", grid && finishPos ? `P${grid} → P${finishPos}` : "–"],
      ["Gained / lost", delta == null ? "–" : (delta > 0 ? `▲ ${delta}` : delta < 0 ? `▼ ${-delta}` : "±0")],
      ["Fastest lap", best ? `${fmtLap(best.duration)} (L${best.lap})` : "–"],
      ["Pit stops", String(stops)],
      ["Result", res ? res.status : "–"],
    ];
    document.getElementById("dcStats").innerHTML = stats.map(([k, v]) =>
      `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join("");
    root.hidden = false;
    const r = paceRange(laps.map((l) => l.duration));
    requestAnimationFrame(() => {
      if (!laps.length) return;
      lineChart(document.getElementById("dcChart"), {
        height: 200,
        marker: t > 0 ? race.lapsDone(n, t) + 1 : null,
        panels: [{
          title: "Lap time", ymin: r.ymin, ymax: r.ymax, yFmt: (v) => fmtLap(v).slice(0, -2),
          series: [{ colour: d.colour, points: laps.map((l) => [l.lap, l.duration]) }],
        }],
      });
    });
    root.querySelector(".close").focus();
  }

  function bindDriverCard() {
    const root = document.getElementById("driverCard");
    const close = () => { root.hidden = true; };
    root.addEventListener("click", (e) => { if (e.target === root) close(); });
    root.querySelector(".close").addEventListener("click", close);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  }

  // ------------------------------------------------------------ head-to-head
  function drawH2H(race, a, b, t) {
    const da = race.byNumber.get(a), db = race.byNumber.get(b);
    const canvas = document.getElementById("h2hCanvas");
    const summary = document.getElementById("h2hSummary");
    if (!da || !db) return;
    // same team colours? make the second one dashed & lighter
    const cb = db.colour.toLowerCase() === da.colour.toLowerCase() ? "#ffffff" : db.colour;
    const la = race.lapTimes(a), lb = race.lapTimes(b);
    const lapsA = new Map(la.map((l) => [l.lap, l.duration]));
    const lapsB = new Map(lb.map((l) => [l.lap, l.duration]));

    const gap = [];
    const maxLap = Math.max(...la.map((l) => l.lap), ...lb.map((l) => l.lap), 1);
    for (let k = 1; k <= maxLap; k++) {
      const ta = race.crossing(a, k), tb = race.crossing(b, k);
      if (ta != null && tb != null) gap.push([k, tb - ta]);
    }
    let fasterA = 0, fasterB = 0, sumA = 0, sumB = 0, cnt = 0;
    for (const [k, va] of lapsA) {
      const vb = lapsB.get(k);
      if (vb == null || k === 1) continue;
      if (va < vb) fasterA++; else if (vb < va) fasterB++;
      const pa = la.find((l) => l.lap === k), pb = lb.find((l) => l.lap === k);
      if (!pa.pit_out && !pb.pit_out) { sumA += va; sumB += vb; cnt++; }
    }
    const final = gap.length ? gap[gap.length - 1][1] : null;
    const leader = final == null ? null : final >= 0 ? da : db;
    summary.innerHTML = [
      ["Laps faster", `${da.code} ${fasterA} · ${fasterB} ${db.code}`],
      ["Avg pace delta", cnt ? `${((sumA - sumB) / cnt >= 0 ? db.code : da.code)} by ${Math.abs((sumA - sumB) / cnt).toFixed(3)}s/lap` : "–"],
      ["Final gap", leader ? `${leader.code} ahead by ${Math.abs(final).toFixed(1)}s` : "–"],
    ].map(([k, v]) => `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join("");

    const r = paceRange([...lapsA.values(), ...lapsB.values()]);
    lineChart(canvas, {
      height: 340,
      marker: t > 0 ? race.raceLap(t, race.order(t)) : null,
      panels: [
        {
          title: `Lap times · ${da.code} vs ${db.code}`, weight: 1.2, ymin: r.ymin, ymax: r.ymax,
          yFmt: (v) => fmtLap(v).slice(0, -2),
          series: [
            { colour: da.colour, points: la.map((l) => [l.lap, l.duration]) },
            { colour: cb, dash: [5, 4], points: lb.map((l) => [l.lap, l.duration]) },
          ],
        },
        {
          title: `Gap: above 0 = ${da.code} ahead`, zero: true, symmetric: true,
          yFmt: (v) => (v > 0 ? "+" : "") + v.toFixed(1) + "s",
          series: [{ colour: "#f5b841", fill: "rgba(245,184,65,.12)", points: gap.length ? gap : [[1, 0]] }],
        },
      ],
    });
  }

  window.PitCharts = { lineChart, showDriverCard, bindDriverCard, drawH2H };
})();
