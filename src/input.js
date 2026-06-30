// Zone-based touch input for the control deck:
//   left deck zone  -> fixed thumbstick (turn + thrust)
//   right deck zone -> fire (tap = shot, hold = autofire)
//   anywhere        -> counts as a menu tap when not playing
// Works with mouse too for desktop testing. `layout` is a live object owned by main.
import { CFG, clamp } from './config.js';
import { settings } from './settings.js';

export class Input {
  constructor(canvas, layout) {
    this.canvas = canvas;
    this.layout = layout;
    this.pointers = new Map(); // id -> {x,y,role,ax,ay}
    this.buttons = [];         // UI hit-zones, checked first

    this.fireToggleQueue = 0;  // fire-pad taps since last consume (each flips autofire)
    this.menuTaps = 0;         // taps used to advance menus
    this.fireActive = false;   // a finger is down in the fire zone (for press feedback)
    // ox/oy = stick centre, x/y = current finger (screen/canvas px)
    this.steer = { active: false, angle: 0, thrust: 0, ox: 0, oy: 0, x: 0, y: 0 };
    // twin-stick aim (right pad): active while touched; hasDir once dragged
    this.aim = { active: false, hasDir: false, angle: 0, ox: 0, oy: 0, x: 0, y: 0 };

    const opts = { passive: false };
    canvas.addEventListener('pointerdown', this._down.bind(this), opts);
    canvas.addEventListener('pointermove', this._move.bind(this), opts);
    canvas.addEventListener('pointerup', this._up.bind(this), opts);
    canvas.addEventListener('pointercancel', this._up.bind(this), opts);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  addButton(rect, cb) { this.buttons.push({ rect, cb }); }

  _inRect(x, y, r) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

  _down(e) {
    e.preventDefault();
    const x = e.clientX, y = e.clientY;

    // UI buttons take priority and never become game input.
    for (const b of this.buttons) {
      if (this._inRect(x, y, b.rect())) { b.cb(); return; }
    }

    this.menuTaps++; // any non-button press advances menus

    const L = this.layout;
    let role = 'none', ax = 0, ay = 0;
    if (this._inRect(x, y, L.steer.zone)) {
      role = 'steer'; ax = L.steer.cx; ay = L.steer.cy; // fixed-centre stick
    } else if (this._inRect(x, y, L.fire.zone)) {
      if (settings.twinStick) {
        role = 'aim'; ax = L.fire.cx; ay = L.fire.cy; // fixed-centre aim stick
      } else {
        role = 'fire';
        this.fireToggleQueue++; // each press toggles autofire on/off
      }
    }
    this.pointers.set(e.pointerId, { x, y, role, ax, ay });
  }

  _move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    p.x = e.clientX; p.y = e.clientY;
  }

  _up(e) {
    if (this.pointers.has(e.pointerId)) e.preventDefault();
    this.pointers.delete(e.pointerId);
  }

  update(dt) {
    this.fireActive = false;
    let steerP = null, aimP = null;
    for (const p of this.pointers.values()) {
      if (p.role === 'steer') steerP = p;     // last finger in the zone wins
      else if (p.role === 'aim') aimP = p;
      else if (p.role === 'fire') this.fireActive = true;
    }

    if (steerP) {
      const r = this.layout.steer.r;
      const dx = steerP.x - steerP.ax, dy = steerP.y - steerP.ay;
      const drag = Math.hypot(dx, dy);
      this.steer.active = true;
      this.steer.angle = Math.atan2(dy, dx);
      this.steer.thrust = clamp((drag - CFG.steerDeadzone) / (r - CFG.steerDeadzone), 0, 1);
      this.steer.ox = steerP.ax; this.steer.oy = steerP.ay;
      this.steer.x = steerP.x; this.steer.y = steerP.y;
    } else {
      this.steer.active = false;
      this.steer.thrust = 0;
    }

    if (aimP) {
      const dx = aimP.x - aimP.ax, dy = aimP.y - aimP.ay;
      this.aim.active = true;
      this.aim.hasDir = Math.hypot(dx, dy) > CFG.steerDeadzone;
      if (this.aim.hasDir) this.aim.angle = Math.atan2(dy, dx);
      this.aim.ox = aimP.ax; this.aim.oy = aimP.ay;
      this.aim.x = aimP.x; this.aim.y = aimP.y;
    } else {
      this.aim.active = false;
      this.aim.hasDir = false;
    }
  }

  consumeFireToggles() { const n = this.fireToggleQueue; this.fireToggleQueue = 0; return n; }
  consumeMenuTap() { const n = this.menuTaps; this.menuTaps = 0; return n; }

  reset() {
    this.pointers.clear();
    this.fireToggleQueue = 0;
    this.menuTaps = 0;
    this.fireActive = false;
    this.steer.active = false;
    this.steer.thrust = 0;
    this.aim.active = false;
    this.aim.hasDir = false;
  }
}
