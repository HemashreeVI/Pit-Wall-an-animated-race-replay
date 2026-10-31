/* Pit Wall: animated leaderboard. Rows slide to their new slot on every overtake. */
(function () {
  "use strict";

  const ROW_H = 34;
  const SHORT = { SOFT: "S", MEDIUM: "M", HARD: "H", INTERMEDIATE: "I", WET: "W" };

  class Leaderboard {
    constructor(el, race, onPick) {
      this.el = el; this.race = race; this.onPick = onPick;
      this.rows = new Map();
      this.lastSlot = new Map();
      el.innerHTML = "";
      el.style.height = race.drivers.length * ROW_H + "px";
      for (const d of race.drivers) {
        const row = document.createElement("div");
        row.className = "lb-row";
        row.tabIndex = 0;
        row.setAttribute("role", "button");
        row.innerHTML = `<span class="pos"></span><span class="bar" style="background:${d.colour}"></span>` +
          `<span class="code">${esc(d.code)}</span><span class="team">${esc(d.team)}</span>` +
          `<span class="tyre"></span><span class="gap"></span>`;
        row.setAttribute("aria-label", `${d.name}, ${d.team}`);
        row.addEventListener("click", () => onPick(d.number));
        row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(d.number); } });
        el.appendChild(row);
        this.rows.set(d.number, {
          row, pos: row.querySelector(".pos"), tyre: row.querySelector(".tyre"),
          gap: row.querySelector(".gap"), cache: {},
        });
      }
    }

    update(t, order, selected, jumped) {
      const race = this.race;
      const finished = t >= race.finishTime();
      order.forEach((n, slot) => {
        const r = this.rows.get(n);
        if (!r) return;
        const prev = this.lastSlot.get(n);
        if (prev !== slot) {
          r.row.style.transform = `translateY(${slot * ROW_H}px)`;
          if (prev != null && !jumped && t > 0) {
            r.row.classList.remove("gained", "lost");
            void r.row.offsetWidth; // restart animation
            r.row.classList.add(slot < prev ? "gained" : "lost");
          }
          this.lastSlot.set(n, slot);
        }
        const retired = race.retired(n, t);
        const pit = !retired && race.inPit(n, t);
        set(r, "pos", String(slot + 1));
        r.row.classList.toggle("out", retired);
        r.row.classList.toggle("in-pit", !!pit);
        r.row.classList.toggle("selected", selected.has(n));
        r.row.classList.toggle("fastest", !!(race.fastest && race.fastest.number === n && t >= race.fastest.t));

        // tyre
        const ty = race.tyreAt(n, t);
        const tyKey = ty ? ty.compound + ty.age : "";
        if (r.cache.ty !== tyKey) {
          r.cache.ty = tyKey;
          r.tyre.className = "tyre " + (ty ? ty.compound : "");
          r.tyre.innerHTML = ty ? `<span>${SHORT[ty.compound] || "?"}</span>` : "";
          r.tyre.title = ty ? `${ty.compound.toLowerCase()} · ${ty.age} laps old` : "";
        }

        // gap
        let text;
        if (retired) text = "OUT";
        else if (pit) text = "PIT";
        else if (t < 0) text = slot === 0 ? "GRID" : "";
        else if (slot === 0) text = finished ? "WINNER" : `LAP ${race.raceLap(t, order)}`;
        else {
          const g = race.gap(n, t);
          if (g == null) text = "";
          else if (typeof g === "string") text = g.replace(/\s*LAPS?$/, "L").replace(/^\+?/, "+");
          else text = "+" + g.toFixed(g < 10 ? 3 : 1);
        }
        if (r.cache.gap !== text) { r.cache.gap = text; r.gap.textContent = text; }
      });
    }
  }

  function set(r, key, value) {
    if (r.cache[key] !== value) { r.cache[key] = value; r[key].textContent = value; }
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  window.PitLeaderboard = { Leaderboard, esc };
})();
