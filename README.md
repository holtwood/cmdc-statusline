# cmdc-statusline

**English** | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md)

A status line for [Command Code](https://commandcode.ai) (`cmd`, or `cmdc` on Windows) — model,
a gradient context bar, cache hit rate, session cost, output speed, sub-agent usage, session
name and git state, all on the row under the input panel.

```text
deepseek-v4.1-flash │ max │ █░░░░░░░░░░░ 32k (3.2%) │ cache 99% │ $0.013 │ 42 tok/s │ sub 16k │ Simple Reply │ main ↑1 │ +1 ~2 ?1 │ my-project
```

Command Code has no Claude Code-style `statusLine` command hook — `cmd.ui.setStatus()` (the
mod API) is the only way to render a persistent row under the input, and that is what this
mod uses.

## Requirements

**Command Code ≥ 1.10.0** (`cmd`, or `cmdc` on Windows). Older builds are **not supported**: on an
older host the mod does nothing at all — it registers nothing, draws no footer, and leaves one
upgrade notice in the feed before disabling itself. Run `cmdc update` and start a new session. The
floor is not a guess: below 1.10.0 the mod API has no `cmd.ui.capabilities` probe (checked against
every published 1.x package), so the mod cannot even tell whether this host renders a footer — it
would throw rather than degrade. The `/statusline` report prints the host version it detected.

## Install

```bash
cmd mods add cmdc-statusline -g              # from npm (-g = user scope; drop it to install for one project)
cmd mods list                                # should list this mod
```

The same package installs straight from git — `cmd mods add holtwood/cmdc-statusline -g` — if you
would rather not depend on the registry.

Or drop the single file in by hand and skip the package machinery — put `index.ts` at
`~/.commandcode/mods/statusline.ts` (`%USERPROFILE%\.commandcode\mods\statusline.ts` on
Windows) and start a new session:

```bash
mkdir -p ~/.commandcode/mods && curl -o ~/.commandcode/mods/statusline.ts \
  https://raw.githubusercontent.com/holtwood/cmdc-statusline/main/index.ts
```

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.commandcode\mods" | Out-Null
Invoke-WebRequest -OutFile "$env:USERPROFILE\.commandcode\mods\statusline.ts" `
  https://raw.githubusercontent.com/holtwood/cmdc-statusline/main/index.ts
```

Pick one install path, not both: the package and the drop-in file are two separate mods, and two
copies declare the same flag names — Command Code resolves flag names globally across mods.

> On Windows the binary is `cmdc` (`cmd` is the Windows shell) — `cmdc mods add …`, `cmdc mods list`,
> `cmdc --mod .\index.ts`.

Try it without installing: `cmd --mod ./index.ts`. Mods load once per process — use
`/reload` or start a new session to pick up a change. No build step: Command Code compiles
the TypeScript at load.

### Install with an AI agent

Paste this into your agent (Claude Code, Codex, Command Code, …) if you would rather not
touch the shell yourself:

> Install the Command Code mod `cmdc-statusline` at user scope: run
> `cmd mods add cmdc-statusline -g` (use `cmdc` instead of `cmd` on Windows; if npm cannot find
> the package, use `holtwood/cmdc-statusline` instead), then confirm `cmd mods list` shows
> `cmdc-statusline` under user scope with no load warnings. Tell me to restart the session so the
> footer renders.

It needs no root, and it touches only `~/.commandcode/mods/` plus the `mods.sources` entry in
`~/.commandcode/settings.json`.

## Segments

| Segment | Meaning |
|---|---|
| `deepseek-v4.1-flash` | Active model, exactly as the request reported it (`raw-model=true` keeps the vendor prefix) |
| `max` | Reasoning effort of the last request |
| `█░░░ 32k (3.2%)` | Context of the last request: gradient bar (green→yellow→red across the bar), tokens, share of the model's window |
| `cache 99%` | Prompt-cache hit rate of the last request (cached input ÷ input) |
| `$0.013` | Session cost — transcript history on resume + new requests in this process |
| `42 tok/s` | Output speed of the last request (wall clock, so it includes time-to-first-token) |
| `sub 16k` | Tokens burned by sub-agents (`agent` tool) this session |
| `Simple Reply` | Session name (survives `/reload` and resume) |
| `main ↑1` | Git branch with ahead/behind |
| `+1 ~2 ?1` | staged · modified · untracked (drops to `clean`) |
| `my-project` | Current directory basename |

## Configuration

Settings live in JSON; the command line can override per run.

```
~/.commandcode/statusline.json          user scope
<project>/.commandcode/statusline.json  project scope (overrides user)
--mod-option <name>=<value>             per-run override
```

```json
{
	"bar-width": 12,
	"cache": true,
	"cost": true,
	"speed": true,
	"sub": true,
	"cwd": true,
	"refresh": 10
}
```

`preset` picks a ready-made set of segments so you do not have to list a dozen keys:

| `preset` | Turned on |
|---|---|
| `full` (default) | every segment |
| `minimal` | `model` `effort` `context` `bar` `percent` `git` |
| `usage` | `context` `bar` `percent` `cache` `cost` `sub` |

A preset only decides *which segments are on*. A key written beside it overrides it
(`{"preset": "minimal", "cost": true}` keeps the cost segment), and the rendering switches
(`ascii`, `raw-model`) are orthogonal to it. An unrecognised preset is reported and treated as
`full`.

| Key | Default | Notes |
|---|---|---|
| `model`, `effort`, `context` | `true` | model / reasoning effort / context of the last request |
| `bar`, `bar-width`, `percent` | `true`, `12`, `true` | gradient bar, its width in cells, the percentage |
| `cache` | `true` | cache hit rate |
| `cost` | `true` | session cost |
| `speed` | `true` | output speed |
| `sub` | `true` | sub-agent tokens |
| `name` | `true` | session name (truncated at 24 chars) |
| `git` | `true` | branch + change counts |
| `cwd` | `true` | directory basename |
| `preset` | `full` | `full` / `minimal` / `usage` |
| `raw-model` | `false` | keep the vendor prefix in the model id |
| `ascii` | `false` | force plain ASCII rendering |
| `refresh` | `10` | seconds between git re-reads (0 disables the timer) |

### Seeing what is actually in effect

`/statusline` prints the rendered line, the raw values behind it, and a
`key / default / effective / source` table for every key — plus the config files it read and a
line for each thing it could not use: a key it does not know (usually a typo), a value of the
wrong shape, an unrecognised preset. Rejected values fall back to the default rather than being
half-applied, and are named so you are not left guessing why a change did nothing.

```text
配置（键 / 默认 / 生效 / 来源）：
model     true   true   内置默认
cache     true   false  用户
cost      true   true   预设 usage
refresh   10     0      命令行
文件：C:\Users\you\.commandcode\statusline.json
⚠ 未知键 "speedd"（用户）—— 拼错了？
```

### Changing it without hand-editing JSON

`/statusline config` drives the same thing through Command Code's dialogs (`cmd.ui.select` /
`input` / `confirm`): pick the scope (user or project), pick a key, pick a value, confirm. It
writes that one key into the JSON — leaving the rest of the file, including keys this mod does
not know, untouched — then re-reads it and repaints the footer **immediately**, so there is no
`/reload` round trip. A run without a dialog bridge (headless) prints the report instead of
writing anything. If something with higher precedence (the project file, `--mod-option`) keeps
the old value, the flow says so instead of leaving you with a write that visibly did nothing.

**Precedence caveat:** Command Code strips `--mod-option` values out of the argv a mod can
see, so a flag is only treated as an explicit override when its value *differs from the
built-in default*. Passing the default value explicitly (`--mod-option cwd=true`) does not
override a config file that says otherwise. Flag names are also global across mods: if another
mod declares the same name, the value can be claimed by whichever mod registered it first —
verified in a real session, `--mod-option cwd=false` does reach this mod while it is the only
one declaring `cwd`.

## Rendering

- **Startup.** Most segments report the *last model request*, which a session that has not sent
  one yet does not have — so the line paints what is knowable immediately instead of waiting for
  the first `model_request_end`: the model and reasoning effort from `~/.commandcode/config.json`,
  plus the session name, git state and directory. A **resumed** session also restores the last
  request's model, effort, context, cache hit rate and cost from the transcript, so it opens with
  the same complete line it was left in. Only output speed and sub-agent tokens genuinely need a
  request to happen (the product persists neither).
- `COLORTERM=truecolor|24bit` → 24-bit gradient bar; otherwise a 256-colour approximation;
  `ascii=true` or `TERM=dumb` → `#`/`-`; `NO_COLOR` keeps the block characters but drops colour.
- **Narrow terminals:** instead of clipping, segments are dropped by priority
  (`cwd` → speed → effort → sub-agent → cache → session name → cost → change counts, then the
  context shrinks bar → tokens+% → tokens, then the branch goes) and the line re-renders on
  resize. The model is never dropped.

## Where the numbers come from

| Value | Source | Confidence |
|---|---|---|
| model / effort | `model_request_start` / `model_request_end` event payloads; seeded from `~/.commandcode/config.json` before the first request, and from the transcript on resume | exact once a request has run; the seed is the product's own value |
| context / cache | `model_request_end` usage; on resume, the last `usage` in the transcript | exact |
| session cost | `<sessionId>.jsonl` transcript (`costUsd`) on resume + per-request `usage` priced with the table below | the resume half is the product's own number; the per-request half reproduces the product's accounting exactly (verified entry-by-entry against recorded `costUsd`) |
| sub-agent tokens | `subagent_stop` events | exact for tokens; sub-agent spend is **not** included in the cost segment (the product does not persist it either) |
| session name | `session_titled` event + `<sessionId>.meta.json` on start | best-effort seed — the file layout is undocumented and read inside a `try` |
| branch / changes | `git status --porcelain=v1 -b` via `cmd.exec` | exact, 5s TTL cache |

The context-window and price tables are **generated** from the model catalogue shipped with
the CLI, not handwritten:

```bash
python3 scripts/gen-model-tables.py           # regenerate after a CLI upgrade
python3 scripts/gen-model-tables.py --check   # fail if the tables drifted (CI does this)
```

A model missing from either table degrades gracefully: no bar/percentage without a window,
no cost without a price.

## Development

```bash
node test/statusline.test.mjs     # the whole suite: no dependencies, no build step
python3 scripts/gen-model-tables.py --check
```

Tests import `index.ts` directly — Node 22.18+/24 strips the types, so there is no toolchain.
Point them at another copy with `STATUSLINE_MOD=/path/to/statusline.ts`. CI runs the same
suite on Linux, macOS and Windows.

## Known limitations

- **No credits / quota segment.** Sibling mods read the Command Code API for remaining
  credits and 5-hour/weekly windows; this one is deliberately local-only (no network, no
  `auth.json`).
- Cost for *new* requests is computed from the shipped price table rather than read back from
  the transcript, so a price change needs `scripts/gen-model-tables.py` re-run (the resume
  seed and the per-request math are both checked against the product's own numbers).
- The session name, cost and request restore read `~/.commandcode/projects/**`, and the
  startup model/effort seed reads `~/.commandcode/config.json` — undocumented layouts. Everything
  is wrapped so a layout change degrades to "segment missing", never a crash.
- **Polling on huge repositories.** The footer re-reads `git status` every `refresh`
  seconds (default 10). That call is free in small repos but not in enormous ones — raise
  `refresh` or set it to `0` and let the event-driven refreshes do the work.

## Prior art

Worth a look if you want something different:
[grknbyk/commandcode-statusline](https://github.com/grknbyk/commandcode-statusline) (credits,
usage windows, spending pace), [vikas-gits-good/cmd-statusline](https://github.com/vikas-gits-good/cmd-statusline)
(template layout, priority-based narrow-terminal handling),
[estifie/command-code-mod-session-stats](https://github.com/estifie/command-code-mod-session-stats)
(context pressure, cache hit rate, transcript-based spend with sub-agents folded in).

## License

MIT
