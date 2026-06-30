// Tiny localStorage wrapper for high score + settings. Fails silently offline/private mode.

const KEY = 'asteroids:v1';

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
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
  return read().high || 0;
}

export function setHighScore(score) {
  const data = read();
  if (score > (data.high || 0)) {
    data.high = score;
    write(data);
  }
  return data.high || 0;
}

export function getSettings() {
  return read().settings || {};
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
