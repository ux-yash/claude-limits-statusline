#!/usr/bin/env node
// Claude Code status line: model, folder, context, and your 5-hour and weekly plan usage.
// `--print zsh|tmux|plain` prints the last known usage instead, for a shell prompt or tmux bar.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PKG = 'claude-limits-statusline';
const USAGE_URL = 'https://claude.ai/settings/usage';
const CONFIG = 'limits-statusline.json';
const CACHE = 'limits-statusline-cache.json';
const UPDATE = 'limits-statusline-update.json';
const DAY = 86400 * 1000;
const WEEK = 7 * 86400;
const WINDOWS = [
  { key: 'five_hour', label: '5h', name: '5-hour', seconds: 5 * 3600 },
  { key: 'seven_day', label: '7d', name: 'weekly', seconds: WEEK },
];
const ALERT_AT = [80, 95];
const LEVELS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
const GREEN = '32', YELLOW = '33', ORANGE = '38;5;208', RED = '31', DIM = '2';
const TMUX = { [GREEN]: 'fg=green', [YELLOW]: 'fg=yellow', [ORANGE]: 'fg=colour208', [RED]: 'fg=red', [DIM]: 'dim' };
const FORMATS = {
  ansi: (c, s) => `\x1b[${c}m${s}\x1b[0m`,
  zsh: (c, s) => `%{\x1b[${c}m%}${s.replace(/%/g, '%%')}%{\x1b[0m%}`,
  tmux: (c, s) => `#[${TMUX[c]}]${s}#[default]`,
  plain: (c, s) => s,
};
const ansi = FORMATS.ansi;

const clamp = n => Math.max(0, Math.min(100, Math.round(n)));
const level = pct => LEVELS[Math.min(7, Math.floor(pct / 12.5))];
const rawColor = pct => (pct < 50 ? GREEN : pct < 65 ? YELLOW : pct < 80 ? ORANGE : RED);
const dur = s => { const m = Math.max(1, Math.round(s / 60)); return m >= 1440 ? `${Math.floor(m / 1440)}d` : m >= 60 ? `${Math.floor(m / 60)}h` : `${m}m`; };
const meter = (paint, label, pct, color) => `${paint(DIM, label)} ${paint(color, `${level(pct)} ${pct}%`)}`;

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function writeJSON(file, value) {
  try {
    // rename is atomic, so other sessions never read half a file
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value));
    fs.renameSync(tmp, file);
  } catch (e) {}
}

// Where a window ends up if you keep using it at your average rate so far.
function assess(w, seconds, nowSec) {
  const pct = clamp(w.used_percentage);
  if (!w.resets_at) return { pct };
  const left = Math.max(0, w.resets_at - nowSec);
  // too early in a window to judge pace: count at least a tenth of it as passed
  const rate = w.used_percentage / Math.max(seconds - left, seconds / 10);
  const end = w.used_percentage + rate * left;
  const outIn = w.used_percentage < 100 && end > 100 ? (100 - w.used_percentage) / rate : null;
  return { pct, left, end, outIn };
}

// weekly pace, by where the week ends up at your average rate so far
const PACE = [[100, '🔥', 'too fast', RED], [85, '🏃', 'fast', YELLOW], [50, '🚶', 'steady', DIM], [0, '🐢', 'slow', DIM]];

const BUFFER = 3;

// keep the previous level until the week moves BUFFER points past its edge, so it doesn't flicker
function paceLevel(end, prev) {
  const i = PACE.findIndex(([min]) => end >= min);
  if (prev == null || prev === i || !PACE[prev]) return i;
  const lo = PACE[prev][0] - BUFFER, hi = prev ? PACE[prev - 1][0] + BUFFER : Infinity;
  return end >= lo && end < hi ? prev : i;
}

function paceText(w, now, paint, stale, prev) {
  const a = assess(w, WEEK, now / 1000);
  if (a.end == null) return '';
  const [, icon, word, color] = PACE[paceLevel(a.end, prev)];
  return `${icon} ${paint(stale ? DIM : color, a.outIn != null ? `${word}, out in ${dur(a.outIn)}` : word)}`;
}

function usageText(windows, now, paint = ansi, stale = false, prevPace = null) {
  if (!windows) return '';
  const meters = WINDOWS.filter(win => windows[win.key]).map(win => {
    const a = assess(windows[win.key], win.seconds, now / 1000);
    const reset = a.left != null && a.pct >= 50 ? paint(DIM, ` ${dur(a.left)}`) : '';
    return meter(paint, win.label, a.pct, stale ? DIM : rawColor(a.pct)) + reset;
  }).join(' ');
  const pace = windows.seven_day ? paceText(windows.seven_day, now, paint, stale, prevPace) : '';
  return [meters, pace].filter(Boolean).join(' │ ');
}

// Usage only rises within a window and a new window resets later, so this picks the newer of two readings.
function freshest(a, b) {
  const ok = w => w && w.used_percentage != null;
  if (!ok(a) || !ok(b)) return ok(a) ? a : ok(b) ? b : null;
  const ra = a.resets_at || 0, rb = b.resets_at || 0;
  if (Math.abs(ra - rb) > 3600) return ra > rb ? a : b;
  return a.used_percentage >= b.used_percentage ? a : b;
}

function merge(live, cached, nowSec) {
  const out = {};
  for (const { key } of WINDOWS) {
    let w = freshest(live && live[key], cached && cached[key]);
    if (w && w.resets_at && w.resets_at <= nowSec) w = { used_percentage: 0 }; // that window has reset
    if (w) out[key] = w;
  }
  return Object.keys(out).length ? out : null;
}

function alerts(windows, alerted, nowSec, send) {
  for (const win of WINDOWS) {
    const w = windows[win.key];
    if (!w || !w.resets_at) continue;
    let s = alerted[win.key];
    if (!s || Math.abs(s.resets_at - w.resets_at) > 3600) s = alerted[win.key] = { resets_at: w.resets_at, level: 0 };
    const hit = ALERT_AT.filter(t => w.used_percentage >= t).pop();
    if (hit > s.level) {
      s.level = hit;
      const a = assess(w, win.seconds, nowSec);
      send(`Claude ${win.name} limit at ${a.pct}%`, a.outIn != null ? `At this pace you'll run out in ${dur(a.outIn)}.` : `Resets in ${dur(a.left)}.`);
    }
  }
}

function detached(cmd, args) {
  try {
    const p = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    p.on('error', () => {});
    p.unref();
  } catch (e) {}
}

function notify(title, body) {
  if (process.platform === 'darwin') detached('osascript', ['-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv)', '-e', 'end run', title, body]);
  else if (process.platform === 'linux') detached('notify-send', [title, body]);
}

const spawnCheck = () => detached(process.execPath, [__filename, '--check-update']);

function newer(a, b) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

function updateHint(file, version, now, check) {
  if (!version) return '';
  const u = readJSON(file) || {};
  if (!(now - (u.checked_at || 0) < DAY)) {
    writeJSON(file, { ...u, checked_at: now });
    check();
  }
  return u.latest && newer(u.latest, version) ? `↑ update: npx ${PKG}` : '';
}

async function checkUpdate(file) {
  try {
    const r = await fetch(`https://registry.npmjs.org/${PKG}/latest`, { signal: AbortSignal.timeout(5000) });
    const { version } = r.ok ? await r.json() : {};
    if (version) writeJSON(file, { checked_at: Date.now(), latest: version });
  } catch (e) {}
}

function ownLine(data) {
  const parts = [ansi(DIM, data.model?.display_name || 'Claude'), ansi(DIM, path.basename(data.workspace?.current_dir || process.cwd()))];
  const used = data.context_window?.used_percentage;
  if (used != null) parts.push(meter(ansi, 'ctx', clamp(used), rawColor(clamp(used))));
  return parts.join(' │ ');
}

function render(raw, { now = Date.now(), dir = null, version = null, send = notify, check = spawnCheck } = {}) {
  let data = {};
  try { data = JSON.parse(raw); } catch (e) {}
  const base = ownLine(data);
  const live = data.rate_limits;
  let windows = merge(live, null, now / 1000);
  let hint = '';
  let pace = null;
  if (dir) {
    // share readings across sessions, so a new session shows usage before its first reply
    const file = path.join(dir, CACHE);
    const cache = readJSON(file) || {};
    const before = JSON.stringify(cache);
    cache.windows = merge(live, cache.windows, now / 1000);
    cache.alerted = cache.alerted || {};
    if (live && cache.windows) alerts(cache.windows, cache.alerted, now / 1000, send);
    const week = cache.windows && cache.windows.seven_day && assess(cache.windows.seven_day, WEEK, now / 1000);
    if (week && week.end != null) cache.pace = paceLevel(week.end, cache.pace);
    if (cache.windows && JSON.stringify(cache) !== before) writeJSON(file, cache);
    windows = cache.windows;
    pace = cache.pace ?? null;
    hint = updateHint(path.join(dir, UPDATE), version, now, check);
  }
  // dim until this session hears back itself
  const text = usageText(windows, now, ansi, !live, pace);
  return [base, text && `\x1b]8;;${USAGE_URL}\x07${text}\x1b]8;;\x07`, hint && ansi(DIM, hint)].filter(Boolean).join(' │ ');
}

module.exports = { paceLevel, usageText, merge, ownLine, render, updateHint, newer, FORMATS };

if (require.main === module) {
  const [mode, format] = process.argv.slice(2);
  if (mode === '--print') {
    const cache = readJSON(path.join(__dirname, CACHE)) || {};
    process.stdout.write(usageText(merge(null, cache.windows, Date.now() / 1000), Date.now(), FORMATS[format] || ansi, false, cache.pace));
  } else if (mode === '--check-update') {
    checkUpdate(path.join(__dirname, UPDATE));
  } else {
    const { version = null } = readJSON(path.join(__dirname, CONFIG)) || {};
    let raw = '';
    process.stdin.on('data', c => (raw += c));
    process.stdin.on('end', () => process.stdout.write(render(raw, { dir: __dirname, version })));
  }
}
