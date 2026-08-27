// Tiny localStorage wrapper for high score + settings. Fails silently offline/private mode.
import { UPGRADES } from './config.js';

const KEY = 'asteroids:v1';
const UPGRADE_LIMITS = Object.fromEntries(UPGRADES.map((u) => [u.key, u.costs.length]));

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonNegativeInt = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

function read() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY));
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function write(obj) {
  try {
    localStorage.setItem(KEY, JSON.stringify(obj));
  } catch {
    /* ignore */
  }
}

export function getHighScore() {
  return nonNegativeInt(read().high);
}

export function setHighScore(score) {
  const data = read();
  const current = nonNegativeInt(data.high);
  const candidate = nonNegativeInt(score);
  if (candidate > current) {
    data.high = candidate;
    write(data);
  }
  return Math.max(current, candidate);
}

export function getSettings() {
  const value = read().settings;
  return isRecord(value) ? value : {};
}

export function setSettings(obj) {
  const data = read();
  data.settings = obj;
  write(data);
}

export function isMuted() {
  return !!read().muted;
}

export function setMuted(muted) {
  const data = read();
  data.muted = !!muted;
  write(data);
}

export function getRoguelite() {
  const raw = read().roguelite;
  if (!isRecord(raw)) return { minerals: 0, upgrades: {} };
  const rawUpgrades = isRecord(raw.upgrades) ? raw.upgrades : {};
  const upgrades = {};
  for (const [key, max] of Object.entries(UPGRADE_LIMITS)) {
    const level = Math.min(max, nonNegativeInt(rawUpgrades[key]));
    if (level > 0) upgrades[key] = level;
  }
  return { minerals: nonNegativeInt(raw.minerals), upgrades };
}

export function setRoguelite(obj) {
  const data = read();
  const value = isRecord(obj) ? obj : {};
  const rawUpgrades = isRecord(value.upgrades) ? value.upgrades : {};
  const upgrades = {};
  for (const [key, max] of Object.entries(UPGRADE_LIMITS)) {
    const level = Math.min(max, nonNegativeInt(rawUpgrades[key]));
    if (level > 0) upgrades[key] = level;
  }
  data.roguelite = { minerals: nonNegativeInt(value.minerals), upgrades };
  write(data);
}
