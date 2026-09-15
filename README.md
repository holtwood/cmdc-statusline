# cmdc-statusline

**English** | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md)

A status line for [Command Code](https://commandcode.ai) (`cmd`, `cmdc` on Windows) — model,
gradient context bar, cache hit rate, session cost, output speed, sub-agent usage, session
name and git state, rendered under the input panel via `cmd.ui.setStatus()`.

![statusline: deepseek-v4.1-flash │ max │ ██████░░░░░░ 96k (47%) │ cache 99% │ $0.013 │ 42 tok/s │ sub 16k │ Simple Reply │ main ↑1 │ +1 ~2 ?1 │ my-project](docs/statusline.png)

**Requires Command Code ≥ 1.10.0.**

## Install

```bash
cmd mods add cmdc-statusline -g
cmd mods list
```

Alternatives:

- **From git:** `cmd mods add holtwood/cmdc-statusline -g`
- **Single file:** copy `index.ts` to `~/.commandcode/mods/statusline.ts`
  (`%USERPROFILE%\.commandcode\mods\statusline.ts` on Windows) — no build step
- **Try without installing:** `cmd --mod ./index.ts` (mods load once per process — use
  `/reload` to pick up changes)

On Windows the binary is `cmdc` (`cmd` is the Windows shell). Pick one install path — the
package and the drop-in file are two mods that declare the same flag names, which Command
Code resolves globally.

### Install with your agent

Paste this into your agent:

> Install the Command Code mod `cmdc-statusline` at user scope: run
> `cmd mods add cmdc-statusline -g` (`cmdc` on Windows; if npm can't find it, use
> `holtwood/cmdc-statusline`), confirm `cmd mods list` shows it, then tell me to restart
> the session.

## Segments

| Segment | Meaning |
|---|---|
| `deepseek-v4.1-flash` | Active model (`raw-model=true` keeps the vendor prefix) |
| `max` | Reasoning effort of the last request |
| `█░░░ 32k (3.2%)` | Context of the last request: gradient bar (green→red), tokens, share of the model's window |
| `cache 99%` | Prompt-cache hit rate of the last request |
| `$0.013` | Session cost — transcript on resume + new requests |
| `42 tok/s` | Output speed of the last request (wall clock, incl. TTFT) |
| `sub 16k` | Tokens burned by sub-agents this session |
| `Simple Reply` | Session name (survives `/reload` and resume) |
| `main ↑1` | Git branch with ahead/behind |
| `+1 ~2 ?1` | staged · modified · untracked (`clean` when empty) |
| `my-project` | Current directory basename |

## Configuration

```
~/.commandcode/statusline.json          user scope
<project>/.commandcode/statusline.json  project scope (overrides user)
--mod-option <key>=<value>              per-run override
```

```json
{"preset": "full", "bar-width": 12, "refresh": 10, "cache": true, "cost": true}
```

Presets: `full` (default, everything) · `minimal` (model, effort, context, bar, percent,
git) · `usage` (context, bar, percent, cache, cost, sub). A key set next to a preset
overrides it.

| Key | Default | Notes |
|---|---|---|
| `model`, `effort`, `context` | `true` | model / reasoning effort / context of the last request |
| `bar`, `bar-width`, `percent` | `true`, `12`, `true` | gradient bar, width in cells, percentage |
| `cache`, `cost`, `speed`, `sub` | `true` | hit rate / session cost / output speed / sub-agent tokens |
| `name`, `git`, `cwd` | `true` | session name (24-char max) / branch + changes / dir basename |
| `preset` | `full` | `full` / `minimal` / `usage` |
| `raw-model`, `ascii` | `false` | keep vendor prefix / plain ASCII rendering |
| `refresh` | `10` | seconds between git re-reads (`0` disables polling) |

Two commands inspect and change this without touching JSON:

- `/statusline` — rendered line, raw values, a `key / default / effective / source` table,
  and a warning for each unusable entry (unknown keys, wrong types, bad presets). The
  report text itself is in Chinese.
- `/statusline config` — interactive editor (pick scope → key → value → confirm); writes
  one key and repaints immediately, no `/reload`.

Caveat: `--mod-option` only counts as an override when the value differs from the built-in
default — passing `cwd=true` explicitly won't beat a config file saying `false`.

## How it works

- **Startup/resume:** before the first request, model and effort seed from
  `~/.commandcode/config.json`; a resumed session also restores context, cache rate and
  cost from the transcript. Speed and sub-agent tokens need a live request.
- **Colours:** `COLORTERM=truecolor|24bit` → 24-bit gradient, else 256-colour;
  `ascii=true` or `TERM=dumb` → `#`/`-`; `NO_COLOR` keeps blocks, drops colour.
- **Narrow terminals:** low-priority segments are dropped instead of clipped
  (cwd → speed → effort → sub → cache → name → cost → changes → bar shrinks → branch);
  the model is never dropped. Re-renders on resize.
- **Sources:** model/effort/context/cache from request events; cost = transcript on resume
  + per-request usage priced with a generated table; sub-agent tokens from `subagent_stop`;
  git from `git status --porcelain=v1 -b` (5s floor + `refresh` interval).
- **Model tables:** context windows and prices are generated from the CLI's own catalogue,
  not handwritten — `python3 scripts/gen-model-tables.py` to regenerate, `--check` to
  detect drift (CI runs it). A missing model degrades gracefully (no bar / no cost).

## Contributing

Issues and pull requests are welcome.

## License

MIT
