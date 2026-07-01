// Central palette + gameplay tunables. Logical units are CSS pixels.

export const COLORS = {
  bg: '#0a0a0a',
  fg: '#f4f4f5',        // near-white vector strokes
  dim: '#5a5a5e',       // muted UI
  thrust: '#22d3ee',    // electric cyan ship accent
  ufo: '#ff5a5f',       // warm danger
  ufoBullet: '#ff9d4d',
  // power-up signature colors
  rapid: '#ffb020',     // amber
  spread: '#ff36f5',    // magenta
  shield: '#a3e635',    // lime
  pierce: '#7dd3fc',    // sky
  homing: '#34d399',    // emerald
  slow: '#818cf8',      // indigo
  bomb: '#f43f5e',      // rose
  // arcade enemies / hazards
  hunter: '#fb7185',    // rose-pink
  mine: '#f59e0b',      // amber-deep
  sniper: '#e879f9',    // fuchsia
  well: '#a78bfa',      // violet
  combo: '#fde047',     // yellow
  volatile: '#fb923c',  // orange (explosive asteroid marker)
  // special asteroid types
  crystal: '#67e8f9',   // cyan
  iron: '#94a3b8',      // slate
  ice: '#bae6fd',       // pale blue
  parasite: '#c4b5fd',  // violet-pink
  life: '#2dd4bf',      // teal (heal / 1-UP)
  // roguelite
  mineral: '#4ade80',   // green
};

// `classic: true` => part of the base game (drops in both modes).
// Others are arcade-only and gated by their toggle. `instant: true` fires once.
export const POWERUPS = {
  rapid:  { color: COLORS.rapid,  glyph: 'R', duration: 8, classic: true },
  spread: { color: COLORS.spread, glyph: 'W', duration: 8, classic: true },
  shield: { color: COLORS.shield, glyph: 'S', duration: 7, classic: true },
  pierce: { color: COLORS.pierce, glyph: 'P', duration: 8 },
  homing: { color: COLORS.homing, glyph: 'H', duration: 8 },
  slow:   { color: COLORS.slow,   glyph: 'T', duration: 5 },
  bomb:   { color: COLORS.bomb,   glyph: 'B', instant: true },
  // heal: restores to 3 if under, else +1 (capped). Rare, drops in every mode.
  life:   { color: COLORS.life,   glyph: '+', instant: true },
};

export const CFG = {
  // physics
  step: 1 / 120,            // fixed physics timestep (s)
  maxFrame: 0.25,           // clamp huge frame gaps (s)

  // ship
  shipRadius: 14,
  shipThrust: 520,          // accel at full drag (px/s^2)
  shipMaxSpeed: 460,
  shipFriction: 0.6,        // per-second velocity damping factor
  turnLerp: 14,             // how fast ship rotates toward aim
  respawnInvuln: 2.5,       // seconds of blink-invulnerability

  // bullets
  bulletSpeed: 620,
  bulletLife: 0.9,          // seconds
  bulletRadius: 2.5,
  fireCooldown: 0.22,       // base seconds between shots
  rapidCooldown: 0.09,
  maxBullets: 24,

  // asteroids: tier index 0=large,1=medium,2=small
  astTiers: [
    { radius: 56, speed: 55,  score: 20 },
    { radius: 34, speed: 80,  score: 50 },
    { radius: 18, speed: 115, score: 100 },
  ],
  astBaseCount: 4,          // wave 1 large asteroids
  astWrapPad: 64,
  flatWaveStragglerGrace: 0.75, // max dead air in flat mode before advancing
  waveStragglerGrace: 3,    // planet mode: grace for backside/non-visible rocks

  // UFO
  ufoRadius: 18,
  ufoSpeed: 130,
  ufoScore: 200,
  ufoFireEvery: 1.4,        // seconds
  ufoBulletSpeed: 280,
  ufoMinWave: 2,
  ufoSpawnEvery: [14, 26],  // random seconds range

  // power-ups
  powerupDropChance: 0.16,
  powerupLife: 9,           // seconds it sits before vanishing
  powerupRadius: 16,

  // juice
  shakeDecay: 4.5,
  glow: 8,                  // shadowBlur in px

  // input
  tapMoveThreshold: 14,     // px movement under which a touch counts as a tap
  tapMaxTime: 0.28,         // s; quick release => fire
  steerDeadzone: 8,         // px drag before steering engages
  steerMaxDrag: 90,         // px drag mapped to full thrust

  startLives: 3,
  lifeCap: 5,               // max lives you can be replenished up to
  lifeDropChance: 0.14,     // chance a power-up drop is the rare life pickup

  // ---- arcade enemies ----
  hunterRadius: 11,
  hunterAccel: 360,
  hunterMaxSpeed: 190,
  hunterScore: 150,
  hunterEvery: [10, 18],
  hunterMinWave: 2,

  mineRadius: 13,
  mineScore: 80,
  mineDrift: 26,
  mineTrigger: 48,      // proximity detonation radius
  mineEvery: [12, 22],

  sniperRadius: 16,
  sniperScore: 300,
  sniperSpeed: 55,
  sniperHp: 2,
  sniperCharge: 1.3,    // seconds between aimed shots (telegraphed)
  sniperBulletSpeed: 540,
  sniperEvery: [18, 30],
  sniperMinWave: 3,

  // ---- arcade modifiers ----
  comboWindow: 2.2,     // seconds to keep a kill chain alive
  comboMax: 9,          // max multiplier
  explosiveChance: 0.2, // chance a spawned large asteroid is volatile
  explosiveRadius: 130, // chain blast radius
  gravityEvery: [16, 30],
  gravityRadius: 180,
  gravityForce: 14000,
  gravityLife: 9,
  slowFactor: 0.4,      // time-scale for hazards while Time-slow is active
  homingTurn: 4.0,      // rad/s steering of homing bullets

  // ---- special asteroid types ----
  asteroidTypeChance: 0.35, // chance a large rock gets a special type
  crystalShardCount: 4,
  crystalSpeedMult: 2.2,
  iceShardCount: 6,
  iceShardScore: 10,
};

// ---- small math utils ----
export const TAU = Math.PI * 2;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

// shortest signed angle from a to b
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d < -Math.PI) d += TAU;
  if (d > Math.PI) d -= TAU;
  return d;
}

// ---- roguelite upgrade definitions ----
// costs: array of mineral costs per level (length == maxLevel).
// Costs escalate steeply (~3-4x per level) so maxing out takes many good runs.
export const UPGRADES = [
  { key: 'extraLife',        label: 'Extra Life',       hint: '+1 starting life',         costs: [500, 2000, 6000] },
  { key: 'bulletSpeed',      label: 'Rapid Reflexes',   hint: '+8% bullet speed',          costs: [300, 1000, 3000] },
  { key: 'shipSpeed',        label: 'Afterburner',      hint: '+10% max ship speed',       costs: [300, 1000, 3000] },
  { key: 'fireRate',         label: 'Hair Trigger',     hint: '−0.02s fire cooldown',      costs: [400, 1400, 4200] },
  { key: 'powerupDuration',  label: 'Extended Effects', hint: '+15% power-up duration',    costs: [350, 1200, 3600] },
  { key: 'startShield',      label: 'Armored Entry',    hint: 'Start each life w/ 3s shield', costs: [1500] },
  { key: 'mineralBonus',     label: 'Prospector',       hint: '+20% mineral earnings',     costs: [300, 1000, 3000] },
];
