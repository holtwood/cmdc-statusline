# cmdc-statusline

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | **Deutsch** | [Русский](README.ru.md)

> Diese Übersetzung wurde mit KI-Unterstützung erstellt. Bei Unklarheiten gilt die [englische Fassung](README.md). Korrektur-PRs sind willkommen.

Eine Statuszeile für [Command Code](https://commandcode.ai) (`cmd`, unter Windows `cmdc`): Modell,
Kontextbalken mit Farbverlauf, Cache-Trefferquote, Sitzungskosten, Ausgabegeschwindigkeit,
Subagent-Verbrauch, Sitzungsname und Git-Status — alles in der Zeile unter dem Eingabefeld.

```text
deepseek-v4.1-flash │ max │ █░░░░░░░░░░░ 32k (3.2%) │ cache 99% │ $0.013 │ 42 tok/s │ sub 16k │ Simple Reply │ main ↑1 │ +1 ~2 ?1 │ my-project
```

Command Code hat keinen externen `statusLine`-Hook wie Claude Code: `cmd.ui.setStatus()` (die
Mod-API) ist der einzige Weg, eine dauerhafte Zeile unter dem Eingabefeld zu zeichnen — genau das
nutzt dieses Mod.

## Installation

```bash
cmd mods add cmdc-statusline -g              # von npm (-g = Benutzer-Scope; ohne -g nur das aktuelle Projekt)
cmd mods list                                # das Mod sollte auftauchen
```

Dasselbe Paket lässt sich auch direkt aus git installieren:
`cmd mods add holtwood/cmdc-statusline -g`, wenn die Registry nicht mitwirken soll.

Alternativ die Datei direkt ablegen, ohne Paketverwaltung: `index.ts` nach
`~/.commandcode/mods/statusline.ts` (`%USERPROFILE%\.commandcode\mods\statusline.ts` unter Windows)
legen und eine neue Sitzung starten:

```bash
mkdir -p ~/.commandcode/mods && curl -o ~/.commandcode/mods/statusline.ts \
  https://raw.githubusercontent.com/holtwood/cmdc-statusline/main/index.ts
```

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.commandcode\mods" | Out-Null
Invoke-WebRequest -OutFile "$env:USERPROFILE\.commandcode\mods\statusline.ts" `
  https://raw.githubusercontent.com/holtwood/cmdc-statusline/main/index.ts
```

Nur einen Installationsweg wählen: Paket und abgelegte Datei sind zwei verschiedene Mods, die
dieselben Flag-Namen deklarieren — Command Code löst Flag-Namen global über Mods hinweg auf.

> Unter Windows heißt das Binary `cmdc` (`cmd` öffnet die Windows-Shell) — dort also `cmdc mods add …`, `cmdc mods list`, `cmdc --mod .\index.ts`.

Ohne Installation testen: `cmd --mod ./index.ts`. Mods werden einmal pro Prozess geladen — nach
Änderungen `/reload` oder eine neue Sitzung. Kein Build-Schritt: Command Code kompiliert das
TypeScript beim Laden.

### Installation durch einen KI-Agenten

Wer die Shell nicht selbst anfassen möchte, gibt dem Agenten (Claude Code, Codex, Command Code, …)
Folgendes:

> Installiere das Command-Code-Mod `cmdc-statusline` im Benutzer-Scope: führe
> `cmd mods add cmdc-statusline -g` aus (unter Windows `cmdc` statt `cmd`; findet npm das Paket
> nicht, nimm `holtwood/cmdc-statusline`), und bestätige dann mit `cmd mods list`, dass
> `cmdc-statusline` als Benutzer-Scope ohne Ladewarnungen erscheint. Erinnere mich abschließend
> daran, die Sitzung neu zu starten, damit die Zeile gezeichnet wird.

Es braucht kein root und schreibt nur nach `~/.commandcode/mods/` sowie in den `mods.sources`-Eintrag
in `~/.commandcode/settings.json`.

## Segmente

| Segment | Bedeutung |
|---|---|
| `deepseek-v4.1-flash` | Aktives Modell, genau wie von der Anfrage gemeldet (`raw-model=true` behält das Anbieter-Präfix) |
| `max` | Reasoning-Aufwand der letzten Anfrage |
| `█░░░ 32k (3.2%)` | Kontext der letzten Anfrage: Verlaufsbalken (grün→gelb→rot je Zelle), Token, Anteil am Fenster |
| `cache 99%` | Trefferquote des Prompt-Caches (Cache-Lesen ÷ Eingabe) |
| `$0.013` | Sitzungskosten: Verlauf beim Fortsetzen + Neues aus diesem Prozess |
| `42 tok/s` | Ausgabegeschwindigkeit der letzten Anfrage (Echtzeit, inkl. Wartezeit auf das erste Token) |
| `sub 16k` | Von Subagenten (Tool `agent`) in dieser Sitzung verbrauchte Token |
| `Simple Reply` | Sitzungsname (übersteht `/reload` und Fortsetzen) |
| `main ↑1` | Git-Branch mit ahead/behind |
| `+1 ~2 ?1` | bereitgestellt · geändert · unverfolgt (`clean`, wenn sauber) |
| `my-project` | Name des aktuellen Verzeichnisses |

## Konfiguration

Die Konfiguration liegt in JSON; die Kommandozeile kann sie pro Lauf überschreiben.

```
~/.commandcode/statusline.json          Benutzer-Scope
<Projekt>/.commandcode/statusline.json  Projekt-Scope (gewinnt gegen Benutzer)
--mod-option <name>=<value>             Überschreibung pro Lauf
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

| Schlüssel | Standard | Hinweis |
|---|---|---|
| `model`, `effort`, `context` | `true` | Modell / Aufwand / Kontext der letzten Anfrage |
| `bar`, `bar-width`, `percent` | `true`, `12`, `true` | Balken, Breite in Zellen, Prozentwert |
| `cache` | `true` | Cache-Trefferquote |
| `cost` | `true` | Sitzungskosten |
| `speed` | `true` | Ausgabegeschwindigkeit |
| `sub` | `true` | Subagent-Token |
| `name` | `true` | Sitzungsname (auf 24 Zeichen gekürzt) |
| `git` | `true` | Branch + Änderungszähler |
| `cwd` | `true` | Verzeichnisname |
| `raw-model` | `false` | Anbieter-Präfix beibehalten |
| `ascii` | `false` | reines ASCII-Rendering erzwingen |
| `refresh` | `10` | Sekunden zwischen Git-Neulektüren (0 = Timer aus) |

**Vorrang-Hinweis:** Command Code entfernt die **Werte** von `--mod-option` aus dem für ein Mod
sichtbaren argv. Ein Flag gilt daher nur dann als explizite Überschreibung, wenn sein Wert **vom
eingebauten Standard abweicht**. Den Standard explizit zu übergeben (`--mod-option cwd=true`)
gewinnt nicht gegen eine Konfigurationsdatei.

## Darstellung

- `COLORTERM=truecolor|24bit` → 24-Bit-Verlaufsbalken; sonst 256-Farben-Näherung; `ascii=true`
  oder `TERM=dumb` → `#`/`-`; `NO_COLOR` behält die Blockzeichen, entfernt aber Farbe.
- **Schmale Terminals:** statt abzuschneiden werden Segmente nach Priorität entfernt
  (`cwd` → Geschwindigkeit → effort → Subagent → Cache → Sitzungsname → Kosten → Änderungen, danach
  schrumpft der Kontext von Balken → Token+% → Token, zuletzt der Branch) und die Zeile wird beim
  Resize sofort neu gezeichnet. Das Modell wird nie entfernt.

## Woher die Zahlen kommen

| Wert | Quelle | Verlässlichkeit |
|---|---|---|
| Modell / effort / Kontext / Cache | Ereignisse `model_request_start` / `model_request_end` | exakt |
| Sitzungskosten | `costUsd` aus `<sessionId>.jsonl` beim Fortsetzen + `usage` je Anfrage über die Preistabelle | der Fortsetzungs-Teil ist die Zahl des Produkts selbst; der neue Teil bildet seine Abrechnung nach (Eintrag für Eintrag geprüft) |
| Subagent-Token | Ereignis `subagent_stop` | Token exakt; Subagent-Kosten fließen **nicht** in die Kostenzeile (das Produkt persistiert sie ebenfalls nicht) |
| Sitzungsname | Ereignis `session_titled` + `<sessionId>.meta.json` beim Start | nach bestem Bemühen — das Dateiformat ist undokumentiert, gelesen wird in einem `try` |
| Branch / Änderungen | `git status --porcelain=v1 -b` via `cmd.exec` | exakt, 5-s-Cache |

Die Tabellen für Kontextfenster und Preise werden aus dem mit der CLI gelieferten Modellkatalog
**generiert**, nicht handschriftlich gepflegt:

```bash
python3 scripts/gen-model-tables.py           # nach einem CLI-Update neu erzeugen
python3 scripts/gen-model-tables.py --check   # schlägt fehl, wenn die Tabellen abweichen (macht die CI)
```

Ein fehlendes Modell degradiert sauber: ohne Fenster kein Balken/Prozentwert, ohne Preis keine Kosten.

## Entwicklung

```bash
node test/statusline.test.mjs     # die ganze Suite: keine Abhängigkeiten, kein Build
python3 scripts/gen-model-tables.py --check
```

Die Tests importieren `index.ts` direkt — Node 22.18+/24 entfernt die Typen, daher ist keine
Toolchain nötig. Andere Kopie testen mit `STATUSLINE_MOD=/path/to/statusline.ts`. Die CI fährt
dieselbe Suite unter Linux, macOS und Windows.

## Bekannte Einschränkungen

- **Kein Credits-/Quota-Segment.** Andere Mods lesen die Command-Code-API für Restguthaben und
  5-Stunden-/Wochenfenster; dieses Mod ist bewusst lokal (kein Netzwerk, kein `auth.json`).
- Die Kosten neuer Anfragen werden aus der mitgelieferten Preistabelle berechnet, nicht aus dem
  Transcript zurückgelesen. Preisänderungen erfordern daher einen erneuten Lauf von
  `scripts/gen-model-tables.py` (Fortsetzungs-Seed und Pro-Anfrage-Rechnung sind gegen die Zahlen
  des Produkts abgeglichen).
- Sitzungsname und Kostenwiederherstellung lesen `~/.commandcode/projects/**` — eine undokumentierte
  Ablage. Alles ist abgesichert: eine Änderung bedeutet „Segment fehlt", niemals einen Absturz.
- **Polling in riesigen Repositories.** Die Zeile liest `git status` alle `refresh` Sekunden neu
  (Standard 10). In kleinen Repos ist der Aufruf gratis, in riesigen nicht — erhöhe `refresh` oder
  setze ihn auf `0` und überlasse es den ereignisgesteuerten Aktualisierungen.

## Ähnliche Projekte

Für einen anderen Geschmack: [grknbyk/commandcode-statusline](https://github.com/grknbyk/commandcode-statusline)
(Credits, Nutzungsfenster, Ausgabetempo), [vikas-gits-good/cmd-statusline](https://github.com/vikas-gits-good/cmd-statusline)
(Vorlagen-Layout, Umgang mit schmalen Terminals), [estifie/command-code-mod-session-stats](https://github.com/estifie/command-code-mod-session-stats)
(Kontextdruck, Cache-Trefferquote, Transkript-basierte Kosten inkl. Subagenten).

## Lizenz

MIT
