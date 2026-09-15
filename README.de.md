# cmdc-statusline

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | **Deutsch** | [Русский](README.ru.md)

Eine Statuszeile für [Command Code](https://commandcode.ai) (`cmd`, unter Windows `cmdc`):
Modell, Kontextbalken mit Verlauf, Cache-Trefferquote, Sitzungskosten, Ausgabetempo,
Subagent-Nutzung, Sitzungsname und Git-Status — über `cmd.ui.setStatus()` unter dem
Eingabefeld gezeichnet.

![statusline: deepseek-v4.1-flash │ max │ ██████░░░░░░ 96k (47%) │ cache 99% │ $0.013 │ 42 tok/s │ sub 16k │ Simple Reply │ main ↑1 │ +1 ~2 ?1 │ my-project](docs/statusline.png)

**Erfordert Command Code ≥ 1.10.0.**

## Installation

```bash
cmd mods add cmdc-statusline -g
cmd mods list
```

Alternativen:

- **Über git:** `cmd mods add holtwood/cmdc-statusline -g`
- **Einzelne Datei:** `index.ts` nach `~/.commandcode/mods/statusline.ts` kopieren
  (unter Windows `%USERPROFILE%\.commandcode\mods\statusline.ts`) — ohne Build-Schritt
- **Ohne Installation testen:** `cmd --mod ./index.ts` (Mods laden einmal pro Prozess —
  `/reload` übernimmt Änderungen)

Unter Windows heißt das Binary `cmdc` (`cmd` ist die Windows-Shell). Nur einen Weg wählen —
Paket und abgelegte Datei sind zwei Mods, die dieselben Flag-Namen deklarieren, und Flag-Namen
werden mod-übergreifend global aufgelöst.

### Vom Agenten installieren lassen

Folgendes in den Agenten einfügen:

> Installiere den Command-Code-Mod `cmdc-statusline` im Benutzer-Scope: führe
> `cmd mods add cmdc-statusline -g` aus (unter Windows `cmdc`; falls npm das Paket nicht
> findet, `holtwood/cmdc-statusline` verwenden), prüfe, dass `cmd mods list` ihn zeigt, und
> sag mir dann, ich soll die Sitzung neu starten.

## Segmente

| Segment | Bedeutung |
|---|---|
| `deepseek-v4.1-flash` | Aktives Modell (`raw-model=true` behält das Anbieter-Präfix) |
| `max` | Reasoning-Aufwand der letzten Anfrage |
| `█░░░ 32k (3.2%)` | Kontext der letzten Anfrage: Verlaufsbalken (grün→rot), Token, Anteil am Fenster |
| `cache 99%` | Trefferquote des Prompt-Caches |
| `$0.013` | Sitzungskosten: Verlauf beim Fortsetzen + neue Anfragen |
| `42 tok/s` | Ausgabetempo der letzten Anfrage (Echtzeit, inkl. Warten aufs erste Token) |
| `sub 16k` | Von Subagenten in dieser Sitzung verbrauchte Token |
| `Simple Reply` | Sitzungsname (übersteht `/reload` und Fortsetzen) |
| `main ↑1` | Git-Branch mit ahead/behind |
| `+1 ~2 ?1` | bereitgestellt · geändert · unverfolgt (`clean`, wenn sauber) |
| `my-project` | Name des aktuellen Verzeichnisses |

## Konfiguration

```
~/.commandcode/statusline.json          Benutzer-Scope
<projekt>/.commandcode/statusline.json  Projekt-Scope (überstimmt Benutzer)
--mod-option <schlüssel>=<wert>         Override pro Lauf
```

```json
{"preset": "full", "bar-width": 12, "refresh": 10, "cache": true, "cost": true}
```

Presets: `full` (Standard, alles) · `minimal` (model, effort, context, bar, percent, git) ·
`usage` (context, bar, percent, cache, cost, sub). Ein daneben gesetzter Schlüssel überstimmt
das Preset.

| Schlüssel | Standard | Hinweis |
|---|---|---|
| `model`, `effort`, `context` | `true` | Modell / Aufwand / Kontext der letzten Anfrage |
| `bar`, `bar-width`, `percent` | `true`, `12`, `true` | Balken, Breite in Zellen, Prozentwert |
| `cache`, `cost`, `speed`, `sub` | `true` | Trefferquote / Sitzungskosten / Tempo / Subagent-Token |
| `name`, `git`, `cwd` | `true` | Sitzungsname (24 Zeichen max.) / Branch + Änderungen / Verzeichnis |
| `preset` | `full` | `full` / `minimal` / `usage` |
| `raw-model`, `ascii` | `false` | Anbieter-Präfix behalten / reines ASCII-Rendering |
| `refresh` | `10` | Sekunden zwischen git-Neulesungen (`0` stoppt das Polling) |

Zwei Befehle zeigen und ändern das, ohne JSON anzufassen:

- `/statusline` — die gerenderte Zeile, die Rohwerte, eine
  `Schlüssel / Standard / Effektiv / Quelle`-Tabelle und je eine Warnung pro unbrauchbarem
  Eintrag (unbekannte Schlüssel, falsche Typen, unbekannte Presets). Der Berichtstext ist
  auf Chinesisch.
- `/statusline config` — interaktiver Editor (Scope → Schlüssel → Wert → bestätigen);
  schreibt genau einen Schlüssel und zeichnet sofort neu, ohne `/reload`.

Achtung: `--mod-option` gilt nur dann als expliziter Override, wenn der Wert vom eingebauten
Standard abweicht — `cwd=true` explizit zu übergeben schlägt keine Konfigurationsdatei mit
`false`.

## Funktionsweise

- **Start/Fortsetzen:** vor der ersten Anfrage kommen Modell und Aufwand aus
  `~/.commandcode/config.json`; eine fortgesetzte Sitzung stellt zusätzlich Kontext,
  Cache-Quote und Kosten aus dem Transkript wieder her. Tempo und Subagent-Token brauchen
  eine echte Anfrage.
- **Farben:** `COLORTERM=truecolor|24bit` → 24-Bit-Verlauf, sonst 256-Farben-Näherung;
  `ascii=true` oder `TERM=dumb` → `#`/`-`; `NO_COLOR` behält die Blöcke, lässt die Farbe
  weg.
- **Schmale Terminals:** statt abzuschneiden, fallen Segmente nach Priorität weg
  (cwd → Tempo → Aufwand → Subagenten → Cache → Name → Kosten → Änderungen → Balken
  schrumpft → Branch); das Modell fällt nie. Neuzeichnen bei Resize.
- **Quellen:** Modell/Aufwand/Kontext/Cache aus den Request-Events; Kosten = Transkript
  beim Fortsetzen + pro Anfrage mit einer generierten Preistabelle bewertet; Subagent-Token
  aus `subagent_stop`; git über `git status --porcelain=v1 -b` (5-s-Untergrenze + Polling im
  `refresh`-Intervall).
- **Modelltabellen:** Kontextfenster und Preise werden aus dem mit dem CLI ausgelieferten
  Modellkatalog **generiert** — `python3 scripts/gen-model-tables.py` zum Regenerieren,
  `--check` erkennt Drift (läuft in CI). Ein fehlendes Modell degradiert sanft (kein Balken
  / keine Kosten).

## Mitwirken

Issues und Pull Requests sind willkommen.

## Lizenz

MIT
