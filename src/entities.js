// All game entities. Each has update(dt, world) and draw(ctx). World = {w, h}.
import { CFG, COLORS, POWERUPS, TAU, rand, randInt, clamp, lerp, angleDelta } from './config.js';
import { glow, noGlow, strokePoly, strokeCircle, fillDot } from './render.js';
import { settings } from './settings.js';

// Toroidal wrap.
export function wrap(e, w, h, pad = 0) {
  if (e.x < -pad) e.x = w + pad;
  else if (e.x > w + pad) e.x = -pad;
  if (e.y < -pad) e.y = h + pad;
  else if (e.y > h + pad) e.y = -pad;
}

export class Ship {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.angle = -Math.PI / 2; // pointing up
    this.radius = CFG.shipRadius;
    this.invuln = CFG.respawnInvuln;
    this.thrusting = false;
    this.thrustPuff = 0;
  }

  update(dt, world, steer) {
    this.thrusting = false;
    if (steer.active && steer.thrust > 0) {
      this.angle += angleDelta(this.angle, steer.angle) * clamp(CFG.turnLerp * settings.turn * dt, 0, 1);
      const a = CFG.shipThrust * settings.thruster * steer.thrust;
      this.vx += Math.cos(this.angle) * a * dt;
      this.vy += Math.sin(this.angle) * a * dt;
      this.thrusting = steer.thrust > 0.15;
    }
    // friction
    const f = Math.pow(CFG.shipFriction, dt);
    this.vx *= f; this.vy *= f;
    // speed cap (maxSpeed can be overridden by roguelite upgrade)
    const maxSp = this.maxSpeed ?? CFG.shipMaxSpeed;
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > maxSp) {
      this.vx = (this.vx / sp) * maxSp;
      this.vy = (this.vy / sp) * maxSp;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    wrap(this, world.w, world.h, this.radius);
    if (this.invuln > 0) this.invuln -= dt;
    this.thrustPuff -= dt;
  }

  // Local-space outline transformed to world.
  outline() {
    const r = this.radius;
    const local = [
      { x: r * 1.4, y: 0 },
      { x: -r, y: -r * 0.8 },
      { x: -r * 0.55, y: 0 },
      { x: -r, y: r * 0.8 },
    ];
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    return local.map((p) => ({
      x: this.x + p.x * c - p.y * s,
      y: this.y + p.x * s + p.y * c,
    }));
  }

  draw(ctx, shielded) {
    // blink while invulnerable
    if (this.invuln > 0 && Math.floor(this.invuln * 10) % 2 === 0) return;

    if (this.thrusting) {
      const r = this.radius;
      const c = Math.cos(this.angle), s = Math.sin(this.angle);
      const flameLen = lerp(0.9, 1.7, Math.random());
      const flame = [
        { x: -r * 0.55, y: -r * 0.45 },
        { x: -r * flameLen, y: 0 },
        { x: -r * 0.55, y: r * 0.45 },
      ].map((p) => ({ x: this.x + p.x * c - p.y * s, y: this.y + p.x * s + p.y * c }));
      glow(ctx, COLORS.thrust, 12);
      strokePoly(ctx, flame, { color: COLORS.thrust, width: 2, close: false });
    }

    glow(ctx, COLORS.fg);
    strokePoly(ctx, this.outline(), { color: COLORS.fg, width: 2 });

    if (shielded) {
      glow(ctx, COLORS.shield, 14);
      strokeCircle(ctx, this.x, this.y, this.radius * 1.9, { color: COLORS.shield, width: 2 });
    }
    noGlow(ctx);
  }
}

export class Asteroid {
  constructor(x, y, tier) {
    this.tier = tier;
    const t = CFG.astTiers[tier];
    this.radius = t.radius;
    this.score = t.score;
    this.x = x; this.y = y;
    const dir = rand(0, TAU);
    const sp = t.speed * rand(0.7, 1.3);
    this.vx = Math.cos(dir) * sp;
    this.vy = Math.sin(dir) * sp;
    this.rot = rand(0, TAU);
    this.spin = rand(-1, 1) * 0.8;
    // jagged polygon offsets
    const n = randInt(9, 13);
    this.verts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const rr = this.radius * rand(0.72, 1.12);
      this.verts.push({ a, r: rr });
    }
    this.volatile = false; // explosive-asteroid modifier
    this.kind = 'normal'; // special type: 'crystal' | 'iron' | 'ice' | 'parasite'
    this.hp = 1;
    this.t = rand(0, Math.PI * 2); // per-rock clock for animated effects
  }

  update(dt, world) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.rot += this.spin * dt;
    this.t += dt;
    wrap(this, world.w, world.h, CFG.astWrapPad);
  }

  outline() {
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    return this.verts.map((v) => {
      const px = Math.cos(v.a) * v.r, py = Math.sin(v.a) * v.r;
      return { x: this.x + px * c - py * s, y: this.y + px * s + py * c };
    });
  }

  draw(ctx) {
    // No glow here: asteroids are the most numerous object on screen and
    // shadowBlur per-shape is what pushes frame time past the 8.3ms ProMotion
    // needs to stay at 120Hz. They still read as bright white vector rocks.
    const color = this.kind === 'crystal' ? COLORS.crystal
                : this.kind === 'iron'    ? COLORS.iron
                : this.kind === 'ice'     ? COLORS.ice
                : this.kind === 'parasite'? COLORS.fg
                : COLORS.fg;
    strokePoly(ctx, this.outline(), { color, width: 2 });

    if (this.volatile) {
      strokeCircle(ctx, this.x, this.y, this.radius * 0.42, { color: COLORS.volatile, width: 2 });
    }

    // type-specific interior markers
    const r = this.radius;
    if (this.kind === 'crystal') {
      // small inner diamond
      const s = r * 0.32;
      const pts = [{ x: 0, y: -s }, { x: s, y: 0 }, { x: 0, y: s }, { x: -s, y: 0 }]
        .map((p) => ({ x: this.x + p.x, y: this.y + p.y }));
      strokePoly(ctx, pts, { color: COLORS.crystal, width: 1.5 });
    } else if (this.kind === 'iron') {
      // dented inner circle (second hit indicator fades when at full hp)
      const alpha = this.hp >= 2 ? 0.7 : 0.3;
      ctx.globalAlpha = alpha;
      strokeCircle(ctx, this.x, this.y, r * 0.38, { color: COLORS.iron, width: 1.5 });
      ctx.globalAlpha = 1;
    } else if (this.kind === 'ice') {
      // simple crosshair
      const s = r * 0.28;
      ctx.beginPath();
      ctx.moveTo(this.x - s, this.y); ctx.lineTo(this.x + s, this.y);
      ctx.moveTo(this.x, this.y - s); ctx.lineTo(this.x, this.y + s);
      ctx.strokeStyle = COLORS.ice; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.7; ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (this.kind === 'parasite') {
      // pulsing inner dot
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(this.t * 4);
      fillDot(ctx, this.x, this.y, r * 0.22, COLORS.parasite);
      ctx.globalAlpha = 1;
    }
  }
}

export class Bullet {
  // opts: { fromEnemy, speed, life, pierce, homing, color }
  constructor(x, y, angle, opts = {}) {
    const fromEnemy = !!opts.fromEnemy;
    const sp = opts.speed != null ? opts.speed : (fromEnemy ? CFG.ufoBulletSpeed : CFG.bulletSpeed);
    this.x = x; this.y = y;
    this.angle = angle;
    this.vx = Math.cos(angle) * sp;
    this.vy = Math.sin(angle) * sp;
    this.speed = sp;
    this.life = opts.life != null ? opts.life : (fromEnemy ? 2.2 : CFG.bulletLife);
    this.fromUfo = fromEnemy;      // "enemy bullet" — kept name for collisions
    this.pierce = !!opts.pierce;
    this.homing = !!opts.homing;
    this.color = opts.color || null;
    this.radius = CFG.bulletRadius;
  }

  update(dt, world) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    wrap(this, world.w, world.h, 4);
    this.life -= dt;
  }

  get dead() { return this.life <= 0; }

  draw(ctx) {
    const color = this.color ||
      (this.fromUfo ? COLORS.ufoBullet
        : this.pierce ? COLORS.pierce
        : this.homing ? COLORS.homing : COLORS.fg);
    // Cheap fake-glow: a faint wide dot + a solid core, no shadowBlur.
    ctx.globalAlpha = 0.35;
    fillDot(ctx, this.x, this.y, this.radius * 2.2, color);
    ctx.globalAlpha = 1;
    fillDot(ctx, this.x, this.y, this.radius, color);
  }
}

export class Ufo {
  constructor(world) {
    this.radius = CFG.ufoRadius;
    const fromLeft = Math.random() < 0.5;
    this.x = fromLeft ? -this.radius * 2 : world.w + this.radius * 2;
    this.y = rand(world.h * 0.15, world.h * 0.85);
    this.vx = (fromLeft ? 1 : -1) * CFG.ufoSpeed;
    this.vy = 0;
    this.fireTimer = CFG.ufoFireEvery;
    this.bob = rand(0, TAU);
    this.dead = false;
  }

  update(dt, world) {
    this.bob += dt * 2;
    this.x += this.vx * dt;
    this.y += this.vy * dt + Math.sin(this.bob) * 18 * dt;
    if (this.x < -this.radius * 4 || this.x > world.w + this.radius * 4) this.dead = true;
  }

  draw(ctx) {
    const r = this.radius;
    const hull = [
      { x: -r, y: 0 }, { x: -r * 0.45, y: -r * 0.35 },
      { x: r * 0.45, y: -r * 0.35 }, { x: r, y: 0 },
      { x: r * 0.45, y: r * 0.35 }, { x: -r * 0.45, y: r * 0.35 },
    ].map((p) => ({ x: this.x + p.x, y: this.y + p.y }));
    const dome = [
      { x: -r * 0.45, y: -r * 0.35 }, { x: -r * 0.2, y: -r * 0.7 },
      { x: r * 0.2, y: -r * 0.7 }, { x: r * 0.45, y: -r * 0.35 },
    ].map((p) => ({ x: this.x + p.x, y: this.y + p.y }));
    glow(ctx, COLORS.ufo, 12);
    strokePoly(ctx, hull, { color: COLORS.ufo, width: 2 });
    strokePoly(ctx, dome, { color: COLORS.ufo, width: 2, close: false });
    noGlow(ctx);
  }
}

export class Particle {
  constructor(x, y, vx, vy, life, color, kind = 'line') {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.life = life; this.maxLife = life;
    this.color = color; this.kind = kind;
    this.angle = Math.atan2(vy, vx);
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= Math.pow(0.2, dt);
    this.vy *= Math.pow(0.2, dt);
    this.life -= dt;
  }

  get dead() { return this.life <= 0; }

  draw(ctx) {
    const t = clamp(this.life / this.maxLife, 0, 1);
    ctx.globalAlpha = t;
    if (this.kind === 'dot') {
      fillDot(ctx, this.x, this.y, 1.6, this.color);
    } else {
      const len = 6 * t + 2;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(this.x - Math.cos(this.angle) * len, this.y - Math.sin(this.angle) * len);
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

export class PowerUp {
  constructor(x, y, type) {
    this.x = x; this.y = y;
    this.type = type;
    this.def = POWERUPS[type];
    this.radius = CFG.powerupRadius;
    this.life = CFG.powerupLife;
    this.rot = 0;
    this.vx = rand(-20, 20);
    this.vy = rand(-20, 20);
  }

  update(dt, world) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.rot += dt * 1.5;
    wrap(this, world.w, world.h, this.radius);
    this.life -= dt;
  }

  get dead() { return this.life <= 0; }

  draw(ctx) {
    const r = this.radius;
    const blink = this.life < 2.5 && Math.floor(this.life * 8) % 2 === 0;
    if (blink) return;
    const sq = [
      { x: -r, y: -r }, { x: r, y: -r }, { x: r, y: r }, { x: -r, y: r },
    ].map((p) => {
      const c = Math.cos(this.rot), s = Math.sin(this.rot);
      return { x: this.x + p.x * c - p.y * s, y: this.y + p.x * s + p.y * c };
    });
    glow(ctx, this.def.color, 14);
    strokePoly(ctx, sq, { color: this.def.color, width: 2 });
    ctx.fillStyle = this.def.color;
    ctx.font = `bold ${r}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.def.glyph, this.x, this.y + 1);
    noGlow(ctx);
  }
}

// ---------------- arcade enemies / hazards ----------------

// Chases the ship and rams it. Dies in one hit.
export class Hunter {
  constructor(x, y) {
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.radius = CFG.hunterRadius;
    this.angle = 0;
    this.dead = false;
  }
  update(dt, world, ship) {
    if (ship) {
      const a = Math.atan2(ship.y - this.y, ship.x - this.x);
      this.vx += Math.cos(a) * CFG.hunterAccel * dt;
      this.vy += Math.sin(a) * CFG.hunterAccel * dt;
    }
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > CFG.hunterMaxSpeed) {
      this.vx = (this.vx / sp) * CFG.hunterMaxSpeed;
      this.vy = (this.vy / sp) * CFG.hunterMaxSpeed;
    }
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.angle = Math.atan2(this.vy, this.vx);
    wrap(this, world.w, world.h, this.radius);
  }
  draw(ctx) {
    const r = this.radius, c = Math.cos(this.angle), s = Math.sin(this.angle);
    const pts = [{ x: r * 1.6, y: 0 }, { x: -r, y: -r }, { x: -r * 0.4, y: 0 }, { x: -r, y: r }]
      .map((p) => ({ x: this.x + p.x * c - p.y * s, y: this.y + p.x * s + p.y * c }));
    glow(ctx, COLORS.hunter, 8);
    strokePoly(ctx, pts, { color: COLORS.hunter, width: 2 });
    noGlow(ctx);
  }
}

// Drifts slowly; detonates when the ship gets close. Can be shot for points.
export class Mine {
  constructor(x, y) {
    this.x = x; this.y = y;
    const d = rand(0, TAU);
    this.vx = Math.cos(d) * CFG.mineDrift;
    this.vy = Math.sin(d) * CFG.mineDrift;
    this.radius = CFG.mineRadius;
    this.t = rand(0, TAU);
    this.dead = false;
  }
  update(dt, world) {
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.t += dt * 4;
    wrap(this, world.w, world.h, this.radius);
  }
  draw(ctx) {
    const r = this.radius;
    glow(ctx, COLORS.mine, 8);
    strokeCircle(ctx, this.x, this.y, r, { color: COLORS.mine, width: 2 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      ctx.beginPath();
      ctx.moveTo(this.x + Math.cos(a) * r, this.y + Math.sin(a) * r);
      ctx.lineTo(this.x + Math.cos(a) * (r + 5), this.y + Math.sin(a) * (r + 5));
      ctx.strokeStyle = COLORS.mine; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.t * 2);
    fillDot(ctx, this.x, this.y, 3, COLORS.mine);
    ctx.globalAlpha = 1;
    noGlow(ctx);
  }
}

// Elite UFO: crosses the screen, charges, then fires a precise aimed shot. 2 HP.
export class Sniper {
  constructor(world) {
    this.radius = CFG.sniperRadius;
    const fromLeft = Math.random() < 0.5;
    this.x = fromLeft ? -this.radius * 2 : world.w + this.radius * 2;
    this.y = rand(world.h * 0.12, world.h * 0.7);
    this.vx = (fromLeft ? 1 : -1) * CFG.sniperSpeed;
    this.hp = CFG.sniperHp;
    this.charge = 0;
    this.aim = 0;
    this.bob = rand(0, TAU);
    this.dead = false;
  }
  update(dt, world) {
    this.bob += dt;
    this.x += this.vx * dt;
    this.y += Math.sin(this.bob) * 16 * dt;
    this.charge += dt;
    if (this.x < -this.radius * 4 || this.x > world.w + this.radius * 4) this.dead = true;
  }
  draw(ctx) {
    const r = this.radius;
    const pts = [{ x: 0, y: -r }, { x: r, y: 0 }, { x: 0, y: r }, { x: -r, y: 0 }]
      .map((p) => ({ x: this.x + p.x, y: this.y + p.y }));
    glow(ctx, COLORS.sniper, 10);
    strokePoly(ctx, pts, { color: COLORS.sniper, width: 2 });
    strokeCircle(ctx, this.x, this.y, r * 0.5, { color: COLORS.sniper, width: 2 });
    if (this.charge > CFG.sniperCharge - 0.35) {
      ctx.globalAlpha = 0.5;
      strokePoly(ctx, [{ x: this.x, y: this.y },
        { x: this.x + Math.cos(this.aim) * 1000, y: this.y + Math.sin(this.aim) * 1000 }],
        { color: COLORS.sniper, width: 1, close: false });
      ctx.globalAlpha = 1;
    }
    noGlow(ctx);
  }
}

// Pulls everything nearby toward its centre for a few seconds.
export class GravityWell {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.radius = CFG.gravityRadius;
    this.life = CFG.gravityLife;
    this.t = 0;
  }
  update(dt) { this.life -= dt; this.t += dt; }
  get dead() { return this.life <= 0; }
  draw(ctx) {
    const a = clamp(this.life / CFG.gravityLife, 0, 1);
    ctx.globalAlpha = 0.2 + 0.5 * a;
    glow(ctx, COLORS.well, 10);
    for (let i = 0; i < 3; i++) {
      const rr = this.radius * (0.3 + i * 0.3) + Math.sin(this.t * 2 + i) * 4;
      strokeCircle(ctx, this.x, this.y, rr, { color: COLORS.well, width: 2 });
    }
    fillDot(ctx, this.x, this.y, 4, COLORS.well);
    noGlow(ctx);
    ctx.globalAlpha = 1;
  }
}
