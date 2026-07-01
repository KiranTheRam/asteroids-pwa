// Physical controller support via the Gamepad API (works with Xbox/PS/MFi
// controllers, incl. on iOS Safari). Polled once per frame from the game loop.
// Left stick steers/thrusts; right stick aims + fires (twin-stick); a fire
// button (RT / A / RB) fires forward; Start pauses / confirms menus.
const DZ = 0.22;

export class GamepadInput {
  constructor() { this.prevStart = false; this.prevA = false; }

  // Returns null if no controller is present, else a normalized intent object.
  poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) { if (p && p.connected) { gp = p; break; } }
    if (!gp) { this.prevStart = this.prevA = false; return null; }

    const ax = (i) => { const v = gp.axes[i] || 0; return Math.abs(v) < DZ ? 0 : v; };
    const btn = (i) => (gp.buttons[i] ? gp.buttons[i].pressed : false);

    const lx = ax(0), ly = ax(1), rx = ax(2), ry = ax(3);
    const fire = btn(7) || btn(0) || btn(5); // RT / A / RB
    const startNow = btn(9) || btn(8);       // Start/Options or Select
    const aNow = btn(0);
    const startEdge = startNow && !this.prevStart;
    const aEdge = aNow && !this.prevA;
    this.prevStart = startNow; this.prevA = aNow;

    return {
      connected: true,
      lx, ly, rx, ry,
      lmag: Math.hypot(lx, ly),
      rmag: Math.hypot(rx, ry),
      fire, startEdge, aEdge,
    };
  }
}
