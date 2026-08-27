// Planet mode: a Super Stardust-style spherical playfield.
// Entities live on a unit sphere (position = 3D unit vector). The camera is
// locked above the ship looking at the planet centre, so the ship stays centred
// and the world rotates beneath it. The front hemisphere is drawn; the far side
// is hidden behind the limb. Progression (score/lives/combo/power-ups/minerals)
// is shared with the 2D Game via the `g` reference.
import { CFG, COLORS, POWERUPS, TAU, rand, randInt, clamp } from './config.js';
import { sfx } from './audio.js';
import { settings } from './settings.js';

// ---- vec3 helpers ----
const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};
const NORTH = [0, 1, 0];

// Rodrigues rotation of v around unit axis by angle.
function rotAxis(v, axis, ang) {
  const c = Math.cos(ang), s = Math.sin(ang), d = V.dot(axis, v);
  const cr = V.cross(axis, v);
  return [
    v[0] * c + cr[0] * s + axis[0] * d * (1 - c),
    v[1] * c + cr[1] * s + axis[1] * d * (1 - c),
    v[2] * c + cr[2] * s + axis[2] * d * (1 - c),
  ];
}
const tangent = (p, v) => V.sub(v, V.scale(p, V.dot(v, p)));
const signedAngle = (n, a, b) => Math.atan2(V.dot(V.cross(a, b), n), V.dot(a, b));

// Move an entity with tangent angular velocity e.v along its great circle.
function moveP(e, dt) {
  const sp = V.len(e.v);
  if (sp > 1e-6) {
    const axis = V.norm(V.cross(e.p, e.v));
    e.p = V.norm(rotAxis(e.p, axis, sp * dt));
    e.v = V.scale(V.norm(tangent(e.p, e.v)), sp); // parallel-transport, keep speed
  }
}

// Camera basis at the ship: zc points to viewer, xc = screen right, yc = screen up.
function cameraBasis(p) {
  let up = tangent(p, NORTH);
  if (V.len(up) < 1e-3) up = tangent(p, [1, 0, 0]);
  up = V.norm(up);
  const zc = p;
  const xc = V.norm(V.cross(up, zc));
  const yc = V.cross(zc, xc);
  return { xc, yc, zc };
}
// Screen angle (canvas coords, y-down) -> world tangent direction at the ship.
function screenDir(angle, cam) {
  return V.norm(V.add(V.scale(cam.xc, Math.cos(angle)), V.scale(cam.yc, -Math.sin(angle))));
}

const PC = {
  front: 0.015,
  shipTurn: 5.5, shipAccel: 2.4, shipMax: 1.5, shipFriction: 0.5, shipAng: 0.05, invuln: 2.5,
  bulletSpeed: 3.2, bulletLife: 0.7, bulletAng: 0.014, maxBullets: 26,
  astAng: [0.12, 0.075, 0.045], astSpeed: [0.22, 0.34, 0.48], astBase: 4,
  hunterAng: 0.045, hunterAccel: 1.9, hunterMax: 1.05, hunterEvery: [10, 18], hunterMin: 2,
  mineAng: 0.05, mineDrift: 0.12, mineTrigger: 0.10, mineEvery: [12, 22],
  sniperAng: 0.06, sniperSpeed: 0.22, sniperHp: 2, sniperCharge: 1.3, sniperBulletSpeed: 2.6, sniperEvery: [18, 30], sniperMin: 3,
  ufoAng: 0.055, ufoSpeed: 0.5, ufoFire: 1.4, ufoBulletSpeed: 1.9, ufoEvery: [14, 26], ufoMin: 2,
  gravEvery: [16, 30], gravAng: 0.55, gravForce: 2.2, gravLife: 9,
  puAng: 0.055, puLife: 9, dropChance: 0.16, explosiveAng: 0.30,
  slowFactor: 0.4, homingTurn: 3.6, comboWindow: 2.2,
  crystalShards: 3, crystalSpeed: 1.7, iceShards: 4, maxAsteroids: 160,
};

export class PlanetField {
  constructor(game) {
    this.g = game;
    // empty until start(); lets the title screen render a bare globe safely
    this.ship = null;
    this.asteroids = []; this.bullets = []; this.hunters = []; this.mines = [];
    this.snipers = []; this.ufos = []; this.wells = []; this.powerups = []; this.particles = [];
  }

  start() {
    this.ship = { p: [0, 0, 1], h: [0, 1, 0], v: [0, 0, 0], ang: PC.shipAng, invuln: PC.invuln, thrust: false, puff: 0 };
    this.asteroids = [];
    this.bullets = [];
    this.hunters = [];
    this.mines = [];
    this.snipers = [];
    this.ufos = [];
    this.wells = [];
    this.powerups = [];
    this.particles = [];
    this.fireCd = 0;
    this.comboTimer = 0;
    this.hunterTimer = rand(...PC.hunterEvery);
    this.mineTimer = rand(...PC.mineEvery);
    this.sniperTimer = rand(...PC.sniperEvery);
    this.ufoTimer = rand(...PC.ufoEvery);
    this.gravTimer = rand(...PC.gravEvery);
    if ((this.g.rl?.upgrades?.startShield || 0) >= 1) this.g.pu.shield = 3;
    this._startWave(1);
  }

  // A random surface point at least `minAng` away from the ship.
  _spawnPoint(minAng = 1.1) {
    for (let i = 0; i < 40; i++) {
      const u = rand(-1, 1), t = rand(0, TAU), r = Math.sqrt(1 - u * u);
      const p = [r * Math.cos(t), u, r * Math.sin(t)];
      if (V.dot(p, this.ship.p) < Math.cos(minAng)) return p;
    }
    return V.norm(V.scale(this.ship.p, -1)); // fallback: antipode
  }

  _randTangent(p) {
    const a = rand(0, TAU);
    const cam = cameraBasis(p);
    return V.norm(V.add(V.scale(cam.xc, Math.cos(a)), V.scale(cam.yc, Math.sin(a))));
  }

  _startWave(n) {
    this.g.wave = n;
    const count = PC.astBase + (n - 1);
    for (let i = 0; i < count; i++) this._spawnAsteroid(0, this._spawnPoint());
    this.g.waveBanner = 1.6;
    sfx.wave();
  }

  _spawnAsteroid(tier, p, kind = null) {
    if (this.asteroids.length >= PC.maxAsteroids) return null; // never let counts explode
    const n = randInt(9, 13);
    const verts = [];
    for (let i = 0; i < n; i++) verts.push({ a: (i / n) * TAU, r: rand(0.72, 1.12) });
    const a = {
      p, tier, ang: PC.astAng[tier], score: CFG.astTiers[tier].score,
      v: V.scale(this._randTangent(p), PC.astSpeed[tier] * rand(0.8, 1.2)),
      rot: rand(0, TAU), spin: rand(-1, 1) * 0.8, verts, kind, hp: 1, volatile: false, dead: false,
    };
    if (tier === 0) {
      if (this.g.flags.explosive && Math.random() < CFG.explosiveChance) a.volatile = true;
      else this._assignType(a);
    }
    this.asteroids.push(a);
    return a;
  }

  _assignType(a) {
    if (Math.random() >= CFG.asteroidTypeChance) return;
    const types = [];
    const f = this.g.flags;
    if (f.crystal) types.push('crystal');
    if (f.iron) types.push('iron');
    if (f.ice) types.push('ice');
    if (f.parasite) types.push('parasite');
    if (!types.length) return;
    a.kind = types[randInt(0, types.length - 1)];
    if (a.kind === 'iron') a.hp = 2;
  }

  // ---------------- update ----------------
  update(dt) {
    const g = this.g;
    if (g.waveBanner > 0) g.waveBanner -= dt;
    for (const k of ['rapid', 'spread', 'shield', 'pierce', 'homing', 'slow']) g.pu[k] = Math.max(0, g.pu[k] - dt);
    if (g.flags.combo && this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) { g.comboCount = 0; g.mult = 1; }
    }
    const hdt = g.pu.slow > 0 ? dt * PC.slowFactor : dt;
    const cam = cameraBasis(this.ship.p);

    this._updateShip(dt, cam);
    this._fireStep(dt, cam);

    for (const b of this.bullets) {
      const dtb = b.enemy ? hdt : dt;
      if (b.homing && !b.enemy) this._homeBullet(b, dtb);
      moveP(b, dtb); b.life -= dtb;
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);

    for (const a of this.asteroids) { moveP(a, hdt); a.rot += a.spin * hdt; }
    for (const p of this.powerups) { moveP(p, dt); p.life -= dt; }
    this.powerups = this.powerups.filter((p) => p.life > 0);

    if (g.flags.gravity) this._updateWells(dt);
    this._updateEnemies(dt, hdt);
    this._updateParticles(dt);

    this._collisions();

    if (this.asteroids.length === 0) {
      g.lives = Math.min(g.maxLives, g.lives + 1); // replenish 1 per wave
      this._startWave(g.wave + 1);
    }
  }

  _updateShip(dt, cam) {
    const s = this.ship, g = this.g;
    s.thrust = false;
    if (g.steer.active && g.steer.thrust > 0) {
      const des = screenDir(g.steer.angle, cam);
      const delta = clamp(signedAngle(s.p, s.h, des), -PC.shipTurn * dt, PC.shipTurn * dt);
      s.h = V.norm(tangent(s.p, rotAxis(s.h, s.p, delta)));
      s.v = V.add(s.v, V.scale(s.h, PC.shipAccel * g.steer.thrust * dt));
      s.thrust = g.steer.thrust > 0.15;
    }
    s.v = V.scale(s.v, Math.pow(PC.shipFriction, dt));
    const sp = V.len(s.v);
    const max = PC.shipMax * (this.g.rlShipSpeed / CFG.shipMaxSpeed);
    if (sp > max) s.v = V.scale(s.v, max / sp);
    moveP(s, dt);
    s.h = V.norm(tangent(s.p, s.h));
    if (s.invuln > 0) s.invuln -= dt;
    if (s.thrust && (s.puff -= dt) <= 0) {
      s.puff = 0.05;
      this._burst(s.p, V.scale(s.h, -1), 2, COLORS.thrust, 0.5, 0.3);
      sfx.thrust();
    }
  }

  _fireStep(dt, cam) {
    const g = this.g;
    this.fireCd = Math.max(0, this.fireCd - dt);
    if (!g.firing || this.fireCd > 0) return;
    const dir = (settings.twinStick && g.aimHasDir) ? screenDir(g.fireAngle, cam) : this.ship.h;
    this._fire(dir);
  }

  _fire(dir) {
    const g = this.g, s = this.ship;
    const playerBullets = this.bullets.reduce((n, b) => n + (b.enemy ? 0 : 1), 0);
    if (playerBullets >= PC.maxBullets) return;
    this.fireCd = g.pu.rapid > 0 ? CFG.rapidCooldown : this.g.rlFireCooldown;
    const speed = PC.bulletSpeed * (this.g.rlBulletSpeed / CFG.bulletSpeed);
    const dirs = g.pu.spread > 0
      ? [dir, rotAxis(dir, s.p, -0.22), rotAxis(dir, s.p, 0.22)]
      : [dir];
    for (const d of dirs.slice(0, PC.maxBullets - playerBullets)) {
      this.bullets.push({
        p: [...s.p], v: V.scale(V.norm(tangent(s.p, d)), speed), life: PC.bulletLife,
        ang: PC.bulletAng, pierce: g.pu.pierce > 0, homing: g.pu.homing > 0, enemy: false, color: null,
      });
    }
    sfx.fire();
  }

  _homeBullet(b, dt) {
    let best = null, bd = -2;
    const consider = (t) => { const d = V.dot(t.p, b.p); if (d > bd) { bd = d; best = t; } };
    for (const a of this.asteroids) consider(a);
    for (const h of this.hunters) consider(h);
    for (const u of this.ufos) consider(u);
    for (const sn of this.snipers) consider(sn);
    if (!best) return;
    const speed = V.len(b.v), cur = V.norm(b.v);
    const des = V.norm(tangent(b.p, V.sub(best.p, b.p)));
    const delta = clamp(signedAngle(b.p, cur, des), -PC.homingTurn * dt, PC.homingTurn * dt);
    b.v = V.scale(V.norm(tangent(b.p, rotAxis(cur, b.p, delta))), speed);
  }

  _updateWells(dt) {
    this.gravTimer -= dt;
    if (this.gravTimer <= 0) {
      this.wells.push({ p: this._spawnPoint(0.6), ang: PC.gravAng, life: PC.gravLife, t: 0 });
      this.gravTimer = rand(...PC.gravEvery);
    }
    for (const wl of this.wells) { wl.life -= dt; wl.t += dt; }
    this.wells = this.wells.filter((wl) => wl.life > 0);

    const pull = (e) => {
      for (const wl of this.wells) {
        const c = clamp(V.dot(wl.p, e.p), -1, 1);
        const ang = Math.acos(c);
        if (ang > wl.ang || ang < 1e-3) continue;
        const dir = V.norm(tangent(e.p, V.sub(wl.p, e.p)));
        e.v = V.add(e.v, V.scale(dir, PC.gravForce * (1 - ang / wl.ang) * dt));
      }
    };
    pull(this.ship);
    for (const a of this.asteroids) pull(a);
    for (const h of this.hunters) pull(h);
    for (const m of this.mines) pull(m);
  }

  _updateEnemies(dt, hdt) {
    const g = this.g, s = this.ship;

    if (g.flags.hunter) {
      this.hunterTimer -= dt;
      if (this.hunterTimer <= 0 && g.wave >= PC.hunterMin) {
        this.hunters.push({ p: this._spawnPoint(0.9), v: [0, 0, 0], ang: PC.hunterAng, dead: false });
        this.hunterTimer = rand(...PC.hunterEvery);
      }
      for (const h of this.hunters) {
        const des = V.norm(tangent(h.p, V.sub(s.p, h.p)));
        h.v = V.add(h.v, V.scale(des, PC.hunterAccel * hdt));
        const sp = V.len(h.v); if (sp > PC.hunterMax) h.v = V.scale(h.v, PC.hunterMax / sp);
        moveP(h, hdt);
      }
    }

    if (g.flags.mine) {
      this.mineTimer -= dt;
      if (this.mineTimer <= 0) {
        const p = this._spawnPoint(0.7);
        this.mines.push({ p, v: V.scale(this._randTangent(p), PC.mineDrift), ang: PC.mineAng, t: rand(0, TAU), dead: false });
        this.mineTimer = rand(...PC.mineEvery);
      }
      for (const m of this.mines) { moveP(m, hdt); m.t += hdt * 4; }
    }

    if (g.flags.sniper) {
      this.sniperTimer -= dt;
      if (this.sniperTimer <= 0 && this.snipers.length === 0 && g.wave >= PC.sniperMin) {
        const p = this._spawnPoint(1.2);
        this.snipers.push({ p, v: V.scale(this._randTangent(p), PC.sniperSpeed), ang: PC.sniperAng, hp: PC.sniperHp, charge: 0, dead: false });
        this.sniperTimer = rand(...PC.sniperEvery);
        sfx.ufo();
      }
      for (const sn of this.snipers) {
        moveP(sn, hdt); sn.charge += hdt;
        if (sn.charge >= PC.sniperCharge) {
          sn.charge = 0;
          const dir = V.norm(tangent(sn.p, V.sub(s.p, sn.p)));
          this.bullets.push({ p: [...sn.p], v: V.scale(dir, PC.sniperBulletSpeed), life: 2.4, ang: PC.bulletAng, enemy: true, color: COLORS.sniper });
          sfx.ufoFire();
        }
      }
    }

    // UFO exists in all planet runs (part of the base game)
    this.ufoTimer -= hdt;
    if (this.ufoTimer <= 0 && this.ufos.length === 0 && g.wave >= PC.ufoMin) {
      const p = this._spawnPoint(1.0);
      this.ufos.push({ p, v: V.scale(this._randTangent(p), PC.ufoSpeed), ang: PC.ufoAng, fire: PC.ufoFire, dead: false });
      this.ufoTimer = rand(...PC.ufoEvery);
      sfx.ufo();
    }
    for (const u of this.ufos) {
      moveP(u, hdt); u.fire -= hdt;
      if (u.fire <= 0) {
        u.fire = PC.ufoFire;
        const dir = V.norm(tangent(u.p, V.sub(s.p, u.p)));
        const jitter = rotAxis(dir, u.p, rand(-0.15, 0.15));
        this.bullets.push({ p: [...u.p], v: V.scale(V.norm(tangent(u.p, jitter)), PC.ufoBulletSpeed), life: 3, ang: PC.bulletAng, enemy: true, color: COLORS.ufoBullet });
        sfx.ufoFire();
      }
    }

    this.hunters = this.hunters.filter((e) => !e.dead);
    this.mines = this.mines.filter((e) => !e.dead);
    this.snipers = this.snipers.filter((e) => !e.dead);
    this.ufos = this.ufos.filter((e) => !e.dead);
  }

  // ---------------- particles ----------------
  _burst(p, biasDir, n, color, spread, life = 0.6) {
    for (let i = 0; i < n; i++) {
      let dir = this._randTangent(p);
      if (biasDir) dir = V.norm(V.add(V.scale(V.norm(tangent(p, biasDir)), 0.7), V.scale(dir, 0.6)));
      this.particles.push({ p: [...p], v: V.scale(dir, spread * rand(0.4, 1)), life: life * rand(0.6, 1), maxLife: life, color });
    }
  }

  _updateParticles(dt) {
    for (const pt of this.particles) {
      moveP(pt, dt);
      pt.v = V.scale(pt.v, Math.pow(0.2, dt));
      pt.life -= dt;
    }
    this.particles = this.particles.filter((pt) => pt.life > 0);
  }

  // ---------------- scoring / power-ups / damage ----------------
  _award(points) { this.g._award(points); this.comboTimer = PC.comboWindow; }

  _drop(p) {
    if (Math.random() > PC.dropChance) return;
    const type = Math.random() < CFG.lifeDropChance
      ? 'life'
      : this.g.pool[randInt(0, this.g.pool.length - 1)];
    this.powerups.push({ p: [...p], v: V.scale(this._randTangent(p), 0.05), ang: PC.puAng, type, life: PC.puLife, rot: 0 });
  }

  _apply(type) {
    const def = POWERUPS[type];
    if (def.instant) {
      if (type === 'bomb') this._bomb();
      else if (type === 'life') this.g.lives = Math.min(this.g.maxLives, this.g.lives < 3 ? 3 : this.g.lives + 1);
    } else this.g.pu[type] = def.duration * this.g.rlPuMult;
    this._burst(this.ship.p, null, 16, def.color, 0.9);
    sfx.powerup();
  }

  _bomb() {
    this.g.shake.add(22); sfx.explode(1.6);
    for (const a of [...this.asteroids]) { if (!a.dead) { a.dead = true; this._award(a.score); this._burst(a.p, null, 10, COLORS.bomb, 1.0); } }
    this.asteroids = this.asteroids.filter((a) => !a.dead);
    const wipe = (list, score, color) => { for (const e of list) { if (!e.dead) { e.dead = true; this._award(score); this._burst(e.p, null, 12, color, 1.0); } } };
    wipe(this.ufos, CFG.ufoScore, COLORS.ufo);
    wipe(this.hunters, CFG.hunterScore, COLORS.hunter);
    wipe(this.snipers, CFG.sniperScore, COLORS.sniper);
    wipe(this.mines, CFG.mineScore, COLORS.mine);
    this.ufos = this.ufos.filter((e) => !e.dead);
    this.hunters = this.hunters.filter((e) => !e.dead);
    this.snipers = this.snipers.filter((e) => !e.dead);
    this.mines = this.mines.filter((e) => !e.dead);
  }

  _breakShield() {
    this.g.pu.shield = 0; this.ship.invuln = 1.2;
    this._burst(this.ship.p, null, 22, COLORS.shield, 1.1);
    this.g.shake.add(8); sfx.explode(0.8);
  }

  _hurt() {
    if (this.g.pu.shield > 0) { this._breakShield(); return; }
    this._burst(this.ship.p, null, 28, COLORS.fg, 1.3);
    const dead = this.g.planetDamage();
    if (!dead) {
      this.ship.v = [0, 0, 0];
      this.ship.invuln = PC.invuln;
      if ((this.g.rl?.upgrades?.startShield || 0) >= 1) this.g.pu.shield = 3;
    }
  }

  _destroyAsteroid(a) {
    if (a.dead) return;
    if (a.kind === 'iron' && a.hp > 1) { a.hp--; this._burst(a.p, null, 6, COLORS.iron, 0.5); this.g.shake.add(2); sfx.explode(0.5); return; }
    a.dead = true;
    this._award(a.score);
    sfx.explode(1 - a.tier * 0.3);
    this._drop(a.p);

    if (a.volatile && this.g.flags.explosive) {
      this._burst(a.p, null, 24, COLORS.volatile, 1.4); this.g.shake.add(12);
      for (const o of this.asteroids) if (!o.dead && V.dot(o.p, a.p) > Math.cos(PC.explosiveAng)) this._destroyAsteroid(o);
      return;
    }
    if (a.kind === 'crystal' && a.tier < 2) {
      this._burst(a.p, null, 16, COLORS.crystal, 1.1); this.g.shake.add(5);
      for (let i = 0; i < PC.crystalShards; i++) { const c = this._spawnAsteroid(a.tier + 1, [...a.p], 'crystal'); if (c) c.v = V.scale(c.v, PC.crystalSpeed); }
      return;
    }
    if (a.kind === 'ice' && a.tier < 2) {
      // Shatter once into terminal tier-2 shards. The guard is essential: the
      // shards are tier 2, so they fall through to the normal (no-split) path
      // and don't re-shatter — otherwise every ice kill breeds 4 more forever.
      this._burst(a.p, null, 18, COLORS.ice, 0.9); this.g.shake.add(4);
      for (let i = 0; i < PC.iceShards; i++) { const c = this._spawnAsteroid(2, [...a.p], 'ice'); if (c) c.score = CFG.iceShardScore; }
      return;
    }
    if (a.kind === 'parasite') {
      this._burst(a.p, null, 14, COLORS.parasite, 1.0); this.g.shake.add(5);
      if (this.g.flags.hunter) this.hunters.push({ p: [...a.p], v: [0, 0, 0], ang: PC.hunterAng, dead: false });
      if (a.tier < 2) for (let i = 0; i < 2; i++) this._spawnAsteroid(a.tier + 1, [...a.p]);
      return;
    }
    this._burst(a.p, null, 12 + a.tier * 2, COLORS.fg, 1 - a.tier * 0.2 + 0.3);
    this.g.shake.add(6 - a.tier * 1.5);
    if (a.tier < 2) for (let i = 0; i < 2; i++) this._spawnAsteroid(a.tier + 1, [...a.p]);
  }

  _collisions() {
    const near = (a, b) => V.dot(a.p, b.p) > Math.cos(a.ang + b.ang);
    const s = this.ship;

    // player bullets vs asteroids
    for (const b of this.bullets) {
      if (b.enemy || b.life <= 0) continue;
      const n = this.asteroids.length;
      for (let i = 0; i < n; i++) {
        const a = this.asteroids[i];
        if (!a.dead && near(b, a)) { if (!b.pierce) b.life = 0; this._destroyAsteroid(a); if (b.life <= 0) break; }
      }
    }
    this.asteroids = this.asteroids.filter((a) => !a.dead);

    // player bullets vs enemies
    const hitEnemy = (list, score, color, big) => {
      for (const b of this.bullets) {
        if (b.enemy || b.life <= 0) continue;
        for (const e of list) {
          if (e.dead || b.life <= 0 || !near(b, e)) continue;
          if (!b.pierce) b.life = 0;
          if (e.hp && e.hp > 1) { e.hp--; this._burst(e.p, null, 6, color, 0.7); continue; }
          e.dead = true; this._award(score); this._burst(e.p, null, big ? 22 : 16, color, big ? 1.3 : 1.0);
          this.g.shake.add(big ? 10 : 6); sfx.explode(big ? 1.3 : 0.8); this._drop(e.p);
        }
      }
    };
    hitEnemy(this.ufos, CFG.ufoScore, COLORS.ufo, true);
    hitEnemy(this.hunters, CFG.hunterScore, COLORS.hunter, false);
    hitEnemy(this.snipers, CFG.sniperScore, COLORS.sniper, true);
    for (const b of this.bullets) { // mines: shooting is safe
      if (b.enemy || b.life <= 0) continue;
      for (const m of this.mines) {
        if (!m.dead && near(b, m)) { if (!b.pierce) b.life = 0; m.dead = true; this._award(CFG.mineScore); this._burst(m.p, null, 18, COLORS.mine, 1.1); this.g.shake.add(7); sfx.explode(0.9); }
      }
    }
    this.ufos = this.ufos.filter((e) => !e.dead);
    this.hunters = this.hunters.filter((e) => !e.dead);
    this.snipers = this.snipers.filter((e) => !e.dead);
    this.mines = this.mines.filter((e) => !e.dead);

    // power-up pickup (even while invulnerable)
    for (const p of this.powerups) if (p.life > 0 && near(s, p)) { p.life = 0; this._apply(p.type); }

    if (s.invuln > 0) return;

    for (const b of this.bullets) if (b.enemy && b.life > 0 && near(b, s)) { b.life = 0; this._hurt(); return; }
    for (const a of this.asteroids) if (near(s, a)) { if (this.g.pu.shield > 0) { this._destroyAsteroid(a); this.asteroids = this.asteroids.filter((x) => !x.dead); } this._hurt(); return; }
    for (const list of [this.ufos, this.snipers, this.hunters]) {
      for (const e of list) if (!e.dead && near(s, e)) {
        if (this.g.pu.shield > 0) { e.dead = true; this._burst(e.p, null, 16, COLORS.ufo, 1.0); }
        this._hurt(); return;
      }
    }
    for (const m of this.mines) {
      if (!m.dead && V.dot(s.p, m.p) > Math.cos(PC.mineTrigger + s.ang)) {
        m.dead = true; this._burst(m.p, null, 22, COLORS.mine, 1.2); this.g.shake.add(12); sfx.explode(1.0); this._hurt(); return;
      }
    }
  }

  updateParticles(dt) { this._updateParticles(dt); }

  // ---------------- render ----------------
  render(ctx, play, shake) {
    const R = 0.42 * Math.min(play.w, play.h);
    const cx = play.x + play.w / 2 + shake.x;
    const cy = play.y + play.h / 2 + shake.y;
    const shipP = this.ship ? this.ship.p : [0, 0, 1];
    const cam = cameraBasis(shipP);
    const proj = (p) => ({ sx: cx + V.dot(p, cam.xc) * R, sy: cy - V.dot(p, cam.yc) * R, cz: V.dot(p, cam.zc) });

    ctx.save();
    ctx.beginPath(); ctx.rect(play.x, play.y, play.w, play.h); ctx.clip();

    // planet body + limb
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU);
    ctx.fillStyle = '#070709'; ctx.fill();
    this._glow(ctx, COLORS.well, 12);
    ctx.strokeStyle = COLORS.well; ctx.lineWidth = 2; ctx.globalAlpha = 0.7; ctx.stroke();
    this._noGlow(ctx); ctx.globalAlpha = 1;

    this._drawGrid(ctx, proj, R);

    // wells (on surface)
    for (const wl of this.wells) this._drawWell(ctx, wl, proj, R);
    // powerups + asteroids + enemies + bullets
    for (const p of this.powerups) this._drawPowerup(ctx, p, proj, R);
    for (const a of this.asteroids) this._drawAsteroid(ctx, a, proj, R);
    for (const m of this.mines) this._drawMine(ctx, m, proj, R);
    for (const h of this.hunters) this._drawTriEnemy(ctx, h, proj, R, COLORS.hunter);
    for (const u of this.ufos) this._drawDisc(ctx, u, proj, R, COLORS.ufo);
    for (const sn of this.snipers) this._drawSniper(ctx, sn, proj, R);
    for (const b of this.bullets) this._drawBullet(ctx, b, proj, R);
    for (const pt of this.particles) this._drawParticle(ctx, pt, proj, R);

    if (this.ship) this._drawShip(ctx, cx, cy, R, cam);

    ctx.restore();
  }

  _glow(ctx, color, amt) { if (settings.glow) { ctx.shadowColor = color; ctx.shadowBlur = amt; } }
  _noGlow(ctx) { ctx.shadowBlur = 0; }

  _drawGrid(ctx, proj, R) {
    ctx.strokeStyle = '#1d1d24'; ctx.lineWidth = 1;
    const line = (pts) => {
      ctx.beginPath(); let pen = false;
      for (const P of pts) {
        const q = proj(P);
        if (q.cz > PC.front) { if (!pen) { ctx.moveTo(q.sx, q.sy); pen = true; } else ctx.lineTo(q.sx, q.sy); }
        else pen = false;
      }
      ctx.stroke();
    };
    for (const lat of [-60, -30, 0, 30, 60]) {
      const la = lat * Math.PI / 180, pts = [];
      for (let i = 0; i <= 48; i++) { const lo = (i / 48) * TAU; pts.push([Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)]); }
      line(pts);
    }
    for (let k = 0; k < 12; k++) {
      const lo = (k / 12) * TAU, pts = [];
      for (let i = 0; i <= 24; i++) { const la = -Math.PI / 2 + (i / 24) * Math.PI; pts.push([Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)]); }
      line(pts);
    }
  }

  _size(ang, R, cz) { return ang * R * (0.4 + 0.6 * cz); }

  _drawAsteroid(ctx, a, proj, R) {
    const q = proj(a.p); if (q.cz <= PC.front) return;
    const sz = this._size(a.ang, R, q.cz);
    const c = Math.cos(a.rot), s = Math.sin(a.rot);
    ctx.beginPath();
    for (let i = 0; i < a.verts.length; i++) {
      const vv = a.verts[i], px = Math.cos(vv.a) * vv.r * sz, py = Math.sin(vv.a) * vv.r * sz;
      const x = q.sx + px * c - py * s, y = q.sy + px * s + py * c;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = a.kind ? (COLORS[a.kind] || COLORS.fg) : COLORS.fg;
    ctx.lineWidth = 2; ctx.stroke();
    if (a.volatile) { ctx.beginPath(); ctx.arc(q.sx, q.sy, sz * 0.42, 0, TAU); ctx.strokeStyle = COLORS.volatile; ctx.stroke(); }
  }

  _drawBullet(ctx, b, proj, R) {
    const q = proj(b.p); if (q.cz <= PC.front) return;
    const color = b.color || (b.pierce ? COLORS.pierce : b.homing ? COLORS.homing : COLORS.fg);
    ctx.globalAlpha = 0.35; this._dot(ctx, q.sx, q.sy, this._size(b.ang, R, q.cz) * 2.2, color);
    ctx.globalAlpha = 1; this._dot(ctx, q.sx, q.sy, this._size(b.ang, R, q.cz), color);
  }

  _drawParticle(ctx, pt, proj, R) {
    const q = proj(pt.p); if (q.cz <= PC.front) return;
    ctx.globalAlpha = clamp(pt.life / pt.maxLife, 0, 1);
    this._dot(ctx, q.sx, q.sy, 1.7, pt.color);
    ctx.globalAlpha = 1;
  }

  _drawPowerup(ctx, p, proj, R) {
    const q = proj(p.p); if (q.cz <= PC.front) return;
    if (p.life < 2.5 && Math.floor(p.life * 8) % 2 === 0) return;
    const def = POWERUPS[p.type], sz = this._size(p.ang, R, q.cz);
    this._glow(ctx, def.color, 12);
    ctx.strokeStyle = def.color; ctx.lineWidth = 2;
    ctx.strokeRect(q.sx - sz, q.sy - sz, sz * 2, sz * 2);
    ctx.fillStyle = def.color; ctx.font = `bold ${sz}px ui-monospace, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(def.glyph, q.sx, q.sy + 1);
    this._noGlow(ctx);
  }

  _drawMine(ctx, m, proj, R) {
    const q = proj(m.p); if (q.cz <= PC.front) return;
    const r = this._size(m.ang, R, q.cz);
    this._glow(ctx, COLORS.mine, 8);
    ctx.strokeStyle = COLORS.mine; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(q.sx, q.sy, r, 0, TAU); ctx.stroke();
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; ctx.beginPath(); ctx.moveTo(q.sx + Math.cos(a) * r, q.sy + Math.sin(a) * r); ctx.lineTo(q.sx + Math.cos(a) * (r + 4), q.sy + Math.sin(a) * (r + 4)); ctx.stroke(); }
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(m.t * 2); this._dot(ctx, q.sx, q.sy, 3, COLORS.mine); ctx.globalAlpha = 1;
    this._noGlow(ctx);
  }

  _drawDisc(ctx, e, proj, R, color) {
    const q = proj(e.p); if (q.cz <= PC.front) return;
    const r = this._size(e.ang, R, q.cz);
    this._glow(ctx, color, 10); ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(q.sx, q.sy, r, r * 0.6, 0, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(q.sx, q.sy - r * 0.2, r * 0.4, Math.PI, 0); ctx.stroke();
    this._noGlow(ctx);
  }

  _drawSniper(ctx, sn, proj, R) {
    const q = proj(sn.p); if (q.cz <= PC.front) return;
    const r = this._size(sn.ang, R, q.cz);
    this._glow(ctx, COLORS.sniper, 10); ctx.strokeStyle = COLORS.sniper; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(q.sx, q.sy - r); ctx.lineTo(q.sx + r, q.sy); ctx.lineTo(q.sx, q.sy + r); ctx.lineTo(q.sx - r, q.sy); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.arc(q.sx, q.sy, r * 0.5, 0, TAU); ctx.stroke();
    this._noGlow(ctx);
  }

  _drawTriEnemy(ctx, e, proj, R, color) {
    const q = proj(e.p); if (q.cz <= PC.front) return;
    const r = this._size(e.ang, R, q.cz);
    // orient toward screen velocity if available
    let ang = 0;
    if (V.len(e.v) > 1e-4) { const cam = cameraBasis(this.ship.p); ang = Math.atan2(-V.dot(e.v, cam.yc), V.dot(e.v, cam.xc)); }
    this._glow(ctx, color, 8); ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.save(); ctx.translate(q.sx, q.sy); ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(r * 1.5, 0); ctx.lineTo(-r, -r); ctx.lineTo(-r * 0.4, 0); ctx.lineTo(-r, r); ctx.closePath(); ctx.stroke();
    ctx.restore(); this._noGlow(ctx);
  }

  _drawWell(ctx, wl, proj, R) {
    const q = proj(wl.p); if (q.cz <= PC.front) return;
    const a = clamp(wl.life / PC.gravLife, 0, 1);
    ctx.globalAlpha = 0.2 + 0.5 * a; this._glow(ctx, COLORS.well, 10); ctx.strokeStyle = COLORS.well; ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) { const rr = this._size(wl.ang, R, q.cz) * (0.3 + i * 0.3) + Math.sin(wl.t * 2 + i) * 3; ctx.beginPath(); ctx.arc(q.sx, q.sy, rr, 0, TAU); ctx.stroke(); }
    this._dot(ctx, q.sx, q.sy, 4, COLORS.well); this._noGlow(ctx); ctx.globalAlpha = 1;
  }

  _drawShip(ctx, cx, cy, R, cam) {
    const s = this.ship;
    if (s.invuln > 0 && Math.floor(s.invuln * 10) % 2 === 0) return;
    const r = PC.shipAng * R * 1.1;
    const ang = Math.atan2(-V.dot(s.h, cam.yc), V.dot(s.h, cam.xc));
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang);
    if (s.thrust) {
      this._glow(ctx, COLORS.thrust, 12); ctx.strokeStyle = COLORS.thrust; ctx.lineWidth = 2;
      const fl = rand(0.9, 1.7);
      ctx.beginPath(); ctx.moveTo(-r * 0.55, -r * 0.45); ctx.lineTo(-r * fl, 0); ctx.lineTo(-r * 0.55, r * 0.45); ctx.stroke();
    }
    this._glow(ctx, COLORS.fg, 8); ctx.strokeStyle = COLORS.fg; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(r * 1.4, 0); ctx.lineTo(-r, -r * 0.8); ctx.lineTo(-r * 0.55, 0); ctx.lineTo(-r, r * 0.8); ctx.closePath(); ctx.stroke();
    ctx.restore();
    if (this.g.pu.shield > 0) { this._glow(ctx, COLORS.shield, 14); ctx.strokeStyle = COLORS.shield; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, r * 1.9, 0, TAU); ctx.stroke(); }
    // twin-stick aim reticle
    if (settings.twinStick && this.g.firing && this.g.aimHasDir) {
      const a = this.g.fireAngle, len = 34;
      ctx.globalAlpha = 0.8; ctx.strokeStyle = COLORS.thrust; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.lineTo(cx + Math.cos(a) * (r + len), cy + Math.sin(a) * (r + len)); ctx.stroke();
      this._dot(ctx, cx + Math.cos(a) * (r + len), cy + Math.sin(a) * (r + len), 3, COLORS.thrust); ctx.globalAlpha = 1;
    }
    this._noGlow(ctx);
  }

  _dot(ctx, x, y, r, color) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = color; ctx.fill(); }
}
