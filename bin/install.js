#!/usr/bin/env node
// npx claude-limits-statusline              install or update
// npx claude-limits-statusline --uninstall  restore your previous status line
const fs = require('fs');
const path = require('path');
const os = require('os');
const { version } = require('../package.json');

const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const settingsPath = path.join(dir, 'settings.json');
const hooks = path.join(dir, 'hooks');
const script = path.join(hooks, 'limits-statusline.js');
const config = path.join(hooks, 'limits-statusline.json');
const zsh = path.join(hooks, 'limits-statusline.zsh');
const state = ['limits-statusline-cache.json', 'limits-statusline-update.json'].map(f => path.join(hooks, f));

let settings = {};
if (fs.existsSync(settingsPath)) {
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (e) {
    console.error(`Could not parse ${settingsPath}; leaving it alone.`);
    process.exit(1);
  }
  fs.copyFileSync(settingsPath, settingsPath + '.bak');
}
const REFRESH = 30;
const save = () => fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
const current = settings.statusLine?.command;
const installed = typeof current === 'string' && current.includes('limits-statusline.js');
// the status line you had before the first install, put back on uninstall
let previous = current || null;
if (installed) {
  try {
    const cfg = JSON.parse(fs.readFileSync(config, 'utf8'));
    previous = cfg.previous ?? cfg.wrap ?? null; // 1.x saved it as `wrap`
  } catch (e) { previous = null; }
}

if (process.argv.includes('--uninstall')) {
  if (installed) {
    const { refreshInterval, ...rest } = settings.statusLine;
    // keep a refresh interval only if it isn't the one we set
    if (previous) settings.statusLine = { ...rest, ...(refreshInterval !== REFRESH && { refreshInterval }), type: 'command', command: previous };
    else delete settings.statusLine;
    save();
  }
  for (const f of [script, config, zsh, ...state]) fs.rmSync(f, { force: true });
  console.log(previous ? `Restored your previous status line: ${previous}` : 'Removed the limits status line.');
  console.log('If you added the limits-statusline line to ~/.zshrc or ~/.tmux.conf, you can delete it.');
  process.exit(0);
}

const run = `"${process.execPath}" "${script}"`;
fs.mkdirSync(hooks, { recursive: true });
fs.copyFileSync(path.join(__dirname, '..', 'statusline.js'), script);
fs.writeFileSync(config, JSON.stringify({ previous, version }, null, 2) + '\n');
fs.writeFileSync(zsh, `# Claude usage in your right-hand prompt, from claude-limits-statusline.
zmodload zsh/datetime
autoload -Uz add-zsh-hook
setopt prompt_subst
_claude_limits_precmd() {
  (( EPOCHSECONDS - \${_claude_limits_at:-0} < 30 )) && return
  _claude_limits_at=$EPOCHSECONDS
  _claude_limits=$(${run} --print zsh 2>/dev/null)
}
add-zsh-hook precmd _claude_limits_precmd
[[ $RPROMPT == *_claude_limits* ]] || RPROMPT='\${_claude_limits}'"\${RPROMPT:+ $RPROMPT}"
`);
// re-run every 30s so countdowns and readings from other sessions stay current while idle
settings.statusLine = { refreshInterval: REFRESH, ...settings.statusLine, type: 'command', command: run };
save();

console.log(installed ? `Updated claude-limits-statusline to ${version}.` : `Installed claude-limits-statusline ${version}.`);
if (!installed && current) console.log(`It replaces your previous status line, which --uninstall puts back: ${current}`);
console.log('It shows up on the next status line refresh. Usage appears for Pro/Max plans after the first reply in a session.');
console.log(`\nTo see usage in your zsh prompt too, add this line to ~/.zshrc:\n  [ -f "${zsh}" ] && source "${zsh}"`);
console.log(`Or in tmux, add this line to ~/.tmux.conf:\n  set -ga status-right ' #(${run} --print tmux)'`);
