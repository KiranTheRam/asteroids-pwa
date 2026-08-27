// Core game: state machine, spawning, collisions, HUD, overlays.
// Two modes: Classic (base game) and Arcade (extra enemies/power-ups/modifiers,
// each individually toggleable via settings).
import { CFG, COLORS, POWERUPS, TAU, rand, randInt, clamp, angleDelta } from './config.js';
import {
  Ship, Asteroid, Bullet, Ufo, Particle, PowerUp,
  Hunter, Mine, Sniper, GravityWell,
} from './entities.js';
import { Shake, glow, noGlow } from './render.js';
import { sfx } from './audio.js';
import { settings } from './settings.js';
import { PlanetField } from './planet.js';
import { getHighScore, setHighScore, getRoguelite, setRoguelite } from './storage.js';

const STATE = { TITLE: 'title', PLAYING: 'playing', PAUSED: 'paused', OVER: 'over' };
const PU_KEYS = ['rapid', 'spread', 'shield', 'pierce', 'homing', 'slow'];

export class Game {
  constructor(world) {
    this.world = world; // {w, h} in CSS px, mutated on resize
    this.shake = new Shake();
    this.state = STATE.TITLE;
    this.high = getHighScore();
    this._resetField();
    this.titleSpin = 0;
  }

  _resetField() {
    this.ship = null;
    this.asteroids = [];
    this.bullets = [];
    this.ufos = [];
    this.hunters = [];
    this.mines = [];
    this.snipers = [];
    this.wells = [];
    this.particles = [];
    this.powerups = [];
    this.score = 0;
    this.newHigh = false;
    this.lives = CFG.startLives; // overridden below by roguelite extraLife
    this.wave = 0;
    this.fireCd = 0;
    this.pu = { rapid: 0, spread: 0, shield: 0, pierce: 0, homing: 0, slow: 0 };
    this.ufoTimer = rand(...CFG.ufoSpawnEvery);
    this.hunterTimer = rand(...CFG.hunterEvery);
    this.mineTimer = rand(...CFG.mineEvery);
    this.sniperTimer = rand(...CFG.sniperEvery);
    this.gravTimer = rand(...CFG.gravityEvery);
    this.autofireOn = false; // classic: toggled by the right fire pad
    this.firing = false;     // is the ship shooting this frame (either scheme)
    this.fireAngle = -Math.PI / 2; // direction shots travel
    this.aimHasDir = false;  // twin-stick: right pad dragged far enough to aim
    this.steer = { active: false, angle: 0, thrust: 0 };
    this.waveBanner = 0;
    this.noAsteroidTimer = 0;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.mult = 1;

    // Snapshot mode + per-feature flags at game start so toggling mid-run
    // can't half-apply. Classic disables everything arcade. Planet mode is a
    // spherical playfield that also enables the arcade content set.
    this.arcade = !!settings.arcade;
    this.planetMode = !!settings.planet;
    const a = this.arcade || this.planetMode;
    this.flags = {
      hunter: a && settings.arcHunter,
      mine: a && settings.arcMine,
      sniper: a && settings.arcSniper,
      pierce: a && settings.arcPierce,
      homing: a && settings.arcHoming,
      slow: a && settings.arcSlow,
      bomb: a && settings.arcBomb,
      combo: a && settings.arcCombo,
      explosive: a && settings.arcExplosive,
      gravity: a && settings.arcGravity,
      crystal: a && settings.arcAstCrystal,
      iron: a && settings.arcAstIron,
      ice: a && settings.arcAstIce,
      parasite: a && settings.arcAstParasite,
    };
    this.pool = this._buildPool();

    // Roguelite: load permanent upgrades and bake into session values.
    const rl = getRoguelite();
    this.rl = rl;
    const upg = rl.upgrades || {};
    this.rlBulletSpeed  = CFG.bulletSpeed  * (1 + (upg.bulletSpeed  || 0) * 0.08);
    this.rlShipSpeed    = CFG.shipMaxSpeed * (1 + (upg.shipSpeed    || 0) * 0.10);
    this.rlFireCooldown = CFG.fireCooldown - (upg.fireRate          || 0) * 0.02;
    this.rlPuMult       = 1 + (upg.powerupDuration || 0) * 0.15;
    this.lives          = CFG.startLives + (upg.extraLife || 0);
    this.maxLives       = Math.max(this.lives, CFG.lifeCap); // replenish ceiling
    this.mineralsEarned = 0; // track what was earned this run
    this.lastMineralsMsg = '';

    this.pf = this.planetMode ? new PlanetField(this) : null;
  }

  // Power-up drop pool: classic three always, arcade extras if enabled.
  _buildPool() {
    const pool = ['rapid', 'spread', 'shield'];
    if (this.flags.pierce) pool.push('pierce');
    if (this.flags.homing) pool.push('homing');
    if (this.flags.slow) pool.push('slow');
    if (this.flags.bomb) pool.push('bomb');
    return pool;
  }

  newGame() {
    this._resetField();
    this.state = STATE.PLAYING;
    if (this.planetMode) { this.pf.start(); return; }
    this._spawnShip();
    this._startWave(1);
  }

  // Shared damage hook used by Planet mode. Returns true if the run ended.
  planetDamage() {
    this.shake.add(16);
    sfx.death();
    if (settings.haptics && navigator.vibrate) navigator.vibrate(120);
    this.comboCount = 0; this.comboTimer = 0; this.mult = 1;
    this.lives--;
    if (this.lives <= 0) {
      this.state = STATE.OVER;
      this.newHigh = this.score > this.high;
      this.high = setHighScore(this.score);
      this._awardMinerals();
      return true;
    }
    return false;
  }

  _spawnShip() {
    this.ship = new Ship(this.world.w / 2, this.world.h / 2);
    this.ship.maxSpeed = this.rlShipSpeed;
    if ((this.rl?.upgrades?.startShield || 0) >= 1) this.pu.shield = 3;
  }

  _startWave(n) {
    this.wave = n;
    this.noAsteroidTimer = 0;
    const count = CFG.astBaseCount + (n - 1);
    for (let i = 0; i < count; i++) this._spawnAsteroidEdge();
    this.waveBanner = 1.6;
    sfx.wave();
  }

  _edgePos() {
    const { w, h } = this.world;
    if (Math.random() < 0.5) return { x: Math.random() < 0.5 ? -40 : w + 40, y: rand(0, h) };
    return { x: rand(0, w), y: Math.random() < 0.5 ? -40 : h + 40 };
  }

  _spawnAsteroidEdge() {
    const p = this._edgePos();
    const a = new Asteroid(p.x, p.y, 0);
    if (this.flags.explosive && Math.random() < CFG.explosiveChance) {
      a.volatile = true;
    } else {
      this._assignAsteroidType(a);
    }
    this.asteroids.push(a);
  }

  _assignAsteroidType(a) {
    if (Math.random() >= CFG.asteroidTypeChance) return;
    const types = [];
    if (this.flags.crystal)  types.push('crystal');
    if (this.flags.iron)     types.push('iron');
    if (this.flags.ice)      types.push('ice');
    if (this.flags.parasite) types.push('parasite');
    if (types.length === 0) return;
    a.kind = types[Math.floor(Math.random() * types.length)];
    if (a.kind === 'iron') a.hp = 2;
  }

  // ---- tap routing from menus ----
  tap() {
    if (this.state === STATE.TITLE || this.state === STATE.OVER) this.newGame();
    else if (this.state === STATE.PAUSED) this.state = STATE.PLAYING;
  }

  togglePause() {
    if (this.state === STATE.PLAYING) this.state = STATE.PAUSED;
    else if (this.state === STATE.PAUSED) this.state = STATE.PLAYING;
  }

  // ---------------- update ----------------
  update(dt) {
    this.shake.update(dt);
    this.titleSpin += dt * 0.3;

    if (this.planetMode) {
      this.pf.updateParticles(dt);
      if (this.state === STATE.PLAYING) this.pf.update(dt);
      return;
    }

    for (const p of this.particles) p.update(dt);
    this.particles = this.particles.filter((p) => !p.dead);

    if (this.state !== STATE.PLAYING) return;

    if (this.waveBanner > 0) this.waveBanner -= dt;

    // power-up timers
    for (const k of PU_KEYS) this.pu[k] = Math.max(0, this.pu[k] - dt);

    // combo decay
    if (this.flags.combo && this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) { this.comboCount = 0; this.mult = 1; }
    }

    // Time-slow scales hazard motion, never the player's.
    const hdt = this.pu.slow > 0 ? dt * CFG.slowFactor : dt;

    // ship
    this.ship.update(dt, this.world, this.steer);
    if (this.ship.thrusting && this.ship.thrustPuff <= 0) {
      this.ship.thrustPuff = 0.05;
      this._thrustParticles();
      sfx.thrust();
    }

    // firing (direction + on/off are driven by main per control scheme)
    this.fireCd = Math.max(0, this.fireCd - dt);
    if (this.firing && this.fireCd === 0) this._fire();

    // bullets (player at full speed, enemy bullets slowed by Time-slow)
    for (const b of this.bullets) {
      const dtb = b.fromUfo ? hdt : dt;
      if (b.homing && !b.fromUfo) this._homeBullet(b, dtb);
      b.update(dtb, this.world);
    }
    this.bullets = this.bullets.filter((b) => !b.dead);

    // asteroids
    for (const a of this.asteroids) a.update(hdt, this.world);

    // gravity wells pull most things
    if (this.flags.gravity) this._applyGravity(dt);

    this._updateUfos(hdt);
    if (this.flags.hunter) this._updateHunters(dt, hdt);
    if (this.flags.mine) this._updateMines(dt, hdt);
    if (this.flags.sniper) this._updateSnipers(dt, hdt);
    if (this.flags.gravity) this._updateWells(dt);

    // power-ups
    for (const p of this.powerups) p.update(dt, this.world);
    this.powerups = this.powerups.filter((p) => !p.dead);

    this._collisions();

    this._advanceWaveIfClear(dt);
  }

  _advanceWaveIfClear(dt) {
    this.asteroids = this.asteroids.filter((a) => {
      return !a._dead
        && Number.isFinite(a.x) && Number.isFinite(a.y)
        && Number.isFinite(a.vx) && Number.isFinite(a.vy);
    });

    const clear = this.asteroids.length === 0;
    const visible = !clear && this.asteroids.some((a) => (
      a.x + a.radius >= 0 && a.x - a.radius <= this.world.w
      && a.y + a.radius >= 0 && a.y - a.radius <= this.world.h
    ));

    if (clear || (!visible && (this.noAsteroidTimer += dt) >= CFG.flatWaveStragglerGrace)) {
      this.asteroids = [];
      this.noAsteroidTimer = 0;
      this.lives = Math.min(this.maxLives, this.lives + 1); // replenish 1 per wave
      this._startWave(this.wave + 1);
      return;
    }

    if (visible) this.noAsteroidTimer = 0;
  }

  _updateUfos(hdt) {
    this.ufoTimer -= hdt;
    if (this.ufoTimer <= 0 && this.ufos.length === 0 && this.wave >= CFG.ufoMinWave) {
      this.ufos.push(new Ufo(this.world));
      this.ufoTimer = rand(...CFG.ufoSpawnEvery);
      sfx.ufo();
    }
    for (const u of this.ufos) {
      u.update(hdt, this.world);
      u.fireTimer -= hdt;
      if (u.fireTimer <= 0 && this.ship) {
        u.fireTimer = CFG.ufoFireEvery;
        const ang = Math.atan2(this.ship.y - u.y, this.ship.x - u.x) + rand(-0.18, 0.18);
        this.bullets.push(new Bullet(u.x, u.y, ang, { fromEnemy: true }));
        sfx.ufoFire();
      }
    }
    this.ufos = this.ufos.filter((u) => !u.dead);
  }

  _updateHunters(dt, hdt) {
    this.hunterTimer -= dt;
    if (this.hunterTimer <= 0 && this.wave >= CFG.hunterMinWave) {
      const p = this._edgePos();
      this.hunters.push(new Hunter(p.x, p.y));
      this.hunterTimer = rand(...CFG.hunterEvery);
    }
    for (const h of this.hunters) h.update(hdt, this.world, this.ship);
    this.hunters = this.hunters.filter((h) => !h.dead);
  }

  _updateMines(dt, hdt) {
    this.mineTimer -= dt;
    if (this.mineTimer <= 0) {
      const p = this._edgePos();
      this.mines.push(new Mine(p.x, p.y));
      this.mineTimer = rand(...CFG.mineEvery);
    }
    for (const m of this.mines) m.update(hdt, this.world);
    this.mines = this.mines.filter((m) => !m.dead);
  }

  _updateSnipers(dt, hdt) {
    this.sniperTimer -= dt;
    if (this.sniperTimer <= 0 && this.snipers.length === 0 && this.wave >= CFG.sniperMinWave) {
      this.snipers.push(new Sniper(this.world));
      this.sniperTimer = rand(...CFG.sniperEvery);
      sfx.ufo();
    }
    for (const sn of this.snipers) {
      sn.update(hdt, this.world);
      if (this.ship) sn.aim = Math.atan2(this.ship.y - sn.y, this.ship.x - sn.x);
      if (sn.charge >= CFG.sniperCharge && this.ship) {
        sn.charge = 0;
        this.bullets.push(new Bullet(sn.x, sn.y, sn.aim,
          { fromEnemy: true, speed: CFG.sniperBulletSpeed, color: COLORS.sniper, life: 2.6 }));
        sfx.ufoFire();
      }
    }
    this.snipers = this.snipers.filter((sn) => !sn.dead);
  }

  _updateWells(dt) {
    this.gravTimer -= dt;
    if (this.gravTimer <= 0) {
      const { w, h } = this.world;
      this.wells.push(new GravityWell(rand(w * 0.2, w * 0.8), rand(h * 0.2, h * 0.8)));
      this.gravTimer = rand(...CFG.gravityEvery);
    }
    for (const wl of this.wells) wl.update(dt);
    this.wells = this.wells.filter((wl) => !wl.dead);
  }

  _applyGravity(dt) {
    for (const wl of this.wells) {
      const pull = (e) => {
        const dx = wl.x - e.x, dy = wl.y - e.y;
        const d2 = dx * dx + dy * dy;
        const d = Math.sqrt(d2) || 1;
        if (d > wl.radius) return;
        const f = CFG.gravityForce / Math.max(d2, 400);
        e.vx += (dx / d) * f * dt;
        e.vy += (dy / d) * f * dt;
      };
      if (this.ship) pull(this.ship);
      for (const a of this.asteroids) pull(a);
      for (const h of this.hunters) pull(h);
      for (const m of this.mines) pull(m);
    }
  }

  _homeBullet(b, dt) {
    let best = null, bd = Infinity;
    const consider = (t) => {
      const dx = t.x - b.x, dy = t.y - b.y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = t; }
    };
    for (const a of this.asteroids) consider(a);
    for (const u of this.ufos) consider(u);
    for (const h of this.hunters) consider(h);
    for (const sn of this.snipers) consider(sn);
    if (!best) return;
    const desired = Math.atan2(best.y - b.y, best.x - b.x);
    const max = CFG.homingTurn * dt;
    b.angle += clamp(angleDelta(b.angle, desired), -max, max);
    b.vx = Math.cos(b.angle) * b.speed;
    b.vy = Math.sin(b.angle) * b.speed;
  }

  _fire() {
    const playerBullets = this.bullets.reduce((n, b) => n + (b.fromUfo ? 0 : 1), 0);
    if (playerBullets >= CFG.maxBullets) return;
    const s = this.ship;
    const ang = this.fireAngle; // == ship heading in classic, aim stick in twin-stick
    const nx = s.x + Math.cos(ang) * s.radius * 1.3;
    const ny = s.y + Math.sin(ang) * s.radius * 1.3;
    this.fireCd = this.pu.rapid > 0 ? CFG.rapidCooldown : this.rlFireCooldown;
    // Put the straight shot first so it is retained when only one pool slot
    // remains, and never let a spread volley overflow the player-bullet cap.
    const angles = (this.pu.spread > 0 ? [ang, ang - 0.22, ang + 0.22] : [ang])
      .slice(0, CFG.maxBullets - playerBullets);
    const opts = { pierce: this.pu.pierce > 0, homing: this.pu.homing > 0, speed: this.rlBulletSpeed };
    for (const a of angles) this.bullets.push(new Bullet(nx, ny, a, opts));
    sfx.fire();
  }

  _thrustParticles() {
    const s = this.ship;
    const back = s.angle + Math.PI;
    for (let i = 0; i < 2; i++) {
      const a = back + rand(-0.4, 0.4);
      const sp = rand(60, 140);
      this.particles.push(new Particle(
        s.x + Math.cos(back) * s.radius, s.y + Math.sin(back) * s.radius,
        Math.cos(a) * sp, Math.sin(a) * sp, rand(0.2, 0.4), COLORS.thrust, 'dot'));
    }
  }

  _burst(x, y, n, color, speed, size = 1) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const sp = rand(speed * 0.4, speed);
      this.particles.push(new Particle(
        x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.3, 0.7) * size, color));
    }
  }

  // Score with the combo multiplier (arcade only).
  _award(points) {
    if (this.flags.combo) {
      this.comboCount++;
      this.comboTimer = CFG.comboWindow;
      this.mult = Math.min(CFG.comboMax, 1 + Math.floor(this.comboCount / 3));
      this.score += points * this.mult;
    } else {
      this.score += points;
    }
  }

  _collisions() {
    const hit = (a, b, pad = 0) => Math.hypot(a.x - b.x, a.y - b.y) < a.radius + b.radius + pad;

    // player bullets vs asteroids (indexed: children appended this frame are skipped)
    for (const b of this.bullets) {
      if (b.fromUfo || b.dead) continue;
      const n = this.asteroids.length;
      for (let i = 0; i < n; i++) {
        const a = this.asteroids[i];
        if (!a._dead && hit(b, a)) {
          if (!b.pierce) b.life = 0;
          this._destroyAsteroid(a);
          if (b.dead) break;
        }
      }
    }
    this.asteroids = this.asteroids.filter((a) => !a._dead);

    // player bullets vs enemies
    for (const b of this.bullets) {
      if (b.fromUfo || b.dead) continue;
      for (const u of this.ufos) {
        if (!u.dead && !b.dead && hit(b, u)) {
          if (!b.pierce) b.life = 0;
          u.dead = true; this._award(CFG.ufoScore);
          this._burst(u.x, u.y, 26, COLORS.ufo, 240, 1.3); this.shake.add(10);
          sfx.explode(1.4); this._maybeDropPowerup(u.x, u.y);
        }
      }
      for (const h of this.hunters) {
        if (!h.dead && !b.dead && hit(b, h)) {
          if (!b.pierce) b.life = 0;
          h.dead = true; this._award(CFG.hunterScore);
          this._burst(h.x, h.y, 16, COLORS.hunter, 200); this.shake.add(6);
          sfx.explode(0.7); this._maybeDropPowerup(h.x, h.y);
        }
      }
      for (const m of this.mines) {
        if (!m.dead && !b.dead && hit(b, m)) {
          if (!b.pierce) b.life = 0;
          m.dead = true; this._award(CFG.mineScore);
          this._burst(m.x, m.y, 18, COLORS.mine, 220); this.shake.add(7);
          sfx.explode(0.9);
        }
      }
      for (const sn of this.snipers) {
        if (!sn.dead && !b.dead && hit(b, sn)) {
          if (!b.pierce) b.life = 0;
          sn.hp--;
          this._burst(sn.x, sn.y, 6, COLORS.sniper, 140);
          if (sn.hp <= 0) {
            sn.dead = true; this._award(CFG.sniperScore);
            this._burst(sn.x, sn.y, 24, COLORS.sniper, 240); this.shake.add(10);
            sfx.explode(1.3); this._maybeDropPowerup(sn.x, sn.y);
          }
        }
      }
    }
    this.ufos = this.ufos.filter((u) => !u.dead);
    this.hunters = this.hunters.filter((h) => !h.dead);
    this.mines = this.mines.filter((m) => !m.dead);
    this.snipers = this.snipers.filter((sn) => !sn.dead);

    if (!this.ship) return;
    const s = this.ship;

    // power-up pickup (allowed even while invulnerable)
    for (const p of this.powerups) {
      if (!p.dead && hit(s, p, 4)) { p.life = 0; this._applyPowerup(p.type); }
    }

    if (s.invuln > 0) return;
    const shielded = this.pu.shield > 0;

    // enemy bullets
    for (const b of this.bullets) {
      if (b.fromUfo && !b.dead && hit(b, s)) {
        b.life = 0;
        if (shielded) this._breakShield(); else this._damageShip();
        return;
      }
    }
    // asteroids
    for (const a of this.asteroids) {
      if (hit(s, a)) {
        if (shielded) { this._destroyAsteroid(a); this._breakShield(); this.asteroids = this.asteroids.filter((x) => !x._dead); }
        else this._damageShip();
        return;
      }
    }
    // ufo / sniper bodies
    for (const u of this.ufos) {
      if (!u.dead && hit(s, u)) {
        if (shielded) { u.dead = true; this._award(CFG.ufoScore); this._burst(u.x, u.y, 20, COLORS.ufo, 200); this._breakShield(); }
        else this._damageShip();
        return;
      }
    }
    for (const sn of this.snipers) {
      if (!sn.dead && hit(s, sn)) {
        if (shielded) { sn.dead = true; this._award(CFG.sniperScore); this._burst(sn.x, sn.y, 20, COLORS.sniper, 220); this._breakShield(); }
        else this._damageShip();
        return;
      }
    }
    // hunters ram
    for (const h of this.hunters) {
      if (!h.dead && hit(s, h)) {
        if (shielded) { h.dead = true; this._award(CFG.hunterScore); this._burst(h.x, h.y, 16, COLORS.hunter, 200); this._breakShield(); }
        else this._damageShip();
        return;
      }
    }
    // mines detonate on proximity
    for (const m of this.mines) {
      if (m.dead) continue;
      const d = Math.hypot(s.x - m.x, s.y - m.y);
      if (d < CFG.mineTrigger + s.radius) {
        m.dead = true;
        this._burst(m.x, m.y, 22, COLORS.mine, 240); this.shake.add(12); sfx.explode(1.0);
        if (shielded) this._breakShield(); else this._damageShip();
        return;
      }
    }
  }

  _destroyAsteroid(a) {
    if (a._dead) return;

    // Iron: absorb first hit, dent visible inner ring
    if (a.kind === 'iron' && a.hp > 1) {
      a.hp--;
      this._burst(a.x, a.y, 6, COLORS.iron, 100);
      this.shake.add(2);
      sfx.explode(0.5);
      return;
    }

    a._dead = true;
    this._award(a.score);
    sfx.explode(1 - a.tier * 0.3);
    this._maybeDropPowerup(a.x, a.y);

    if (a.volatile && this.flags.explosive) {
      // chain detonation: big blast, no split, take out nearby rocks
      this._burst(a.x, a.y, 26, COLORS.volatile, 280, 1.4);
      this.shake.add(12);
      for (const o of this.asteroids) {
        if (!o._dead && Math.hypot(o.x - a.x, o.y - a.y) < CFG.explosiveRadius) {
          this._destroyAsteroid(o);
        }
      }
      return;
    }

    if (a.kind === 'crystal' && a.tier < CFG.astTiers.length - 1) {
      // Crystal: fast shards instead of normal split
      this._burst(a.x, a.y, 18, COLORS.crystal, 220, 1.1);
      this.shake.add(5);
      for (let i = 0; i < CFG.crystalShardCount; i++) {
        const shard = new Asteroid(a.x, a.y, a.tier + 1);
        shard.vx *= CFG.crystalSpeedMult;
        shard.vy *= CFG.crystalSpeedMult;
        shard.kind = 'crystal';
        this.asteroids.push(shard);
      }
      return;
    }

    if (a.kind === 'ice' && a.tier < CFG.astTiers.length - 1) {
      // Ice: many tiny low-score shards. The tier guard is essential — the
      // shards are the smallest tier, so they fall through to the normal
      // (no-split) path instead of re-shattering into 4 more ice each forever.
      this._burst(a.x, a.y, 20, COLORS.ice, 180, 0.9);
      this.shake.add(4);
      for (let i = 0; i < CFG.iceShardCount && this.asteroids.length < 240; i++) {
        const shard = new Asteroid(a.x, a.y, 2);
        shard.score = CFG.iceShardScore;
        shard.kind = 'ice';
        this.asteroids.push(shard);
      }
      return;
    }

    if (a.kind === 'parasite') {
      // Parasite: release a hunter
      this._burst(a.x, a.y, 14, COLORS.parasite, 180, 1.0);
      this.shake.add(5);
      if (this.flags.hunter) this.hunters.push(new Hunter(a.x, a.y));
      // still do normal split for remaining tiers
      if (a.tier < CFG.astTiers.length - 1) {
        for (let i = 0; i < 2; i++) this.asteroids.push(new Asteroid(a.x, a.y, a.tier + 1));
      }
      return;
    }

    this._burst(a.x, a.y, 14 + a.tier * 2, COLORS.fg, 160 + a.tier * 40, 1 - a.tier * 0.2);
    this.shake.add(6 - a.tier * 1.5);
    if (a.tier < CFG.astTiers.length - 1) {
      for (let i = 0; i < 2; i++) this.asteroids.push(new Asteroid(a.x, a.y, a.tier + 1));
    }
  }

  _maybeDropPowerup(x, y) {
    if (Math.random() > CFG.powerupDropChance) return;
    const type = Math.random() < CFG.lifeDropChance
      ? 'life'
      : this.pool[randInt(0, this.pool.length - 1)];
    this.powerups.push(new PowerUp(x, y, type));
  }

  _applyPowerup(type) {
    const def = POWERUPS[type];
    if (def.instant) {
      if (type === 'bomb') this._bomb();
      else if (type === 'life') this._gainLife();
    } else {
      this.pu[type] = def.duration * this.rlPuMult;
    }
    this._burst(this.ship.x, this.ship.y, 18, def.color, 180);
    sfx.powerup();
  }

  // Heal pickup: back to 3 if under, otherwise +1, capped at maxLives.
  _gainLife() {
    this.lives = Math.min(this.maxLives, this.lives < 3 ? 3 : this.lives + 1);
  }

  // Screen-clearing bomb: vaporise all asteroids + arcade enemies.
  _bomb() {
    this.shake.add(22);
    sfx.explode(1.6);
    for (const a of [...this.asteroids]) {
      if (a._dead) continue;
      a._dead = true; this._award(a.score);
      this._burst(a.x, a.y, 12, COLORS.bomb, 240);
    }
    this.asteroids = this.asteroids.filter((a) => !a._dead);
    const wipe = (list, score, color) => {
      for (const e of list) {
        if (e.dead) continue;
        e.dead = true; this._award(score);
        this._burst(e.x, e.y, 16, color, 220);
      }
    };
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
    this.pu.shield = 0;
    this.ship.invuln = 1.2;
    this._burst(this.ship.x, this.ship.y, 22, COLORS.shield, 220);
    this.shake.add(8);
    sfx.explode(0.8);
  }

  _damageShip() {
    const s = this.ship;
    this._burst(s.x, s.y, 30, COLORS.fg, 260, 1.4);
    this.shake.add(16);
    sfx.death();
    if (settings.haptics && navigator.vibrate) navigator.vibrate(120);
    this.comboCount = 0; this.comboTimer = 0; this.mult = 1;
    this.lives--;
    if (this.lives <= 0) {
      this.ship = null;
      this.state = STATE.OVER;
      this.newHigh = this.score > this.high;
      this.high = setHighScore(this.score);
      this._awardMinerals();
    } else {
      this._spawnShip();
    }
  }

  _awardMinerals() {
    const base = Math.floor(this.score / 100) + this.wave * 20;
    const bonusMult = 1 + (this.rl?.upgrades?.mineralBonus || 0) * 0.20;
    const earned = Math.floor(base * bonusMult);
    this.mineralsEarned = earned;
    const rl = getRoguelite();
    rl.minerals = (rl.minerals || 0) + earned;
    setRoguelite(rl);
    this.rl = rl;
  }

  // ---------------- render ----------------
  renderWorld(ctx, zoom, play) {
    if (this.planetMode) { this.pf.render(ctx, play, this.shake); return; }
    ctx.save();
    ctx.beginPath();
    ctx.rect(play.x, play.y, play.w, play.h);
    ctx.clip();
    ctx.translate(play.x + this.shake.x, play.y + this.shake.y);
    ctx.scale(zoom, zoom);

    for (const wl of this.wells) wl.draw(ctx);
    for (const p of this.particles) p.draw(ctx);
    for (const a of this.asteroids) a.draw(ctx);
    for (const m of this.mines) m.draw(ctx);
    for (const h of this.hunters) h.draw(ctx);
    for (const u of this.ufos) u.draw(ctx);
    for (const sn of this.snipers) sn.draw(ctx);
    for (const b of this.bullets) b.draw(ctx);
    for (const p of this.powerups) p.draw(ctx);
    if (this.ship) this.ship.draw(ctx, this.pu.shield > 0);

    // twin-stick aim reticle: shows where shots are going
    if (settings.twinStick && this.ship && this.firing) {
      const s = this.ship, a = this.fireAngle, len = 34;
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = COLORS.thrust;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x + Math.cos(a) * s.radius, s.y + Math.sin(a) * s.radius);
      ctx.lineTo(s.x + Math.cos(a) * (s.radius + len), s.y + Math.sin(a) * (s.radius + len));
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s.x + Math.cos(a) * (s.radius + len), s.y + Math.sin(a) * (s.radius + len), 3, 0, TAU);
      ctx.fillStyle = COLORS.thrust; ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  renderHud(ctx, screen, play, view) {
    const w = screen.w;
    const pad = 18 + view.top;
    ctx.textBaseline = 'top';
    ctx.fillStyle = COLORS.fg;

    // score
    ctx.textAlign = 'left';
    ctx.font = '700 26px ui-monospace, monospace';
    ctx.fillText(String(this.score).padStart(5, '0'), 18 + view.left, pad);
    ctx.fillStyle = COLORS.dim;
    ctx.font = '600 13px ui-monospace, monospace';
    ctx.fillText('HI ' + String(this.high).padStart(5, '0'), 18 + view.left, pad + 30);

    // combo multiplier
    if (this.flags.combo && this.mult > 1) {
      ctx.fillStyle = COLORS.combo;
      ctx.font = '800 20px ui-monospace, monospace';
      ctx.fillText('x' + this.mult, 18 + view.left, pad + 48);
    }

    // lives + wave, top-right (offset to clear the gear button)
    ctx.textAlign = 'right';
    const rx = w - 18 - view.right - 52;
    ctx.fillStyle = COLORS.dim;
    ctx.font = '600 13px ui-monospace, monospace';
    ctx.fillText('WAVE ' + this.wave, rx, pad + 30);
    glow(ctx, COLORS.fg, 4);
    for (let i = 0; i < this.lives; i++) this._lifeGlyph(ctx, rx - i * 22 - 8, pad + 10);
    noGlow(ctx);

    // active power-up pips
    let pi = 0;
    for (const k of PU_KEYS) {
      if (this.pu[k] <= 0) continue;
      const y = pad + 48 + pi * 12;
      ctx.fillStyle = COLORS.dim;
      ctx.fillRect(rx - 60, y, 60, 4);
      ctx.fillStyle = POWERUPS[k].color;
      const fullDuration = POWERUPS[k].duration * this.rlPuMult;
      ctx.fillRect(rx - 60, y, 60 * clamp(this.pu[k] / fullDuration, 0, 1), 4);
      pi++;
    }

    // wave banner
    if (this.waveBanner > 0 && this.state === STATE.PLAYING) {
      ctx.globalAlpha = clamp(this.waveBanner, 0, 1);
      ctx.textAlign = 'center';
      ctx.fillStyle = COLORS.fg;
      ctx.font = '700 22px ui-monospace, monospace';
      ctx.fillText('WAVE ' + this.wave, play.x + play.w / 2, play.y + play.h * 0.3);
      ctx.globalAlpha = 1;
    }
  }

  _lifeGlyph(ctx, x, y) {
    const r = 8;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x - r * 0.7, y + r * 0.7);
    ctx.lineTo(x + r * 0.7, y + r * 0.7);
    ctx.closePath();
    ctx.strokeStyle = COLORS.fg;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  _title(ctx, x, y, text, size, color = COLORS.fg, glowAmt = 6) {
    glow(ctx, color, glowAmt);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${size}px ui-monospace, monospace`;
    ctx.fillText(text, x, y);
    noGlow(ctx);
  }

  _ensureStars(w, h) {
    if (this._stars && this._starsW === w && this._starsH === h) return;
    this._starsW = w; this._starsH = h;
    const n = Math.round(clamp(w * h / 9000, 40, 90));
    const stars = [];
    for (let i = 0; i < n; i++) {
      const accent = Math.random() < 0.12;
      stars.push({
        x: Math.random() * w, y: Math.random() * h,
        r: rand(0.6, 1.9), ph: rand(0, TAU), spd: rand(0.5, 2.0), base: rand(0.22, 0.9),
        color: accent ? (Math.random() < 0.5 ? COLORS.thrust : COLORS.well) : COLORS.fg,
      });
    }
    this._stars = stars;
  }

  _drawStarfield(ctx, w, h) {
    this._ensureStars(w, h);
    const t = performance.now() / 1000;
    for (const s of this._stars) {
      ctx.globalAlpha = clamp(s.base * (0.45 + 0.55 * Math.sin(t * s.spd + s.ph)), 0, 1);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fillStyle = s.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  renderOverlay(ctx, screen) {
    if (this.state === STATE.PLAYING) return;
    const w = screen.w, h = screen.h;
    if (this.state === STATE.PAUSED) {
      // keep the frozen board faintly visible behind the pause text
      ctx.fillStyle = 'rgba(8,8,10,0.62)';
      ctx.fillRect(0, 0, w, h);
    } else {
      // TITLE / OVER: a clean space backdrop instead of frozen gameplay
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#06070b');
      bg.addColorStop(1, '#0a0b12');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      this._drawStarfield(ctx, w, h);
    }
    const cx = w / 2, cy = h / 2;
    const big = Math.min(w * 0.13, 64);
    const modeTag = settings.planet ? 'PLANET MODE' : settings.arcade ? 'ARCADE MODE' : 'CLASSIC MODE';

    if (this.state === STATE.TITLE) {
      this._title(ctx, cx, cy - big, 'ASTEROIDS', big, COLORS.fg, 10);
      ctx.fillStyle = settings.planet ? COLORS.well : settings.arcade ? COLORS.spread : COLORS.dim;
      ctx.font = '700 13px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(modeTag, cx, cy - big + big * 0.62);
      this._pulseHint(ctx, cx, cy + 6, 'TAP TO START');
      ctx.fillStyle = COLORS.dim;
      ctx.font = '600 13px ui-monospace, monospace';
      const ctrl = settings.twinStick
        ? 'left pad steers · right pad aims & fires'
        : 'left pad steers · right toggles autofire';
      ctx.fillText(ctrl, cx, cy + 44);
      ctx.fillText('gear → settings  ·  ⬡ UPGRADES for permanent perks', cx, cy + 66);
    } else if (this.state === STATE.OVER) {
      this._title(ctx, cx, cy - big * 0.9, 'GAME OVER', big * 0.8, COLORS.ufo, 12);
      ctx.fillStyle = COLORS.fg;
      ctx.font = '700 28px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SCORE ' + this.score, cx, cy + 4);
      ctx.fillStyle = this.newHigh ? COLORS.rapid : COLORS.dim;
      ctx.font = '600 15px ui-monospace, monospace';
      ctx.fillText((this.newHigh ? 'NEW BEST · ' : 'BEST ') + this.high, cx, cy + 36);
      if (this.mineralsEarned > 0) {
        ctx.fillStyle = COLORS.mineral;
        ctx.font = '600 14px ui-monospace, monospace';
        ctx.fillText('+' + this.mineralsEarned + ' minerals', cx, cy + 58);
      }
      this._pulseHint(ctx, cx, cy + 86, 'TAP TO PLAY AGAIN');
      ctx.fillStyle = COLORS.dim;
      ctx.font = '600 13px ui-monospace, monospace';
      ctx.fillText('⬡ tap UPGRADES to spend minerals', cx, cy + 118);
    } else if (this.state === STATE.PAUSED) {
      this._title(ctx, cx, cy - 20, 'PAUSED', big * 0.7, COLORS.fg, 8);
      this._pulseHint(ctx, cx, cy + 36, 'TAP TO RESUME');
    }
  }

  _pulseHint(ctx, x, y, text) {
    const a = 0.55 + 0.45 * Math.sin(performance.now() / 320);
    ctx.globalAlpha = a;
    ctx.fillStyle = COLORS.thrust;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 18px ui-monospace, monospace';
    glow(ctx, COLORS.thrust, 10);
    ctx.fillText(text, x, y);
    noGlow(ctx);
    ctx.globalAlpha = 1;
  }
}

export { STATE };
