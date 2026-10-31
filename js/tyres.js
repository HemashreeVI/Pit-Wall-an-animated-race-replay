/* Pit Wall: the whole field's tyre stints at a glance. */
(function () {
  "use strict";

  const COLOURS = {
    SOFT: "#ff3333", MEDIUM: "#ffd400", HARD: "#eeeeee",
    INTERMEDIATE: "#39b54a", WET: "#2b7bff", UNKNOWN: "#666677",
  };

  function legend(el, race) {
    const used = new Set();
    for (const list of race.stints.values()) for (const s of list) used.add(s.compound in COLOURS ? s.compound : "UNKNOWN");
    el.innerHTML = Object.keys(COLOURS).filter((c) => used.has(c))
      .map((c) => `<span><i style="background:${COLOURS[c]}"></i>${c.toLowerCase()}</span>`).join("") +
      `<span><i style="background:transparent;border:2px solid #f5b841;border-radius:50%"></i>pit stop</span>`;
  }

  class TyreChart {
    constructor(canvas, race, onPick) {
      this.canvas = canvas; this.race = race; this.onPick = onPick;
      this.rowH = 22; this.top = 26; this.left = 54; this.right = 16;
      const res = race.results.map((r) => r.number);
      this.order = res.length ? res.concat(race.drivers.map((d) => d.number).filter((n) => !res.includes(n)))
        : race.order(race.duration);
      this._ro = new ResizeObserver(() => this.draw(this.t || 0));
      this._ro.observe(canvas.parentElement);
      canvas.addEventListener("click", (e) => {
        const r = canvas.getBoundingClientRect();
        const i = Math.floor((e.clientY - r.top - this.top) / this.rowH);
        if (i >= 0 && i < this.order.length) onPick(this.order[i]);
      });
    }
    destroy() { this._ro.disconnect(); }

    draw(t, selected) {
      this.t = t; if (selected) this.selected = selected;
      const race = this.race, c = this.canvas;
      const w = c.parentElement.clientWidth, h = this.top + this.order.length * this.rowH + 8;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
        c.style.height = h + "px";
      }
      const ctx = c.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const laps = Math.max(1, race.totalLaps);
      const x = (lap) => this.left + ((lap - 1) / laps) * (w - this.left - this.right);

      // lap grid
      ctx.font = "11px 'Fira Code', monospace"; ctx.fillStyle = "#8b8b9a"; ctx.textAlign = "center";
      const step = laps > 50 ? 10 : 5;
      for (let l = step; l <= laps; l += step) {
        ctx.fillText(String(l), x(l + 0.5), 14);
        ctx.fillStyle = "rgba(255,255,255,.05)"; ctx.fillRect(x(l + 1), this.top - 4, 1, h - this.top);
        ctx.fillStyle = "#8b8b9a";
      }
      ctx.textAlign = "left";

      const sel = this.selected || new Set();
      this.order.forEach((n, i) => {
        const d = race.byNumber.get(n); if (!d) return;
        const y = this.top + i * this.rowH;
        const dim = sel.size && !sel.has(n);
        ctx.globalAlpha = dim ? 0.35 : 1;
        ctx.fillStyle = d.colour; ctx.fillRect(4, y + 4, 3, this.rowH - 8);
        ctx.fillStyle = "#f2f2f5"; ctx.font = "600 12px 'Titillium Web', sans-serif";
        ctx.fillText(d.code, 12, y + 15);
        const stints = race.stints.get(n) || [];
        const maxLap = race.lapsDone(n, Infinity) || laps;
        stints.forEach((s, si) => {
          const a = s.lap_start || 1;
          const b = Math.min(s.lap_end || maxLap, maxLap);
          if (b < a) return;
          const x0 = x(a), x1 = x(b + 1);
          ctx.fillStyle = COLOURS[s.compound] || COLOURS.UNKNOWN;
          ctx.globalAlpha = (dim ? 0.3 : 0.9);
          roundRect(ctx, x0 + 1, y + 5, Math.max(2, x1 - x0 - 2), this.rowH - 10, 4); ctx.fill();
          ctx.globalAlpha = dim ? 0.35 : 1;
          if (si > 0) {
            ctx.strokeStyle = "#f5b841"; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(x0, y + this.rowH / 2, 4, 0, Math.PI * 2); ctx.stroke();
          }
        });
        if (!stints.length) {
          ctx.fillStyle = "#555"; ctx.fillText("no stint data", this.left, y + 15);
        }
      });
      ctx.globalAlpha = 1;

      // "now" line at the leader's current lap
      if (t > 0) {
        const order = race.order(t);
        const done = race.lapsDone(order[0], t);
        const lead = (race.laps.get(order[0]) || []).find((l) => l.lap === done + 1);
        const frac = lead && lead.duration ? Math.min(1, Math.max(0, (t - lead.t_start) / lead.duration)) : 0;
        const nx = x(Math.min(laps + 1, done + 1 + frac));
        ctx.fillStyle = "#e10600"; ctx.fillRect(nx - 1, this.top - 8, 2, h - this.top + 4);
        ctx.beginPath(); ctx.moveTo(nx - 5, this.top - 10); ctx.lineTo(nx + 5, this.top - 10); ctx.lineTo(nx, this.top - 4); ctx.fill();
      }
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  window.PitTyres = { TyreChart, legend, COLOURS };
})();
