# cmdc-statusline

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | **Français** | [Deutsch](README.de.md) | [Русский](README.ru.md)

Une ligne de statut pour [Command Code](https://commandcode.ai) (`cmd`, ou `cmdc` sous
Windows) : modèle, barre de contexte en dégradé, taux de succès du cache, coût de session,
vitesse de sortie, usage des sous-agents, nom de session et état git, dessinée sous le
panneau de saisie via `cmd.ui.setStatus()`.

```text
deepseek-v4.1-flash │ max │ █░░░░░░░░░░░ 32k (3.2%) │ cache 99% │ $0.013 │ 42 tok/s │ sub 16k │ Simple Reply │ main ↑1 │ +1 ~2 ?1 │ my-project
```

**Nécessite Command Code ≥ 1.10.0.** Sur les hôtes plus anciens, le mod laisse un avis de
mise à jour puis se désactive — lancez `cmdc update` et ouvrez une nouvelle session.

## Installation

```bash
cmd mods add cmdc-statusline -g   # -g = portée utilisateur ; sans -g, ce projet seulement
cmd mods list
```

Alternatives :

- **Depuis git :** `cmd mods add holtwood/cmdc-statusline -g`
- **Fichier unique :** copiez `index.ts` dans `~/.commandcode/mods/statusline.ts`
  (`%USERPROFILE%\.commandcode\mods\statusline.ts` sous Windows) — sans compilation
- **Essai sans installation :** `cmd --mod ./index.ts` (un mod se charge une fois par
  processus — `/reload` pour prendre un changement)

Sous Windows le binaire est `cmdc` (`cmd` est le shell Windows). Choisissez une seule
méthode — le paquet et le fichier déposé sont deux mods qui déclarent les mêmes noms de
flags, résolus globalement entre mods.

Pour l'installer via un agent IA, collez :

> Installe le mod `cmdc-statusline` de Command Code en portée utilisateur : exécute
> `cmd mods add cmdc-statusline -g` (`cmdc` sous Windows ; si npm ne trouve pas le paquet,
> utilise `holtwood/cmdc-statusline`), vérifie que `cmd mods list` l'affiche, puis dis-moi
> de relancer la session.

## Segments

| Segment | Signification |
|---|---|
| `deepseek-v4.1-flash` | Modèle actif (`raw-model=true` garde le préfixe fournisseur) |
| `max` | Effort de raisonnement de la dernière requête |
| `█░░░ 32k (3.2%)` | Contexte de la dernière requête : barre en dégradé (vert→rouge), jetons, part de la fenêtre |
| `cache 99%` | Taux de succès du cache de prompt |
| `$0.013` | Coût de la session : historique à la reprise + nouvelles requêtes |
| `42 tok/s` | Vitesse de sortie de la dernière requête (temps réel, attente du premier jeton incluse) |
| `sub 16k` | Jetons consommés par les sous-agents dans cette session |
| `Simple Reply` | Nom de session (survit à `/reload` et à la reprise) |
| `main ↑1` | Branche git avec ahead/behind |
| `+1 ~2 ?1` | indexé · modifié · non suivi (`clean` si propre) |
| `my-project` | Nom du répertoire courant |

## Configuration

```
~/.commandcode/statusline.json          portée utilisateur
<projet>/.commandcode/statusline.json   portée projet (prime sur l'utilisateur)
--mod-option <clé>=<valeur>             ajustement par exécution
```

```json
{"preset": "full", "bar-width": 12, "refresh": 10, "cache": true, "cost": true}
```

Préréglages : `full` (défaut, tout) · `minimal` (model, effort, context, bar, percent, git)
· `usage` (context, bar, percent, cache, cost, sub). Une clé écrite à côté d'un préréglage
le prime.

| Clé | Défaut | Remarques |
|---|---|---|
| `model`, `effort`, `context` | `true` | modèle / effort / contexte de la dernière requête |
| `bar`, `bar-width`, `percent` | `true`, `12`, `true` | barre, largeur en cellules, pourcentage |
| `cache`, `cost`, `speed`, `sub` | `true` | succès cache / coût session / vitesse / jetons sous-agents |
| `name`, `git`, `cwd` | `true` | nom de session (24 car. max) / branche + changements / répertoire |
| `preset` | `full` | `full` / `minimal` / `usage` |
| `raw-model`, `ascii` | `false` | garder le préfixe fournisseur / rendu ASCII pur |
| `refresh` | `10` | secondes entre relectures de git (`0` coupe le polling) |

Deux commandes inspectent et modifient tout ça sans toucher au JSON :

- `/statusline` — ligne rendue, valeurs brutes, table `clé / défaut / effectif / source`,
  et un avertissement par entrée inutilisable (clé inconnue, mauvais type, préréglage
  inconnu). Le texte du rapport est en chinois.
- `/statusline config` — éditeur interactif (portée → clé → valeur → confirmation) ;
  n'écrit qu'une clé et repeint aussitôt, sans `/reload`.

Attention : `--mod-option` ne compte comme ajustement explicite que si la valeur diffère du
défaut intégré — passer `cwd=true` ne bat pas un fichier de configuration disant `false`.

## Fonctionnement

- **Démarrage/reprise :** avant la première requête, modèle et effort viennent de
  `~/.commandcode/config.json` ; une session reprise restaure aussi contexte, cache et coût
  depuis le transcript. Vitesse et jetons de sous-agents exigent une vraie requête.
- **Couleurs :** `COLORTERM=truecolor|24bit` → dégradé 24 bits, sinon approximation
  256 couleurs ; `ascii=true` ou `TERM=dumb` → `#`/`-` ; `NO_COLOR` garde les blocs sans
  la couleur.
- **Terminaux étroits :** les segments tombent par priorité plutôt que d'être tronqués
  (cwd → vitesse → effort → sous-agents → cache → nom → coût → changements → la barre
  rétrécit → branche) ; le modèle ne tombe jamais. Redessiné au redimensionnement.
- **Sources :** modèle/effort/contexte/cache depuis les événements de requête ; coût =
  transcript à la reprise + chaque requête tarifée par une table générée ; jetons de
  sous-agents depuis `subagent_stop` ; git via `git status --porcelain=v1 -b` (cache 5 s +
  polling à `refresh`).
- **Tables de modèles :** fenêtres de contexte et prix **générés** depuis le catalogue de
  modèles livré avec le CLI — `python3 scripts/gen-model-tables.py` pour régénérer,
  `--check` pour détecter la dérive (le CI le fait). Un modèle absent dégrade proprement
  (pas de barre / pas de coût).

## Développement

```bash
npm test                                    # node test/statusline.test.mjs — zéro dépendance, pas de build
python3 scripts/gen-model-tables.py --check
```

Node 22.18+/24 efface les types TypeScript à l'import : les tests exécutent `index.ts`
directement. `STATUSLINE_MOD=/path/to/statusline.ts` vise une autre copie. Le CI couvre
Linux, macOS et Windows.

## Limites connues

- Pas de segment crédits/quota — volontairement local uniquement (pas de réseau, pas
  d'`auth.json`).
- Le coût des nouvelles requêtes vient de la table de prix livrée ; un changement de prix
  du CLI demande de relancer `gen-model-tables.py`.
- Le nom de session, le coût et la restauration lisent des layouts non documentés de
  `~/.commandcode/**` — si le layout change, un segment disparaît, jamais de crash.
- `git status` est pollé toutes les `refresh` secondes — gratuit sur les petits dépôts,
  pas sur les énormes ; montez `refresh` ou mettez `0`.

## Projets similaires

[grknbyk/commandcode-statusline](https://github.com/grknbyk/commandcode-statusline) (crédits, fenêtres d'usage, rythme de dépense) ·
[vikas-gits-good/cmd-statusline](https://github.com/vikas-gits-good/cmd-statusline) (mise en page par gabarit, terminaux étroits) ·
[estifie/command-code-mod-session-stats](https://github.com/estifie/command-code-mod-session-stats) (pression du contexte, cache, dépense issue du transcript).

## Licence

MIT
