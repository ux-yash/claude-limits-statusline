# claude-limits-statusline

See how much of your Claude plan you've used, right in the Claude Code status line, so a limit never catches you by surprise.

```
Opus │ my-project │ ctx ▃ 36% │ 5h ▅ 52% 4h 7d ▃ 35% │ 🚶 steady
```

## How to read it

| Part | What it means |
| --- | --- |
| `Opus` | The model you're using |
| `my-project` | The folder you're working in |
| `ctx ▃ 36%` | How full this conversation is. When it's full, Claude Code summarises older messages to make room. |
| `5h ▅ 52% 4h` | How much of your 5-hour limit you've used, and how long until it resets |
| `7d ▃ 35%` | How much of your weekly limit you've used |
| `🚶 steady` | How fast you're using your weekly limit |

Bars fill up as you use more and change colour: yellow at 50%, orange at 65%, red at 80%. The time until a limit resets appears once it's half used.

The emoji compares how much you've used with how much of the week has gone by:

- 🐢 **slow**: you'll use less than half of this week's limit
- 🚶 **steady**: you're on track
- 🏃 **fast**: you'll use almost all of it
- 🔥 **too fast**: you'll run out before the week resets, and it tells you when (`out in 2d`)

It also:

- sends a desktop notification when a limit reaches 80%, and again at 95% (macOS and Linux)
- opens your usage page on claude.ai when you Cmd+click the numbers (Ctrl+click on Linux), in terminals that support links such as iTerm2, Ghostty, Kitty and WezTerm
- shows your last known numbers, greyed out, in a new session until Claude first replies

## Install

You need Node.js 18 or later and a Claude Pro or Max plan.

```
npx claude-limits-statusline
```

It appears the next time Claude Code refreshes its status line. Your current status line is saved, and uninstalling puts it back. To update, run the same command again; the status line tells you when a new version is out.

Using an API key instead of a plan? You'll only see the context bar, because Claude Code shares usage limits only for Pro and Max plans.

## See it outside Claude Code (optional)

To show your usage in your zsh prompt as well, add this line to `~/.zshrc`. The installer prints it for you too.

```
[ -f "$HOME/.claude/hooks/limits-statusline.zsh" ] && source "$HOME/.claude/hooks/limits-statusline.zsh"
```

The installer also prints a line for tmux. Any other tool can run `node ~/.claude/hooks/limits-statusline.js --print plain`.

## Uninstall

```
npx claude-limits-statusline --uninstall
```

This puts your old status line back. Your Claude Code settings are backed up to `~/.claude/settings.json.bak` before every change.

## Privacy

Your usage numbers never leave your computer. Once a day it asks npm whether there's a new version, and that's the only thing it sends.

## Contact

Made by [Yash](https://yash.bio). For questions or ideas, get in touch through [yash.bio](https://yash.bio) or [open an issue on GitHub](https://github.com/ux-yash/claude-limits-statusline/issues).

## License

MIT. See [LICENSE](LICENSE).
