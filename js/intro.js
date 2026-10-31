/* Pit Wall: cinematic intro. A car streaks past, five lights, lights out. */
(function () {
  "use strict";

  function playIntro() {
    const el = document.getElementById("intro");
    const lights = el.querySelectorAll(".lights span");
    const timers = [];
    let finished = false;
    return new Promise((resolve) => {
      const finish = () => {
        if (finished) return;
        finished = true;
        timers.forEach(clearTimeout);
        el.classList.add("done");
        setTimeout(() => { el.hidden = true; }, 700);
        resolve();
      };
      el.querySelector(".intro-skip").addEventListener("click", finish);
      el.addEventListener("click", (e) => { if (e.target === el) finish(); });
      document.addEventListener("keydown", function onKey(e) {
        if (e.key === "Escape" || e.key === "Enter") { document.removeEventListener("keydown", onKey); finish(); }
      });
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { finish(); return; }

      const at = (ms, fn) => timers.push(setTimeout(fn, ms));
      at(50, () => el.classList.add("run"));
      at(700, () => el.classList.add("title"));
      lights.forEach((l, i) => at(900 + i * 380, () => l.classList.add("on")));
      at(900 + 5 * 380 + 500, () => el.querySelector(".lights").classList.add("out"));
      at(900 + 5 * 380 + 900, finish);
    });
  }

  window.PitIntro = { playIntro };
})();
