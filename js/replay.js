/* Pit Wall: the race clock (play, pause, seek, speed). */
(function () {
  "use strict";

  class RaceClock {
    constructor(start, end) {
      this.start = start;
      this.end = end;
      this.t = start;
      this.speed = 1;
      this.playing = false;
      this._listeners = [];
      this._last = null;
      this._loop = this._loop.bind(this);
      requestAnimationFrame(this._loop);
    }
    on(fn) { this._listeners.push(fn); }
    _emit(force) { for (const fn of this._listeners) fn(this.t, force); }
    play() {
      if (this.t >= this.end) this.t = this.start;
      this.playing = true; this._last = null; this._emit(true);
    }
    pause() { this.playing = false; this._emit(true); }
    toggle() { this.playing ? this.pause() : this.play(); }
    seek(t) { this.t = Math.max(this.start, Math.min(this.end, t)); this._emit(true); }
    setSpeed(s) { this.speed = s; this._emit(true); }
    _loop(now) {
      if (this.playing) {
        if (this._last != null) {
          const dt = Math.min(0.1, (now - this._last) / 1000); // clamp after tab switch
          this.t += dt * this.speed;
          if (this.t >= this.end) { this.t = this.end; this.playing = false; }
        }
        this._last = now;
        this._emit(false);
      } else {
        this._last = null;
      }
      requestAnimationFrame(this._loop);
    }
  }

  function fmtClock(t) {
    const neg = t < 0; t = Math.abs(t);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
    const mm = String(m).padStart(2, "0"), ss = String(s).padStart(2, "0");
    return (neg ? "-" : "") + (h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`);
  }

  function fmtLap(sec) {
    if (sec == null || !isFinite(sec)) return "–";
    const m = Math.floor(sec / 60), s = sec - m * 60;
    return `${m}:${s.toFixed(3).padStart(6, "0")}`;
  }

  window.PitReplay = { RaceClock, fmtClock, fmtLap };
})();
