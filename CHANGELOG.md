# Changelog

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
