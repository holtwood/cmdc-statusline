# cmdc-statusline

**English** | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md)

A status line for [Command Code](https://commandcode.ai) (`cmdc`) — model, a gradient
context bar, cache hit rate, session cost, output speed, sub-agent usage, session name and
git state, all on the row under the input panel.

```text
deepseek-v4.1-flash │ max │ █░░░░░░░░░░░ 32k (3.2%) │ cache 99% │ $0.013 │ 42 tok/s │ sub 16k │ Simple Reply │ main ↑1 │ +1 ~2 ?1 │ my-project
```

Command Code has no Claude Code-style `statusLine` command hook — `cmd.ui.setStatus()` (the
mod API) is the only way to render a persistent row under the input, and that is what this
mod uses.

## Install

```bash
cmd mods add holtwood/cmdc-statusline        # user scope (-g); drop -g for project scope
cmd mods list                                # should list this mod
```

Or drop the file in by hand and skip the package machinery:

```bash
mkdir -p ~/.commandcode/mods
curl -o ~/.commandcode/mods/statusline.ts \
  https://raw.githubusercontent.com/holtwood/cmdc-statusline/main/index.ts
```

> On Windows the binary is `cmdc` (bare `cmd` opens the Windows shell) — run `cmdc mods add …`, `cmdc mods list`, and so on.

Try it without installing: `cmd --mod ./index.ts`. Mods load once per process — use
`/reload` or start a new session to pick up a change. No build step: Command Code compiles
the TypeScript at load.

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
| `raw-model` | `false` | keep the vendor prefix in the model id |
| `ascii` | `false` | force plain ASCII rendering |
| `refresh` | `10` | seconds between git re-reads (0 disables the timer) |

**Precedence caveat:** Command Code strips `--mod-option` values out of the argv a mod can
see, so a flag is only treated as an explicit override when its value *differs from the
built-in default*. Passing the default value explicitly (`--mod-option cwd=true`) does not
override a config file that says otherwise.

## Rendering

- `COLORTERM=truecolor|24bit` → 24-bit gradient bar; otherwise a 256-colour approximation;
  `ascii=true` or `TERM=dumb` → `#`/`-`; `NO_COLOR` keeps the block characters but drops colour.
- **Narrow terminals:** instead of clipping, segments are dropped by priority
  (`cwd` → speed → effort → sub-agent → cache → session name → cost → change counts, then the
  context shrinks bar → tokens+% → tokens, then the branch goes) and the line re-renders on
  resize. The model is never dropped.

## Where the numbers come from

| Value | Source | Confidence |
|---|---|---|
| model / effort / context / cache | `model_request_start` / `model_request_end` event payloads | exact |
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
node test/statusline.test.mjs     # 136 assertions, no dependencies, no build
python3 scripts/gen-model-tables.py --check
```

Tests import `index.ts` directly — Node 22.18+/24 strips the types, so there is no toolchain.
Point them at another copy with `STATUSLINE_MOD=/path/to/statusline.ts`.

## Known limitations

- **No credits / quota segment.** Sibling mods read the Command Code API for remaining
  credits and 5-hour/weekly windows; this one is deliberately local-only (no network, no
  `auth.json`).
- Cost for *new* requests is computed from the shipped price table rather than read back from
  the transcript, so a price change needs `scripts/gen-model-tables.py` re-run (the resume
  seed and the per-request math are both checked against the product's own numbers).
- The session name and cost restore read `~/.commandcode/projects/**` — an undocumented
  layout. Everything is wrapped so a layout change degrades to "segment missing", never a
  crash.

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
