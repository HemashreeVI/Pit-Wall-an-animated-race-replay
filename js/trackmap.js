/* Pit Wall: draws the circuit and every car as a glowing team-coloured dot. */
(function () {
  "use strict";

  class TrackMap {
    constructor(canvas, race, onPick) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.race = race;
      this.onPick = onPick;
      this.base = document.createElement("canvas");
      this.screen = new Map(); // number -> last drawn {x,y}
      this._resize = this.resize.bind(this);
      this._ro = new ResizeObserver(this._resize);
      this._ro.observe(canvas.parentElement);
      canvas.addEventListener("click", (e) => this._click(e));
      canvas.addEventListener("mousemove", (e) => this._hover(e));
      this.hover = null;
      this.resize();
    }

    destroy() { this._ro.disconnect(); }

    resize() {
      const box = this.canvas.parentElement.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = Math.max(200, box.width); this.h = Math.max(200, box.height);
      for (const c of [this.canvas, this.base]) {
        c.width = Math.round(this.w * dpr); c.height = Math.round(this.h * dpr);
      }
      this.dpr = dpr;
      this.canvas.style.width = this.w + "px"; this.canvas.style.height = this.h + "px";

      const b = this.race.bounds, bw = b.maxX - b.minX || 1, bh = b.maxY - b.minY || 1;
      // rotate 90° when that fits the panel better
      this.rotate = (bh > bw) !== (this.h > this.w) && Math.abs(bw - bh) / Math.max(bw, bh) > 0.15;
      const tw = this.rotate ? bh : bw, th = this.rotate ? bw : bh;
      const pad = 34;
      this.scale = Math.min((this.w - pad * 2) / tw, (this.h - pad * 2) / th);
      this.cx = (b.minX + b.maxX) / 2; this.cy = (b.minY + b.maxY) / 2;
      this._drawBase();
      if (this._lastArgs) this.draw(...this._lastArgs);
    }

    project(x, y) {
      let dx = (x - this.cx) * this.scale, dy = -(y - this.cy) * this.scale; // flip y: GPS y points up
      if (this.rotate) [dx, dy] = [-dy, dx];
      return [this.w / 2 + dx, this.h / 2 + dy];
    }

    _drawBase() {
      const ctx = this.base.getContext("2d");
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.w, this.h);
      const pts = this.race.track.map((p) => this.project(p[0], p[1]));
      if (pts.length < 2) return;
      const path = new Path2D();
      path.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) path.lineTo(p[0], p[1]);
      path.closePath();
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(225,6,0,.10)"; ctx.lineWidth = 26; ctx.stroke(path);
      ctx.strokeStyle = "#2a2a36"; ctx.lineWidth = 14; ctx.stroke(path);
      ctx.strokeStyle = "#3b3b4b"; ctx.lineWidth = 9; ctx.stroke(path);
      ctx.setLineDash([2, 10]); ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.lineWidth = 1; ctx.stroke(path);
      ctx.setLineDash([]);

      // chequered start/finish line, perpendicular to the track direction
      const [a, b] = [pts[0], pts[Math.min(3, pts.length - 1)]];
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) + Math.PI / 2;
      ctx.save(); ctx.translate(a[0], a[1]); ctx.rotate(ang);
      for (let i = -3; i < 3; i++) for (let j = 0; j < 2; j++) {
        ctx.fillStyle = (i + j) % 2 ? "#fff" : "#111";
        ctx.fillRect(i * 3, -3 + j * 3, 3, 3);
      }
      ctx.restore();
    }

    draw(t, order, selected) {
      this._lastArgs = [t, order, selected];
      const ctx = this.ctx, race = this.race;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.w, this.h);
      ctx.drawImage(this.base, 0, 0, this.w, this.h);
      const anySel = selected && selected.size > 0;

      // draw back-markers first so the leader is on top
      const list = order.slice().reverse();
      this.screen.clear();
      for (const n of list) {
        const d = race.byNumber.get(n);
        const p = race.carXY(n, t);
        if (!d || !p) continue;
        const retired = race.retired(n, t);
        const [x, y] = this.project(p.x, p.y);
        this.screen.set(n, { x, y });
        const dim = (anySel && !selected.has(n)) || retired;

        // short fading trail
        if (!retired && !p.stale) {
          ctx.lineCap = "round";
          let prev = [x, y];
          for (let k = 1; k <= 6; k++) {
            const q = race.carXY(n, t - k * 0.35);
            if (!q) break;
            const s = this.project(q.x, q.y);
            if (Math.hypot(s[0] - prev[0], s[1] - prev[1]) > 60) break;
            ctx.strokeStyle = hexA(d.colour, (dim ? 0.15 : 0.5) * (1 - k / 7));
            ctx.lineWidth = 5 - k * 0.5;
            ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(s[0], s[1]); ctx.stroke();
            prev = s;
          }
        }

        const r = selected && selected.has(n) ? 8 : 6;
        ctx.globalAlpha = dim ? 0.35 : 1;
        if (!dim) { ctx.shadowColor = d.colour; ctx.shadowBlur = 14; }
        ctx.fillStyle = d.colour;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 1.5; ctx.strokeStyle = n === order[0] ? "#f5b841" : "rgba(0,0,0,.7)";
        ctx.stroke();
        if (race.inPit(n, t)) {
          ctx.strokeStyle = "#f5b841"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x, y, r + 4 + Math.sin(t * 8) * 1.5, 0, Math.PI * 2); ctx.stroke();
        }

        const showLabel = !anySel || selected.has(n) || n === this.hover;
        if (showLabel) {
          ctx.font = "600 11px 'Fira Code', monospace";
          const label = d.code, tw = ctx.measureText(label).width;
          ctx.fillStyle = "rgba(10,10,15,.75)";
          roundRect(ctx, x + 9, y - 17, tw + 8, 15, 4); ctx.fill();
          ctx.fillStyle = dim ? "#888" : "#fff";
          ctx.fillText(label, x + 13, y - 6);
        }
        ctx.globalAlpha = 1;
      }
    }

    _nearest(e) {
      const r = this.canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      let best = null, bd = 18;
      for (const [n, p] of this.screen) {
        const dd = Math.hypot(p.x - mx, p.y - my);
        if (dd < bd) { bd = dd; best = n; }
      }
      return best;
    }
    _click(e) { const n = this._nearest(e); if (n != null && this.onPick) this.onPick(n); }
    _hover(e) {
      const n = this._nearest(e);
      if (n !== this.hover) {
        this.hover = n;
        this.canvas.style.cursor = n != null ? "pointer" : "default";
        if (this._lastArgs) this.draw(...this._lastArgs);
      }
    }
  }

  function hexA(hex, a) {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  window.PitTrackMap = { TrackMap, hexA, roundRect };
})();
