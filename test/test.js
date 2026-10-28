const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { paceLevel, usageText, merge, render, updateHint, newer, FORMATS } = require('../statusline.js');

const plain = s => s.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\]8;;[^\x07]*\x07/g, '');
const now = 1_000_000_000_000;
const at = mins => now / 1000 + mins * 60;
const five = (used, mins) => ({ five_hour: { used_percentage: used, ...(mins != null && { resets_at: at(mins) }) } });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cls-'));

test('meters: bar colour follows usage, reset time from 50%', () => {
  assert.strictEqual(plain(usageText(five(48, 240), now)), '5h ▄ 48%');
  assert.strictEqual(plain(usageText(five(85, 10), now)), '5h ▇ 85% 10m');
  assert.strictEqual(plain(usageText(five(100, 120), now)), '5h █ 100% 2h');
  const colour = w => usageText({ five_hour: w }, now).match(/\x1b\[([0-9;]+)m[▁-█]/)[1];
  assert.deepStrictEqual([10, 50, 65, 80].map(p => colour({ used_percentage: p, resets_at: at(240) })), ['32', '33', '38;5;208', '31']);
  assert.strictEqual(colour({ used_percentage: 48, resets_at: at(240) }), '32'); // burning fast, but the bar still shows usage
});

test('weekly pace after the meters', () => {
  const both = { five_hour: { used_percentage: 42.3, resets_at: at(125) }, seven_day: { used_percentage: 72, resets_at: at(3000) } };
  assert.strictEqual(plain(usageText(both, now)), '5h ▄ 42% 7d ▆ 72% 2d │ 🔥 too fast, out in 1d');
  const pace = used => usageText({ seven_day: { used_percentage: used, resets_at: at(84 * 60) } }, now).split(' │ ')[1]; // halfway through the week
  assert.deepStrictEqual([55, 45, 30, 20].map(u => plain(pace(u))), ['🔥 too fast, out in 2d', '🏃 fast', '🚶 steady', '🐢 slow']);
  assert.deepStrictEqual([55, 45, 30].map(u => pace(u).match(/\x1b\[([0-9;]+)m/)[1]), ['31', '33', '2']);
  assert.strictEqual(plain(usageText({ seven_day: { used_percentage: 3, resets_at: at(10000) } }, now)), '7d ▁ 3% │ 🐢 slow'); // 80 minutes in: too early to judge
});

test('level steps', () => {
  const bar = p => plain(usageText({ five_hour: { used_percentage: p } }, now)).split(' ')[1];
  assert.deepStrictEqual([0, 12, 13, 25, 50, 75, 87, 88, 100].map(bar), ['▁', '▁', '▂', '▃', '▅', '▇', '▇', '█', '█']);
});

test('missing data shows nothing', () => {
  assert.strictEqual(usageText(null, now), '');
  assert.strictEqual(merge(undefined, null, now / 1000), null);
});

test('merge keeps the newest reading', () => {
  const sec = now / 1000;
  const older = { used_percentage: 40, resets_at: at(100) }, newest = { used_percentage: 60, resets_at: at(100) };
  assert.strictEqual(merge({ five_hour: older }, { five_hour: newest }, sec).five_hour, newest); // an idle session can't roll it back
  const next = { used_percentage: 5, resets_at: at(400) };
  assert.strictEqual(merge({ five_hour: next }, { five_hour: newest }, sec).five_hour, next); // a new window wins
  assert.deepStrictEqual(merge(null, { five_hour: { used_percentage: 90, resets_at: at(-1) } }, sec), { five_hour: { used_percentage: 0 } });
});

test('a session with no reading yet shows the last one, dimmed', () => {
  const dir = tmp();
  const session = { model: { display_name: 'Opus' }, workspace: { current_dir: '/x/proj' } };
  render(JSON.stringify({ ...session, rate_limits: five(30, 200) }), { dir, now });
  const out = render(JSON.stringify(session), { dir, now });
  assert.strictEqual(plain(out), 'Opus │ proj │ 5h ▃ 30%');
  assert.doesNotMatch(out, /\x1b\[3\d/);
  // a session holding an older, lower reading shows the newer one
  assert.strictEqual(plain(render(JSON.stringify({ ...session, rate_limits: five(20, 200) }), { dir, now })), 'Opus │ proj │ 5h ▃ 30%');
  fs.rmSync(dir, { recursive: true });
});

test('alerts once per threshold per window', () => {
  const dir = tmp(), sent = [];
  const run = (used, mins) => render(JSON.stringify({ rate_limits: five(used, mins) }), { dir, now, send: t => sent.push(t) });
  run(70, 100); run(82, 100); run(85, 100); run(96, 100);
  run(81, 400); // next window
  assert.deepStrictEqual(sent, ['Claude 5-hour limit at 82%', 'Claude 5-hour limit at 96%', 'Claude 5-hour limit at 81%']);
  fs.rmSync(dir, { recursive: true });
});

test('print formats for zsh, tmux and plain', () => {
  const w = five(42.3, 125);
  assert.strictEqual(usageText(w, now, FORMATS.plain), '5h ▄ 42%');
  assert.strictEqual(usageText(w, now, FORMATS.zsh), '%{\x1b[2m%}5h%{\x1b[0m%} %{\x1b[32m%}▄ 42%%%{\x1b[0m%}');
  assert.strictEqual(usageText(w, now, FORMATS.tmux), '#[dim]5h#[default] #[fg=green]▄ 42%#[default]');
});

test('update check runs daily and hints at newer versions', () => {
  const dir = tmp(), file = path.join(dir, 'update.json');
  let checks = 0;
  const check = () => checks++;
  assert.strictEqual(updateHint(file, null, now, check), '');
  assert.strictEqual(updateHint(file, '1.3.0', now, check), '');
  updateHint(file, '1.3.0', now + 1000, check);
  assert.strictEqual(checks, 1);
  fs.writeFileSync(file, JSON.stringify({ checked_at: now, latest: '1.10.0' }));
  assert.match(updateHint(file, '1.3.0', now, check), /npx claude-limits-statusline/);
  assert.strictEqual(updateHint(file, '1.10.0', now, check), '');
  assert.ok(newer('2.0.0', '1.9.9') && !newer('1.3.0', '1.3.0') && !newer('1.2.9', '1.3.0'));
  fs.rmSync(dir, { recursive: true });
});

test('model, folder and context bar', () => {
  const raw = JSON.stringify({ model: { display_name: 'Opus' }, workspace: { current_dir: '/x/proj' }, context_window: { used_percentage: 30 } });
  assert.strictEqual(plain(render(raw, { now })), 'Opus │ proj │ ctx ▃ 30%');
});

test('links the usage to claude.ai', () => {
  const out = render(JSON.stringify({ model: { display_name: 'Opus' }, workspace: { current_dir: '/x/proj' }, rate_limits: five(20) }), { now });
  assert.strictEqual(plain(out), 'Opus │ proj │ 5h ▂ 20%');
  assert.ok(out.includes('\x1b]8;;https://claude.ai/settings/usage\x07'));
});

test('installer: install, update, print, uninstall', () => {
  const dir = tmp(), hooks = path.join(dir, 'hooks');
  const env = { ...process.env, CLAUDE_CONFIG_DIR: dir };
  const run = (...a) => execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'install.js'), ...a], { env }).toString();
  const settings = () => JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ theme: 'dark', statusLine: { type: 'command', command: 'echo old', padding: 1 } }));

  run();
  assert.match(settings().statusLine.command, /limits-statusline\.js/);
  assert.strictEqual(settings().statusLine.padding, 1);
  assert.strictEqual(settings().statusLine.refreshInterval, 30);
  assert.strictEqual(settings().theme, 'dark');
  run(); // an update must keep the original status line, not save itself
  const config = path.join(hooks, 'limits-statusline.json');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(config, 'utf8')), { previous: 'echo old', version: require('../package.json').version });
  assert.ok(fs.existsSync(path.join(hooks, 'limits-statusline.zsh')));

  fs.writeFileSync(path.join(hooks, 'limits-statusline-update.json'), JSON.stringify({ checked_at: Date.now() })); // no network in tests
  const input = JSON.stringify({ model: { display_name: 'Opus' }, workspace: { current_dir: '/x/proj' }, rate_limits: five(20) });
  const out = execFileSync('sh', ['-c', settings().statusLine.command], { input, env }).toString();
  assert.strictEqual(plain(out), 'Opus │ proj │ 5h ▂ 20%');
  const printed = execFileSync('sh', ['-c', `${settings().statusLine.command} --print plain`], { env }).toString();
  assert.strictEqual(printed, '5h ▂ 20%');

  fs.writeFileSync(config, JSON.stringify({ wrap: 'echo old', version: '1.4.0' })); // what 1.x saved
  run();
  assert.strictEqual(JSON.parse(fs.readFileSync(config, 'utf8')).previous, 'echo old');

  run('--uninstall');
  assert.strictEqual(settings().statusLine.command, 'echo old');
  assert.strictEqual(settings().statusLine.refreshInterval, undefined);
  assert.deepStrictEqual(fs.readdirSync(hooks), []);
  fs.rmSync(dir, { recursive: true });
});

test('pace sticks near a boundary instead of flickering', () => {
  assert.strictEqual(paceLevel(86, null), 1); // fast
  assert.strictEqual(paceLevel(84, 1), 1); // just under 85: stays fast
  assert.strictEqual(paceLevel(81, 1), 2); // 3+ points under: steady
  assert.strictEqual(paceLevel(87, 2), 2); // just over 85: stays steady
  assert.strictEqual(paceLevel(88, 2), 1); // 3+ points over: fast
  assert.strictEqual(paceLevel(101, 2), 0); // a big jump moves straight there
});

test('render remembers the pace level between runs', () => {
  const dir = tmp();
  const raw = JSON.stringify({ rate_limits: { seven_day: { used_percentage: 43, resets_at: at(84 * 60) } } });
  // no new usage while time passes, so the projected end drifts down
  const pace = hours => plain(render(raw, { dir, now: now + hours * 3600e3 })).split(' │ ').pop();
  assert.strictEqual(pace(0), '🏃 fast'); // ends at 86
  assert.strictEqual(pace(2), '🏃 fast'); // ends at 84, within the buffer
  assert.strictEqual(pace(6), '🚶 steady'); // ends at 80
  fs.rmSync(dir, { recursive: true });
});
