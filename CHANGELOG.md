# Changelog

## 0.4.0

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
