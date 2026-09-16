# Changelog

## 0.7.0

- **Flag names are namespaced: `--mod-option statusline.<key>=<value>`.** Breaking for the
  command line only — the JSON keys, the `key / default / effective / source` table and the
  interactive editor all keep the short names. Migration is mechanical: `--mod-option cache=false`
  becomes `--mod-option statusline.cache=false`.

  The host keeps mod flag *values* in one process-wide table keyed by name: `addFlag` writes a
  default only when the name is still free, `getFlag` reads that one table, and `--mod-option`
  resolves the value's type from the first mod that declared the name. Two mods declaring `cache`
  would therefore share a single value — whoever declared first would own the default for both,
  and the second mod's own default would never be visible. Measured against the real host
  (1.54.0, host module loaded directly): with mod B declaring `{type: 'string', default: 'fromB'}`
  for a name mod A had already declared as boolean, `B.getFlag(name)` reads `true`; after
  `--mod-option model=hello` both mods read boolean `false`, the string having been coerced by
  A's type; and a declaration without a default sits in whatever value another mod put there.

  A config *file* has no such problem — `statusline.json` is its own namespace — so only the
  names sent to the host carry the prefix. `flagName()` is the single derivation point, the
  report's source column now spells the flag out (`命令行 (--mod-option statusline.cache)`)
  because the table itself shows short keys, and the report tip names the form.
- **The test stub models the host's flag semantics instead of pretending they don't exist.**
  Every stub used to get its own private flag map, which made exactly the collision above
  untestable: values now live in an injectable table, declarations stay per-mod, and the first
  default wins — the three behaviours the host was measured to have. Two guards keep the module
  honest: every registered flag must carry the prefix, and a foreign mod writing `cache` into the
  shared table must not reach `statusline.cache`. The README check grew the same way — all nine
  language sections must spell the prefixed form, and a surviving `--mod-option <key>=…` example
  fails the suite.
- **Old hosts can no longer turn every event into a `mod_error`.** `cmd.ui.capabilities` is now
  declared optional, because 1.9.0 genuinely has no such property (its `setStatus` is a no-op;
  1.10.0 is where both appear — that is what the floor is made of), and the three reads use
  optional chaining. The version gate stays best-effort by design: when the host version cannot
  be read it does not guess, and the mod proceeds. Reproduced end-to-end by registering the real
  `index.ts` against a host whose `capabilities` is absent: the mod used to throw inside
  `onSessionStart` (reported as `mod_error`, not a crash), and now paints nothing instead. The
  report distinguishes the two cases rather than calling both headless — `footer=未知` when the
  host has no capability surface at all.
- `DROP_ORDER` lookups are exhaustive now: the entry key is typed `keyof typeof DROP_ORDER`, so a
  segment missing from the table is a compile error rather than silently taking priority 5.
- `gen-model-tables.py` names the file it actually searched when a marker block is missing; the
  message had been hard-coded to `statusline.ts` since before the file was renamed to `index.ts`,
  and it stayed wrong under `--ts`.
- CI runs the suite on the declared minimum Node (22.18.0) alongside 24: the tests import
  TypeScript directly and depend on native type stripping, which is precisely what that floor is
  about, and a 24-only matrix never proved it.
- Internal cleanup, nothing user-visible: `index.ts` shed eleven exports nobody else used —
  `noUnusedLocals`, `noUnusedParameters` and `noFallthroughCasesInSwitch` are on so dead code
  cannot come back — the two generated model tables moved to an appendix at the end of the file,
  the seeding trio is one named step, and `gen-model-tables.py` no longer reports an update after
  a no-op write.
- The footer probe is one named `rendersFooter()` and deliberately stricter: it requires
  `capabilities.status === true` rather than any truthy value — identical on the real host (the
  flag is a real boolean), different only for a host that would answer a truthy non-`true`.
- The narrow-terminal drop loop is bounded by `DROP_STEPS_MAX` (64): unreachable in normal
  operation, it is the floor under a width/drop logic bug rather than a real limit.
- 318 checks.

## 0.6.1

- **One README instead of nine.** The eight translated `README.<lang>.md` files were folded into
  `README.md` as stacked language sections (English first), with the language switcher turned into
  in-page anchors — nine files that had to be kept in sync by hand are now one. The screenshot is
  carried once, in the English section, rather than repeated nine times; the requirement line stays
  in every section, because that is what the drift guard checks. `package.json#files` ships
  `README.md` rather than `README*.md`.
- The host-floor drift guard now checks the single file: it fails if the README stops stating
  `≥ MIN_HOST_VERSION`, or if any of the nine language sections loses the line (the count must be
  nine, so a section that silently drops its requirement is caught).
- Comment fix: the file header and the `hostVersion()` docstring both stated the floor as `1.54.0`,
  while `MIN_HOST_VERSION` has been `1.10.0` since it was introduced — the number was carried over
  from the pre-research assumption into the very commit that lowered it, so no committed revision
  ever had `1.54.0` as the constant. The header now names the constant (the number stays as a
  parenthetical) and the docstring refers to the constant instead of repeating it, so neither can
  drift again. The 0.6.0 entry that still read `Requires ≥ 1.54.0` now says it is the stage the
  research below lowered.
- **Per-session state actually resets.** The mod loads once per process, but the host can swap
  sessions inside it (`onSessionEnd` carries `reason: 'replaced'` — navigate/resume take that
  path). All mutable session state — title, cost, context, cache hit, sub-agent tokens, the seeded
  markers, the session id itself — now lives in one `SessionState` object that `onSessionStart`
  rebuilds wholesale when the id changes, so a resumed session no longer wears the previous one's
  name and numbers. Re-firing `onSessionStart` with the same id keeps the accumulated data. The
  transcript seed is also race-safe now: it holds the old snapshot reference across the `await` and
  drops the result entirely if the session was replaced meanwhile.
- **Transcript format drift is observable.** `readSessionSeed` counts usage/model records against
  how many matched the expected tail shape; a transcript that has them but parses none sets a flag,
  and `/statusline` prints a warning that the internal format may have changed and restored
  cost/context may be off — a silent zero becomes a diagnosable zero.
- **New `lang` key (`zh` / `en`, default `zh`).** The `/statusline` report, the interactive config
  editor, flag descriptions, and every warning/notice now render in English when set —
  `zh-CN`/`en-US` style values normalize to their base language. Unknown values are called out in
  the report and fall back to `zh`. In the editor, `lang` is a picker, not free input. Flag
  descriptions are registered in the config file's language (the CLI flag cannot reach them — the
  description is emitted at registration, before flags exist).
- **Config writes are atomic.** `writeConfigKey` writes `<file>.<pid>.tmp` and `renameSync`s it
  over the target, so a crash mid-write can no longer leave half a JSON file that the next load
  would discard wholesale.
- **Types are real now.** `index.ts` imported `ModApi` from `@commandcode/harness`, which is not
  published — the declaration is now a local `mod-api.d.ts` written against the bundled
  mod-builder API reference, and `npm run typecheck` (`tsc --noEmit`) runs in CI and in
  `prepublishOnly`. `package.json#files` ships `mod-api.d.ts` and drops `test/` and `scripts/`,
  which were published but never needed at runtime.

- The `git status` poll is now bounded, and it can no longer hold up the rest of the row. Both
  were real on large repositories and neither was visible from the outside:
  - `refresh()` used to `await` the git read before painting, so a `git status` that took 8s held
    the model, cost and context rows back with it. The repaint is now synchronous and idempotent
    (the host already de-duplicates identical status text) and git repaints again when it lands:
    a slow git delays the git row and nothing else.
  - The gap between reads was a flat 5s TTL stamped when a read *started*, and the timer zeroed it
    every `refresh` seconds to force a read. A repo where `git status` outlives that TTL was
    therefore re-read by every following event, and one where it approaches `refresh` (the same
    10s as the abort timeout) was read almost continuously. Raising `refresh` could not fix
    either case, because it never changed the per-call cost. The gap is now
    `max(5s, 5 × the last measured read)`: git may consume at most ~20% of wall clock, the 5s
    floor keeps fast repositories byte-for-byte as they were, and the timer no longer pokes a
    timestamp to force anything.
  - When a read exceeds `refresh` (an aborted one included) the mod says so once per session,
    naming the measured cost and the new cadence, instead of going quiet.
  - Measured on Windows: spawning git alone costs ~59ms and `git status -b` in a small repo ~68ms,
    so the 10s default was never the issue on small repos — an unbounded duty cycle was the issue
    on large ones.
- Tests: the measured durations are driven by a faked clock rather than real waiting, covering the
  5s floor, the backoff after a slow read, the forced first read of a new session, the one-shot
  warning, and — the point of the change — that a paint happens while git is still hanging.
  280 checks.

## 0.6.0

- **Presets.** `preset: "full" | "minimal" | "usage"` picks a ready-made segment set so you do not
  have to list a dozen keys. A preset only decides which segments are on — any key written beside
  it overrides it, and the rendering switches (`ascii`, `raw-model`) are orthogonal. An
  unrecognised preset is named in the report and treated as `full`.
- **`/statusline` now diagnoses instead of just describing.** It prints a
  `key / default / effective / source` table covering every key, the config files it read, and a
  line for each thing it could not use: a key it does not know (a typo), a value of the wrong
  shape, an unrecognised preset. This was the worst gap in the old design — `loadConfig` merged
  whatever JSON it found and silently ignored anything it did not understand, so `"speedd": false`
  looked exactly like a broken feature. Values that are rejected now fall back to the default and
  say so, and every row names where its value came from (built-in default / preset / user file /
  project file / command line).
- **`/statusline config` writes it for you.** A dialog flow over `cmd.ui.select` / `input` /
  `confirm`: pick the scope (user or project), pick a key, pick a value, confirm. It rewrites only
  that key — the rest of the file, including keys this mod does not know, is preserved — then
  re-reads the config and repaints the footer immediately, so a config change no longer costs a
  `/reload`. Without a dialog bridge (headless) it prints the report and writes nothing; declining
  the confirm writes nothing either.
- Internals: the 17 keys now come from one registry (`FLAG_SPECS`) that drives `addFlag`, the
  report table and the picker, and all value resolution goes through a single `resolveFlag`, so the
  effective value the report shows cannot drift from the value the footer uses.

- Adversarial pass over all of the above, from a fresh angle, plus the host-version gate:
  - **Requires Command Code ≥ 1.54.0** at this stage (`MIN_HOST_VERSION`) — lowered to `1.10.0` by
    the research below — and older builds are not supported at all. `cmd` exposes no version field
    (verified with a probe), so the mod reads it from the `package.json` beside the CLI entry — and
    on an older host it **disables itself**: one error notice in the feed pointing at `cmdc update`,
    and nothing else registered (no flags, no command, no footer, no git). It deliberately does not
    degrade, because a footer that merely looks plausible is worse than no footer. A version it
    cannot determine is never guessed at — the mod runs normally and the report says `cmdc=未知` —
    so an unusual install layout cannot brick a working setup.
  - `{"preset": 123}` counted as a usable value, so the report showed `preset  123  用户` while the
    footer actually ran `full`. Non-numeric string keys now require a string.
  - A config written by Notepad (UTF-8 with a BOM) is valid JSON that `JSON.parse` rejects: the file
    was dropped as unreadable *and* the writer refused to touch it, so the only way out was manual
    editing. The BOM is now stripped on read.
  - The picker showed an out-of-range `bar-width` raw (`100`) while the footer clamped it to `40`,
    and the unknown-preset warning claimed "已按 full 处理" even when another source won. Both now
    describe what actually happens.
  - The confirm dialog shows the value *in effect* and where it comes from, not just what this file
    says, and a write that a higher-precedence source overrides is called out ("底栏不会变") instead
    of leaving a "wrote it" message over an unchanged footer.
- Second adversarial pass, from a different angle, once the gate was a hard stop:
  - `hostVersion()` trusted whatever the manifest said, so a `version` that is not a version
    (`""`, `"unknown"`, `"dev"`) parsed as `0`, compared below the floor and **disabled the mod on a
    perfectly good install** — the one failure mode worse than not gating at all. Only a
    digit-leading version is trusted now; anything else counts as "unknown" and does not gate.
  - The report announced "全部走内置默认" whenever no config file parsed, which is false the moment
    `--mod-option` or a preset supplies the values — it contradicted its own table two lines above.
  - Stale comments: the one on `MIN_HOST_VERSION` still described the degrade behavior that the hard
    gate replaced, and the file header never mentioned that older hosts are unsupported at all.
- The supported-version floor is now **researched, not guessed**. `MIN_HOST_VERSION` was `1.54.0`
  only because that is what happened to be installed; the published `dist/cli.mjs` of the two
  releases around the boundary (1.9.0 / 1.10.0) was fetched and compared directly, then re-checked
  at 1.20 / 1.30 / 1.40 / 1.50 / 1.54 for every API and data shape this mod touches:
  - mod dialogs `cmd.ui.confirm` / `select` / `input` — present since **≤ 1.0.0**
  - `cmd.ui.refreshWidgets` — since 1.5.0
  - **`cmd.ui.capabilities` — first present in 1.10.0.** 1.9.0 has no such property on the ModUi
    (the string only appears there in MCP protocol frames and prompt text), so
    `cmd.ui.capabilities.status` **throws a `TypeError`** instead of degrading. This is the binding
    constraint.
  - `subagent_stop` / `session_titled` / `config_setting_changed`, `effort` on `model_request_end`,
    `costUsd`, `reasoningEffort`, `.meta.json`, `.jsonl` — all present at 1.10.0
  - the transcript tail the seeding regex matches (`…"usage":{…},"model":"…","effort":"…"}`) — the
    writer is byte-for-byte the same shape from 1.10.0 through 1.54.0
  - `exec`'s `signal` and `run_start.sessionId` — already present in 1.9.0
  - the ModUi implementations of `confirm` / `select` / `input` / `capabilities` are **identical at
    1.10.0 and 1.54.0 once the minified identifier names are normalised away** (also compared at
    1.30.0), i.e. the contracts this mod codes against — select returns the chosen label, input the
    typed text, confirm a boolean, `capabilities.status` a boolean getter — do not drift across the
    supported range, not merely the symbols
  → `MIN_HOST_VERSION` is **`1.10.0`**, one release above the point where the mod would crash rather
  than work. Stated plainly: the mod has only ever been *run* on 1.54.0, so 1.10.0–1.53.x is
  supported on the strength of that inspection; a break there would cost a missing segment, not a
  crash. The nine READMEs carry the same floor; the reasoning behind it lives here and in the
  `MIN_HOST_VERSION` comment, not in the READMEs (they state the requirement in one line).
- `flag()` lost its dead `fallback` parameter: all sixteen call sites passed a built-in default that
  `resolveFlag()` always overrode, so "the" default had two places to live.
- Suite: 261 checks, including the write path against a throwaway home, the version gate against a
  fake CLI layout (asserting an outdated host registers nothing at all and that the floor version
  itself is accepted), and a drift guard that fails if any of the nine READMEs stops stating
  `MIN_HOST_VERSION` — confirmed by mutation, not assumed.

## 0.5.0

- The footer no longer opens half-empty. Nearly every segment reports the **last model request**,
  so a session that has not sent one yet only had git and the directory name to show, and the
  model/effort/context/cache/cost/speed segments all appeared together only once the first
  response came back. It now paints what is knowable at that moment:
  - `model` and `effort` are seeded from `~/.commandcode/config.json` (`model` plus the
    per-model `reasoningEffort` map) before the first request.
  - A **resumed** session restores the last request's `model`, `effort`, context, cache hit rate
    and cost from the transcript — the same single-pass scan that already restored the cost, so a
    resumed session opens with the line it was left in. Only `speed` and `sub` still need a
    request to happen (the product persists neither).
- `/effort` now repaints immediately: `config_setting_changed` was only handled for `model`, so an
  effort change stayed invisible until the next `model_request_end`.
- Switching models no longer leaves the previous model's effort on screen: effort is stored per
  model, so `/model` re-reads it from the config (and clears the segment when the new model has no
  entry there) instead of showing a value that belongs to another model.
- `readSessionCost` became `readSessionSeed`, returning the cost alongside the last entry's
  `model` / `effort` / `usage`. The suite gained checks for all of the above (154 checks).

## 0.4.1

- Cross-platform fixes, found by finally running the suite on Windows:
  - `cmd.cwd` is a backslash path there, so the `cwd` segment rendered the **entire path** instead
    of the directory name. It now splits on both separators.
  - The suite was red on Windows (6/139 checks): it faked `$HOME`, but `os.homedir()` reads
    `USERPROFILE` there, and one fixture derived a project name with `/`. Fixed both; the whole
    suite runs on Windows now.
  - `scripts/gen-model-tables.py` failed on Windows twice over — `subprocess` cannot exec npm's
    `.cmd` shim (a bare `except` swallowed it, so it reported "models.md not found"), and its `✓`
    output died on a GBK console. Both fixed; `--check` and generation now run on Windows.
  - CI runs the suite on Linux, macOS and Windows instead of Linux only. That gap is why none of
    the above was caught.
  - The suite no longer reads the developer's own `~/.commandcode/statusline.json`: it runs against
    a throwaway home, so a local config can no longer flip a check.
- Published to npm as `cmdc-statusline`: `cmd mods add cmdc-statusline -g` now works alongside the
  git source. `prepublishOnly` runs the suite before anything is uploaded.
- Docs: the English install block showed user scope without `-g` (contradicting its own comment and
  the other eight READMEs), the by-hand install was POSIX-only, and the assertion count had drifted.
  All nine READMEs now carry the same install block plus a copy-paste "install with an AI agent"
  block, and only the English one had the polling caveat — the translations now list it too.

## 0.4.0

- Robustness: the periodic `git status` runs with a 10 s abort timeout, so a hung git (index
  lock, dead mount, enormous repository) can no longer stall the footer indefinitely — a failed
  or aborted call just hides the git segment until the next refresh. The `resize` listener is
  registered idempotently, so a replaced session cannot stack duplicates.
- Verified end to end in real sessions: `--mod-option` does reach this mod; a pinned install
  (`cmd mods add owner/repo@<tag>`) works and an unknown ref fails loudly; with a CJK session
  name the footer fits a 60-column pane and collapses to `main │ ~2` in a 34-column one.
  Caveat: flag names are global across mods — if two mods declare the same name, one of them
  sees the value.
- Packaging: `package.json#files` now covers the translated READMEs, `test/` and
  `CHANGELOG.md`, so an npm publish would ship the whole project. READMEs note that the
  binary is `cmdc` on Windows, and the English one documents the `refresh` trade-off on
  very large repositories.

- Narrow terminals measure **display width**, not characters: CJK/emoji session names count as
  two columns, and long titles are truncated by column — the line no longer overflows on a
  narrow pane when the session name is not ASCII.
- Known limitation: sub-agent tokens are per-process (the product persists them nowhere), so
  `sub` starts at zero on resume while `cost` is restored from the transcript.
- Narrow terminals: segments are dropped by priority and the line re-renders on resize,
  instead of clipping. The model is never dropped.
- New `cache` segment — prompt-cache hit rate of the last request.
- New `sub` segment — sub-agent (`agent` tool) tokens for the session. Sub-agent spend is not
  folded into `cost`, because the product does not persist it either.
- JSON configuration (`~/.commandcode/statusline.json`, `<project>/.commandcode/statusline.json`)
  so settings no longer have to be passed on every launch.
- Session cost survives a restart: it is seeded from the session transcript on resume.
- `cwd` is on by default.

## 0.3.0

- Gradient context bar (24-bit → 256-colour → ASCII fallbacks).
- Session cost and output speed segments.
- Generated context-window and price tables with a drift check.

## 0.2.0

- Session name segment, seeded from the session metadata on resume.
- Context percentage against the model's window.

## 0.1.0

- First version: model, effort, context tokens, git branch and change counts.
