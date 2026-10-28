# claude-limits-statusline

See your Claude plan usage limits in the Claude Code status line while you work.

```
Opus │ my-project │ ctx ▃ 36% │ 5h ▅ 52% 4h 7d ▃ 35% │ 🚶 steady
```

- **5h**: your 5-hour session limit. **7d**: your weekly limit. **ctx**: this session's context window.
- Bars rise in eighths (▁▂▃▄▅▆▇█) and turn yellow from 50%, orange from 65%, red from 80%.
- Once a limit is at 50% or more, the time until it resets shows (`4h`).
- At the end is your **weekly pace**, from where the week ends up if you keep your average rate so far: 🐢 slow (under half your limit), 🚶 steady, 🏃 fast (you'll use nearly all of it), 🔥 too fast (you'll run out before it resets, and it says when: `out in 2d`).
- You get a desktop notification when a limit reaches 80% and 95% (macOS and Linux).
- Click the usage (Cmd+click) to open your usage page on claude.ai, in terminals that support links (iTerm2, Kitty, WezTerm, Ghostty).
- New sessions show your last known usage, dimmed, until their first reply.

## Install

```
npx claude-limits-statusline
```

If you already have a status line (GSD or your own), it stays, and your usage is added at the end. Run the same command again to update. The status line tells you when a new version is out.

Usage appears on Pro and Max plans. API-key users only see the context bar.

## In your shell prompt or tmux

The installer prints the exact lines for your machine. For zsh, add one line to `~/.zshrc` to show usage in the right-hand prompt:

```
[ -f "$HOME/.claude/hooks/limits-statusline.zsh" ] && source "$HOME/.claude/hooks/limits-statusline.zsh"
```

For tmux, it gives you a `status-right` line for `~/.tmux.conf`. Anything else can run `node ~/.claude/hooks/limits-statusline.js --print plain`.

## Uninstall

```
npx claude-limits-statusline --uninstall
```

This puts your previous status line back. `settings.json` is backed up to `settings.json.bak` before every change.

## Privacy

Everything stays on your machine, apart from one request a day to the npm registry to check for a new version.
