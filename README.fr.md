# cmdc-statusline

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | **Français** | [Deutsch](README.de.md) | [Русский](README.ru.md)

> Cette traduction a été produite avec l'aide d'une IA. En cas d'ambiguïté, la [version anglaise](README.md) fait foi. Les PR de correction sont bienvenues.

Une ligne de statut pour [Command Code](https://commandcode.ai) (`cmd`, ou `cmdc` sous Windows) :
modèle, barre de contexte en dégradé, taux de succès du cache, coût de la session, vitesse de sortie,
usage des sous-agents, nom de session et état git, le tout sur la ligne sous la zone de saisie.

```text
deepseek-v4.1-flash │ max │ █░░░░░░░░░░░ 32k (3.2%) │ cache 99% │ $0.013 │ 42 tok/s │ sub 16k │ Simple Reply │ main ↑1 │ +1 ~2 ?1 │ my-project
```

Command Code n'a pas de hook externe `statusLine` comme Claude Code : `cmd.ui.setStatus()` (l'API
des mods) est le seul moyen d'afficher une ligne permanente sous la zone de saisie, et c'est ce que
fait ce mod.

## Prérequis

**Command Code ≥ 1.10.0** (`cmd`, ou `cmdc` sous Windows). Les versions anciennes **ne sont pas
prises en charge** : face à un hôte ancien le mod ne fait rien du tout — il n'enregistre rien, ne
dessine pas la ligne et laisse un unique avis de mise à jour dans le fil avant de se désactiver.
Lancez `cmdc update` puis rouvrez une session. Ce minimum n'est pas une supposition : avant 1.10.0
l'API des mods n'a pas de `cmd.ui.capabilities` (vérifié sur tous les paquets 1.x publiés), le mod ne
peut donc même pas savoir si l'hôte dessine une ligne — il lèverait une exception au lieu de se
dégrader. Le rapport de `/statusline` affiche la version de l'hôte détectée.

## Installation

```bash
cmd mods add cmdc-statusline -g              # depuis npm (-g = portée utilisateur ; sans -g, le projet courant)
cmd mods list                                # le mod doit apparaître
```

Le même paquet s'installe aussi depuis git : `cmd mods add holtwood/cmdc-statusline -g`, si vous
préférez ne pas dépendre du registre.

Vous pouvez aussi déposer le fichier à la main, sans passer par les paquets : placez `index.ts` dans
`~/.commandcode/mods/statusline.ts` (`%USERPROFILE%\.commandcode\mods\statusline.ts` sous Windows)
et ouvrez une nouvelle session :

```bash
mkdir -p ~/.commandcode/mods && curl -o ~/.commandcode/mods/statusline.ts \
  https://raw.githubusercontent.com/holtwood/cmdc-statusline/main/index.ts
```

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.commandcode\mods" | Out-Null
Invoke-WebRequest -OutFile "$env:USERPROFILE\.commandcode\mods\statusline.ts" `
  https://raw.githubusercontent.com/holtwood/cmdc-statusline/main/index.ts
```

Choisissez une seule méthode d'installation : le paquet et le fichier déposé sont deux mods
distincts qui déclarent les mêmes noms de flag — Command Code résout ces noms globalement entre les
mods.

> Sous Windows, le binaire est `cmdc` (`cmd` ouvre le shell Windows) : utilisez `cmdc mods add …`, `cmdc mods list`, `cmdc --mod .\index.ts`.

Essai sans installation : `cmd --mod ./index.ts`. Les mods ne sont chargés qu'une fois par
processus : utilisez `/reload` ou une nouvelle session après modification. Aucune étape de build —
Command Code compile le TypeScript au chargement.

### Installation par un agent IA

Si vous préférez ne pas toucher au shell, collez ceci dans votre agent (Claude Code, Codex,
Command Code, …) :

> Installe le mod Command Code `cmdc-statusline` en portée utilisateur : exécute
> `cmd mods add cmdc-statusline -g` (sous Windows, utilise `cmdc` au lieu de `cmd` ; si npm ne trouve
> pas le paquet, utilise `holtwood/cmdc-statusline`), puis vérifie que `cmd mods list` affiche
> `cmdc-statusline` en portée utilisateur sans avertissement de chargement. Enfin, rappelle-moi de
> redémarrer la session pour que la ligne s'affiche.

Aucun droit root n'est requis : il n'écrit que dans `~/.commandcode/mods/` et dans l'entrée
`mods.sources` de `~/.commandcode/settings.json`.

## Segments

| Segment | Signification |
|---|---|
| `deepseek-v4.1-flash` | Modèle actif, tel que rapporté par la requête (`raw-model=true` garde le préfixe fournisseur) |
| `max` | Effort de raisonnement de la dernière requête |
| `█░░░ 32k (3.2%)` | Contexte de la dernière requête : barre en dégradé (vert→jaune→rouge selon la cellule), jetons, part de la fenêtre |
| `cache 99%` | Taux de succès du cache de prompt (lectures cache ÷ entrée) |
| `$0.013` | Coût de la session : historique à la reprise + nouveautés de ce processus |
| `42 tok/s` | Vitesse de sortie de la dernière requête (temps réel, inclut l'attente du premier jeton) |
| `sub 16k` | Jetons consommés par les sous-agents (outil `agent`) dans cette session |
| `Simple Reply` | Nom de session (survit à `/reload` et à la reprise) |
| `main ↑1` | Branche git avec ahead/behind |
| `+1 ~2 ?1` | indexé · modifié · non suivi (`clean` si propre) |
| `my-project` | Nom du répertoire courant |

## Configuration

La configuration est en JSON ; la ligne de commande peut la surcharger ponctuellement.

```
~/.commandcode/statusline.json           portée utilisateur
<projet>/.commandcode/statusline.json    portée projet (prioritaire)
--mod-option <name>=<value>              surcharge ponctuelle
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

`preset` choisit un jeu de segments tout prêt, pour ne pas avoir à lister une douzaine de clés :

| `preset` | Activés |
|---|---|
| `full` (défaut) | tous |
| `minimal` | `model` `effort` `context` `bar` `percent` `git` |
| `usage` | `context` `bar` `percent` `cache` `cost` `sub` |

Un preset décide seulement *quels segments sont affichés*. Une clé écrite à côté le remplace
(`{"preset": "minimal", "cost": true}` garde le coût), et les interrupteurs de rendu (`ascii`,
`raw-model`) en sont indépendants. Un preset inconnu est signalé et traité comme `full`.

| Clé | Défaut | Remarques |
|---|---|---|
| `model`, `effort`, `context` | `true` | modèle / effort / contexte de la dernière requête |
| `bar`, `bar-width`, `percent` | `true`, `12`, `true` | barre, largeur en cellules, pourcentage |
| `cache` | `true` | taux de succès du cache |
| `cost` | `true` | coût de la session |
| `speed` | `true` | vitesse de sortie |
| `sub` | `true` | jetons des sous-agents |
| `name` | `true` | nom de session (tronqué à 24 caractères) |
| `git` | `true` | branche + nombre de changements |
| `cwd` | `true` | nom du répertoire |
| `preset` | `full` | `full` / `minimal` / `usage` |
| `raw-model` | `false` | garde le préfixe fournisseur |
| `ascii` | `false` | force le rendu ASCII |
| `refresh` | `10` | secondes entre deux lectures de git (0 = pas de minuteur) |

### Voir ce qui est réellement appliqué

`/statusline` affiche la ligne rendue, les valeurs brutes derrière elle et un tableau
`clé / défaut / effectif / origine` pour chaque clé, plus les fichiers lus et une ligne pour tout ce
qu'il n'a pas pu utiliser : une clé inconnue (souvent une faute de frappe), une valeur de la mauvaise
forme, un preset non reconnu. Les valeurs refusées reviennent au défaut et le disent, au lieu de
s'appliquer à moitié : vous ne restez pas à deviner pourquoi un changement n'a rien fait.

### Le changer sans éditer le JSON à la main

`/statusline config` fait la même chose via les boîtes de dialogue de Command Code (`cmd.ui.select` /
`input` / `confirm`) : portée (utilisateur ou projet), clé, valeur, confirmation. Il ne réécrit que
cette clé — le reste du fichier, y compris les clés que ce mod ne connaît pas, est préservé — puis
relit la configuration et **redessine la ligne immédiatement** : plus d'aller-retour par `/reload`.
Une exécution sans boîtes de dialogue (headless) affiche le rapport et n'écrit rien ; refuser la
confirmation n'écrit rien non plus. Si une source plus prioritaire (le fichier du projet,
`--mod-option`) conserve l'ancienne valeur, le flux le dit — plutôt que de vous laisser avec une
écriture qui, visiblement, n'a rien changé.

(Les messages de `/statusline` lui-même sont en chinois.)

**Précédence :** Command Code supprime les **valeurs** de `--mod-option` de l'argv visible par un mod.
Un flag n'est donc considéré comme une surcharge explicite que si sa valeur **diffère du défaut**.
Passer explicitement la valeur par défaut (`--mod-option cwd=true`) ne l'emporte pas sur un fichier
de configuration.

## Rendu

- **Au démarrage.** Presque tous les segments décrivent la **dernière requête au modèle**, qu'une
  session qui n'en a encore envoyé aucune n'a pas ; la ligne affiche donc ce qui est déjà connu au
  lieu d'attendre le premier `model_request_end` : le modèle et l'effort depuis
  `~/.commandcode/config.json`, plus le nom de session, l'état git et le répertoire. Une session
  **reprise** restaure en outre depuis le transcript le modèle, l'effort, le contexte, le taux de
  cache et le coût de la dernière requête : elle s'ouvre sur la même ligne complète que celle
  quittée. Seules la vitesse de sortie et les tokens de sous-agent exigent vraiment une requête (le
  produit ne persiste ni l'une ni les autres).
- `COLORTERM=truecolor|24bit` → barre 24 bits ; sinon approximation 256 couleurs ; `ascii=true` ou
  `TERM=dumb` → `#`/`-` ; `NO_COLOR` garde les blocs mais retire la couleur.
- **Terminaux étroits :** au lieu de tronquer, les segments sont retirés par priorité
  (`cwd` → vitesse → effort → sous-agent → cache → nom → coût → changements, puis le contexte se
  réduit de barre → jetons+% → jetons, enfin la branche) et la ligne est redessinée au redimensionnement.
  Le modèle n'est jamais retiré.

## D'où viennent les chiffres

| Valeur | Source | Fiabilité |
|---|---|---|
| modèle / effort / contexte / cache | événements `model_request_start` / `model_request_end` (model/effort avant la première requête depuis `~/.commandcode/config.json` ; à la reprise, depuis le transcript) | exact après une requête ; la valeur initiale est celle du produit |
| coût de session | `costUsd` de `<sessionId>.jsonl` à la reprise + `usage` par requête valorisé par la table de prix | la partie reprise est le chiffre du produit lui-même ; la partie nouvelle reproduit sa comptabilité (vérifiée entrée par entrée) |
| jetons des sous-agents | événements `subagent_stop` | jetons exacts ; leur dépense n'est **pas** incluse dans le coût (le produit ne la persiste pas non plus) |
| nom de session | événement `session_titled` + `<sessionId>.meta.json` au démarrage | au mieux : le format du fichier n'est pas documenté et la lecture est protégée par un `try` |
| branche / changements | `git status --porcelain=v1 -b` via `cmd.exec` | exact, cache de 5 s |

Les tables de fenêtre de contexte et de prix sont **générées** à partir du catalogue livré avec la
CLI, jamais écrites à la main :

```bash
python3 scripts/gen-model-tables.py           # régénérer après une mise à jour de la CLI
python3 scripts/gen-model-tables.py --check   # échoue si les tables ont divergé (la CI le fait)
```

Un modèle absent se dégrade proprement : sans fenêtre, pas de barre ni de pourcentage ; sans prix,
pas de coût.

## Développement

```bash
node test/statusline.test.mjs     # toute la suite : sans dépendance ni build
python3 scripts/gen-model-tables.py --check
```

Les tests importent `index.ts` directement : Node 22.18+/24 retire les types, donc aucune chaîne
d'outils n'est nécessaire. Ciblez une autre copie avec `STATUSLINE_MOD=/path/to/statusline.ts`.
La CI exécute la même suite sous Linux, macOS et Windows.

## Limites connues

- **Pas de segment crédits/quota.** D'autres mods interrogent l'API Command Code pour les crédits
  restants et les fenêtres 5 h/hebdo ; celui-ci est volontairement local (pas de réseau, pas d'`auth.json`).
- Le coût des nouvelles requêtes est calculé avec la table de prix embarquée, pas relu du transcript :
  un changement de tarif impose de relancer `scripts/gen-model-tables.py` (la graine de reprise comme
  le calcul par requête sont confrontés aux chiffres du produit).
- Le nom de session et la restauration du coût lisent `~/.commandcode/projects/**`, et la valeur
  initiale model/effort au démarrage lit `~/.commandcode/config.json` : des dispositions non
  documentées. Tout est protégé : un changement se traduit par « segment absent », jamais un crash.
- **Interrogation sur les très gros dépôts.** La ligne relit `git status` toutes les `refresh`
  secondes (10 par défaut). Cet appel est gratuit sur un petit dépôt, pas sur un énorme : augmentez
  `refresh` ou mettez-le à `0` et laissez les rafraîchissements par événement faire le travail.

## Projets similaires

Pour un autre goût : [grknbyk/commandcode-statusline](https://github.com/grknbyk/commandcode-statusline)
(crédits, fenêtres d'usage, rythme de dépense), [vikas-gits-good/cmd-statusline](https://github.com/vikas-gits-good/cmd-statusline)
(mise en page par gabarit, gestion des terminaux étroits), [estifie/command-code-mod-session-stats](https://github.com/estifie/command-code-mod-session-stats)
(pression du contexte, cache, dépense issue du transcript avec sous-agents).

## Licence

MIT
