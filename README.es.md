# cmdc-statusline

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | **Español** | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md)

> Esta traducción fue generada con ayuda de IA. Si hay ambigüedad, prevalece la [versión en inglés](README.md). Se agradecen PRs de corrección.

Una barra de estado para [Command Code](https://commandcode.ai) (`cmdc`): modelo, barra de
contexto con degradado, tasa de aciertos de caché, coste de la sesión, velocidad de salida,
uso de subagentes, nombre de sesión y estado de git, todo en la línea bajo el panel de entrada.

```text
deepseek-v4.1-flash │ max │ █░░░░░░░░░░░ 32k (3.2%) │ cache 99% │ $0.013 │ 42 tok/s │ sub 16k │ Simple Reply │ main ↑1 │ +1 ~2 ?1 │ my-project
```

Command Code no tiene un hook externo `statusLine` como Claude Code: `cmd.ui.setStatus()` (la API
de mods) es la única forma de dibujar una línea persistente bajo el panel de entrada, y eso es lo
que usa este mod.

## Instalación

```bash
cmd mods add holtwood/cmdc-statusline -g     # ámbito de usuario (sin -g, ámbito de proyecto)
cmd mods list                                # debería listar el mod
```

También puedes copiar el archivo a mano y prescindir del sistema de paquetes:

```bash
mkdir -p ~/.commandcode/mods
curl -o ~/.commandcode/mods/statusline.ts \
  https://raw.githubusercontent.com/holtwood/cmdc-statusline/main/index.ts
```

> En Windows el binario es `cmdc` (`cmd` abre el shell de Windows): usa `cmdc mods add …`, `cmdc mods list`, etc.

Pruébalo sin instalar: `cmd --mod ./index.ts`. Los mods se cargan una vez por proceso: usa `/reload`
o abre una sesión nueva tras un cambio. No hay paso de compilación: Command Code compila el
TypeScript al cargarlo.

## Segmentos

| Segmento | Significado |
|---|---|
| `deepseek-v4.1-flash` | Modelo activo, tal como lo informa la petición (`raw-model=true` conserva el prefijo del proveedor) |
| `max` | Esfuerzo de razonamiento de la última petición |
| `█░░░ 32k (3.2%)` | Contexto de la última petición: barra con degradado (verde→amarillo→rojo según la celda), tokens, porcentaje de la ventana |
| `cache 99%` | Tasa de aciertos de la caché de prompt (lecturas de caché ÷ entrada) |
| `$0.013` | Coste de la sesión: historial al reanudar + lo nuevo de este proceso |
| `42 tok/s` | Velocidad de salida de la última petición (tiempo real, incluye la espera del primer token) |
| `sub 16k` | Tokens consumidos por subagentes (herramienta `agent`) en esta sesión |
| `Simple Reply` | Nombre de la sesión (sobrevive a `/reload` y a reanudar) |
| `main ↑1` | Rama de git con ahead/behind |
| `+1 ~2 ?1` | preparado · modificado · sin seguimiento (muestra `clean` si está limpio) |
| `my-project` | Nombre del directorio actual |

## Configuración

La configuración vive en JSON; la línea de comandos puede sobrescribirla por ejecución.

```
~/.commandcode/statusline.json          ámbito de usuario
<proyecto>/.commandcode/statusline.json ámbito de proyecto (gana al de usuario)
--mod-option <name>=<value>             sobrescritura puntual
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

| Clave | Por defecto | Notas |
|---|---|---|
| `model`, `effort`, `context` | `true` | modelo / esfuerzo / contexto de la última petición |
| `bar`, `bar-width`, `percent` | `true`, `12`, `true` | barra, ancho en celdas, porcentaje |
| `cache` | `true` | tasa de aciertos de caché |
| `cost` | `true` | coste de la sesión |
| `speed` | `true` | velocidad de salida |
| `sub` | `true` | tokens de subagentes |
| `name` | `true` | nombre de sesión (recortado a 24 caracteres) |
| `git` | `true` | rama + recuento de cambios |
| `cwd` | `true` | nombre del directorio |
| `raw-model` | `false` | conserva el prefijo del proveedor |
| `ascii` | `false` | fuerza renderizado ASCII |
| `refresh` | `10` | segundos entre relecturas de git (0 desactiva el temporizador) |

**Aviso de precedencia:** Command Code borra los **valores** de `--mod-option` del argv que ve un mod,
así que un flag solo cuenta como sobrescritura explícita cuando su valor **difiere del valor por
defecto**. Pasar el valor por defecto explícitamente (`--mod-option cwd=true`) no gana a un archivo
de configuración.

## Renderizado

- `COLORTERM=truecolor|24bit` → barra en 24 bits; si no, aproximación a 256 colores;
  `ascii=true` o `TERM=dumb` → `#`/`-`; `NO_COLOR` mantiene los bloques y quita el color.
- **Terminales estrechas:** en vez de recortar, se eliminan segmentos por prioridad
  (`cwd` → velocidad → effort → subagente → caché → nombre → coste → cambios; después el contexto
  se encoge de barra → tokens+% → tokens; por último la rama) y la línea se redibuja al redimensionar.
  El modelo nunca se elimina.

## De dónde salen los números

| Valor | Fuente | Fiabilidad |
|---|---|---|
| modelo / effort / contexto / caché | eventos `model_request_start` / `model_request_end` | exacto |
| coste de sesión | `costUsd` de `<sessionId>.jsonl` al reanudar + `usage` de cada petición valorado con la tabla de precios | la parte de reanudación es el número del propio producto; la parte nueva reproduce su contabilidad (verificada entrada por entrada) |
| tokens de subagentes | eventos `subagent_stop` | tokens exactos; el gasto de subagentes **no** se suma al coste (el producto tampoco lo persiste) |
| nombre de sesión | evento `session_titled` + `<sessionId>.meta.json` al arrancar | mejor esfuerzo: el formato del archivo no está documentado y se lee dentro de un `try` |
| rama / cambios | `git status --porcelain=v1 -b` vía `cmd.exec` | exacto, caché de 5 s |

Las tablas de ventana de contexto y de precios se **generan** desde el catálogo de modelos que
acompaña a la CLI, no se escriben a mano:

```bash
python3 scripts/gen-model-tables.py           # regenerar tras actualizar la CLI
python3 scripts/gen-model-tables.py --check   # falla si las tablas se desviaron (lo hace la CI)
```

Un modelo ausente degrada con elegancia: sin ventana no hay barra ni porcentaje, sin precio no hay coste.

## Desarrollo

```bash
node test/statusline.test.mjs     # 136 aserciones, sin dependencias ni compilación
python3 scripts/gen-model-tables.py --check
```

Las pruebas importan `index.ts` directamente: Node 22.18+/24 elimina los tipos, así que no hay
toolchain. Apunta a otra copia con `STATUSLINE_MOD=/path/to/statusline.ts`.

## Limitaciones conocidas

- **Sin segmento de créditos o cuota.** Otros mods leen la API de Command Code para ver créditos
  restantes y ventanas de 5 horas/semanales; este es deliberadamente local (sin red, sin `auth.json`).
- El coste de las peticiones nuevas se calcula con la tabla de precios incluida, no se relee del
  transcript, así que un cambio de precios requiere reejecutar `scripts/gen-model-tables.py`
  (tanto la semilla de reanudación como el cálculo por petición están cotejados con el producto).
- El nombre de sesión y la restauración de coste leen `~/.commandcode/projects/**`, una disposición
  no documentada. Todo está envuelto para degradar a "falta el segmento", nunca a un fallo.

## Proyectos similares

Si buscas otro enfoque: [grknbyk/commandcode-statusline](https://github.com/grknbyk/commandcode-statusline)
(créditos, ventanas de uso, ritmo de gasto), [vikas-gits-good/cmd-statusline](https://github.com/vikas-gits-good/cmd-statusline)
(plantilla de diseño, gestión de terminal estrecha), [estifie/command-code-mod-session-stats](https://github.com/estifie/command-code-mod-session-stats)
(presión de contexto, aciertos de caché, gasto del transcript con subagentes).

## Licencia

MIT
