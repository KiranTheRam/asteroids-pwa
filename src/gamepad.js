// Physical controller support via the Gamepad API (works with Xbox/PS/MFi
// controllers, incl. on iOS Safari). Polled once per frame from the game loop.
// Left stick steers/thrusts; right stick aims + fires (twin-stick); a fire
// button (RT / A / RB) fires forward; Start pauses / confirms menus.
const DZ = 0.22;

export class GamepadInput {
  constructor() {
    this.prevStart = false;
    this.prevA = false;
    this.eventConnected = new Set();
    this.known = false;

    if (typeof window !== 'undefined') {
      window.addEventListener('gamepadconnected', (e) => {
        if (e.gamepad) {
          this.eventConnected.add(e.gamepad.index);
          this.known = true;
        }
      });
      window.addEventListener('gamepaddisconnected', (e) => {
        if (e.gamepad) this.eventConnected.delete(e.gamepad.index);
        this.known = this.eventConnected.size > 0;
      });
    }
  }

  // Returns null if no controller is present, else a normalized intent object.
  poll() {
    const gp = this._findPad();
    if (!gp) { this.prevStart = this.prevA = false; return null; }

    const ax = (i) => { const v = gp.axes[i] || 0; return Math.abs(v) < DZ ? 0 : v; };
    const btn = (i) => (gp.buttons[i] ? gp.buttons[i].pressed : false);

    const lx = ax(0), ly = ax(1);
    const [rx, ry] = this._rightStick(gp, ax);
    const fire = btn(7) || btn(0) || btn(5) || btn(1); // RT / A / RB / B
    const startNow = btn(9) || btn(8) || btn(11) || btn(10); // Start/Options or Select
    const aNow = btn(0);
    const startEdge = startNow && !this.prevStart;
    const aEdge = aNow && !this.prevA;
    this.prevStart = startNow; this.prevA = aNow;
    this.known = true;

    return {
      connected: true,
      lx, ly, rx, ry,
      lmag: Math.hypot(lx, ly),
      rmag: Math.hypot(rx, ry),
      fire, startEdge, aEdge,
    };
  }

  hasKnownController() { return this.known || !!this._findPad(); }

  _findPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let fallback = null;
    for (const p of pads) {
      if (!p) continue;
      if (p.connected || this.eventConnected.has(p.index)) return p;
      if (!fallback && this._looksLikeDirectInputPad(p)) fallback = p;
    }
    return fallback;
  }

  _looksLikeDirectInputPad(p) {
    if (!p.id) return false;
    return (p.axes && p.axes.length > 0) || (p.buttons && p.buttons.length > 0);
  }

  _rightStick(gp, ax) {
    if (gp.mapping === 'standard') return [ax(2), ax(3)];

    // DirectInput layouts are not standardized. Prefer the common pair, then
    // fall back to the next common variant without treating trigger axes as aim.
    const pairs = [[2, 3], [3, 4]];
    let best = [0, 0];
    let bestMag = 0;
    for (const [x, y] of pairs) {
      const rx = ax(x), ry = ax(y);
      const mag = Math.hypot(rx, ry);
      if (mag > bestMag) { best = [rx, ry]; bestMag = mag; }
    }
    return best;
  }
}
