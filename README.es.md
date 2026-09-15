# cmdc-statusline

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | **Español** | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md)

> Esta traducción fue generada con ayuda de IA. Si hay ambigüedad, prevalece la [versión en inglés](README.md). Se agradecen PRs de corrección.

Una barra de estado para [Command Code](https://commandcode.ai) (`cmd`, o `cmdc` en Windows):
modelo, barra de contexto con degradado, tasa de aciertos de caché, coste de la sesión, velocidad de
salida, uso de subagentes, nombre de sesión y estado de git, todo en la línea bajo el panel de entrada.

```text
deepseek-v4.1-flash │ max │ █░░░░░░░░░░░ 32k (3.2%) │ cache 99% │ $0.013 │ 42 tok/s │ sub 16k │ Simple Reply │ main ↑1 │ +1 ~2 ?1 │ my-project
```

Command Code no tiene un hook externo `statusLine` como Claude Code: `cmd.ui.setStatus()` (la API
de mods) es la única forma de dibujar una línea persistente bajo el panel de entrada, y eso es lo
que usa este mod.

## Requisitos

**Command Code ≥ 1.10.0** (`cmd`, o `cmdc` en Windows). Las versiones antiguas **no son
compatibles**: ante un host antiguo el mod no hace absolutamente nada — no registra nada, no dibuja
la barra y deja un solo aviso de actualización en el feed antes de desactivarse. Ejecuta
`cmdc update` y abre una sesión nueva. El mínimo no es una suposición: antes de 1.10.0 la API de
mods no tiene `cmd.ui.capabilities` (cotejado con todos los paquetes 1.x publicados), así que el mod
ni siquiera puede saber si este host dibuja una barra — lanzaría una excepción en vez de degradarse.
El informe de `/statusline` muestra la versión del host que detectó.

## Instalación

```bash
cmd mods add cmdc-statusline -g              # desde npm (-g = ámbito de usuario; sin -g, solo el proyecto)
cmd mods list                                # debería listar el mod
```

El mismo paquete también se instala desde git: `cmd mods add holtwood/cmdc-statusline -g`, si
prefieres no depender del registro.

También puedes copiar el archivo a mano y prescindir del sistema de paquetes: pon `index.ts` en
`~/.commandcode/mods/statusline.ts` (`%USERPROFILE%\.commandcode\mods\statusline.ts` en Windows)
y abre una sesión nueva:

```bash
mkdir -p ~/.commandcode/mods && curl -o ~/.commandcode/mods/statusline.ts \
  https://raw.githubusercontent.com/holtwood/cmdc-statusline/main/index.ts
```

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.commandcode\mods" | Out-Null
Invoke-WebRequest -OutFile "$env:USERPROFILE\.commandcode\mods\statusline.ts" `
  https://raw.githubusercontent.com/holtwood/cmdc-statusline/main/index.ts
```

Elige una sola vía de instalación: el paquete y el archivo suelto son dos mods distintos y ambos
declaran los mismos nombres de flag — Command Code resuelve esos nombres globalmente entre mods.

> En Windows el binario es `cmdc` (`cmd` abre el shell de Windows): usa `cmdc mods add …`, `cmdc mods list`, `cmdc --mod .\index.ts`.

Pruébalo sin instalar: `cmd --mod ./index.ts`. Los mods se cargan una vez por proceso: usa `/reload`
o abre una sesión nueva tras un cambio. No hay paso de compilación: Command Code compila el
TypeScript al cargarlo.

### Instalación con un agente de IA

Si prefieres no tocar el shell, pega esto en tu agente (Claude Code, Codex, Command Code, …):

> Instala el mod `cmdc-statusline` de Command Code con ámbito de usuario: ejecuta
> `cmd mods add cmdc-statusline -g` (en Windows usa `cmdc` en lugar de `cmd`; si npm no encuentra el
> paquete, usa `holtwood/cmdc-statusline`), y confirma que `cmd mods list` muestra `cmdc-statusline`
> con ámbito de usuario y sin avisos de carga. Por último, recuérdame reiniciar la sesión para que se
> dibuje la barra.

No necesita root y solo escribe en `~/.commandcode/mods/` y en la entrada `mods.sources` de
`~/.commandcode/settings.json`.

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

`preset` elige un conjunto de segmentos ya hecho para no tener que listar una docena de claves:

| `preset` | Se activan |
|---|---|
| `full` (por defecto) | todos |
| `minimal` | `model` `effort` `context` `bar` `percent` `git` |
| `usage` | `context` `bar` `percent` `cache` `cost` `sub` |

Un preset solo decide *qué segmentos se muestran*. Una clave escrita a su lado lo anula
(`{"preset": "minimal", "cost": true}` sigue mostrando el coste), y los interruptores de
representación (`ascii`, `raw-model`) son independientes. Un preset desconocido se señala y se
trata como `full`.

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
| `preset` | `full` | `full` / `minimal` / `usage` |
| `raw-model` | `false` | conserva el prefijo del proveedor |
| `ascii` | `false` | fuerza renderizado ASCII |
| `refresh` | `10` | segundos entre relecturas de git (0 desactiva el temporizador) |

### Ver qué está realmente en efecto

`/statusline` imprime la línea renderizada, los valores crudos que hay detrás y una tabla
`clave / por defecto / efectivo / origen` de todas las claves, además de los archivos leídos y una
línea por cada cosa que no pudo usar: una clave desconocida (normalmente una errata), un valor con la
forma equivocada, un preset no reconocido. Los valores rechazados vuelven al valor por defecto y lo
dicen, en lugar de aplicarse a medias: no te quedas adivinando por qué un cambio no hizo nada.

### Cambiarlo sin editar el JSON a mano

`/statusline config` hace lo mismo con los diálogos de Command Code (`cmd.ui.select` / `input` /
`confirm`): eliges el ámbito (usuario o proyecto), la clave, el valor y confirmas. Reescribe solo esa
clave —el resto del archivo, incluidas las claves que este mod no conoce, se conserva—, vuelve a leer
la configuración y **repinta la barra de inmediato**, así que no hay ida y vuelta por `/reload`. Una
ejecución sin diálogos (headless) imprime el informe y no escribe nada; rechazar la confirmación
tampoco escribe. Si algo con más precedencia (el archivo del proyecto, `--mod-option`) mantiene el
valor anterior, el flujo lo dice en lugar de dejarte con una escritura que visiblemente no hizo nada.

(Los mensajes del propio `/statusline` están en chino.)

**Aviso de precedencia:** Command Code borra los **valores** de `--mod-option` del argv que ve un mod,
así que un flag solo cuenta como sobrescritura explícita cuando su valor **difiere del valor por
defecto**. Pasar el valor por defecto explícitamente (`--mod-option cwd=true`) no gana a un archivo
de configuración.

## Renderizado

- **Al arrancar.** Casi todos los segmentos describen la **última petición al modelo**, que una
  sesión que aún no ha enviado ninguna no tiene; así que la línea pinta lo que ya se sabe en vez de
  esperar al primer `model_request_end`: el modelo y el esfuerzo desde
  `~/.commandcode/config.json`, más el nombre de sesión, el estado de git y el directorio. Una sesión
  **reanudada** restaura además del transcript el modelo, el esfuerzo, el contexto, la tasa de
  acierto de caché y el coste de la última petición, así que se abre con la misma línea completa con
  la que se dejó. Solo la velocidad de salida y los tokens de subagente necesitan realmente que
  ocurra una petición (el producto no persiste ninguno de los dos).
- `COLORTERM=truecolor|24bit` → barra en 24 bits; si no, aproximación a 256 colores;
  `ascii=true` o `TERM=dumb` → `#`/`-`; `NO_COLOR` mantiene los bloques y quita el color.
- **Terminales estrechas:** en vez de recortar, se eliminan segmentos por prioridad
  (`cwd` → velocidad → effort → subagente → caché → nombre → coste → cambios; después el contexto
  se encoge de barra → tokens+% → tokens; por último la rama) y la línea se redibuja al redimensionar.
  El modelo nunca se elimina.

## De dónde salen los números

| Valor | Fuente | Fiabilidad |
|---|---|---|
| modelo / effort / contexto / caché | eventos `model_request_start` / `model_request_end` (model/effort antes de la primera petición desde `~/.commandcode/config.json`; en una sesión reanudada, desde el transcript) | exacto tras una petición; el valor inicial es el del propio producto |
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
node test/statusline.test.mjs     # toda la suite: sin dependencias ni compilación
python3 scripts/gen-model-tables.py --check
```

Las pruebas importan `index.ts` directamente: Node 22.18+/24 elimina los tipos, así que no hay
toolchain. Apunta a otra copia con `STATUSLINE_MOD=/path/to/statusline.ts`. La CI ejecuta la misma
suite en Linux, macOS y Windows.

## Limitaciones conocidas

- **Sin segmento de créditos o cuota.** Otros mods leen la API de Command Code para ver créditos
  restantes y ventanas de 5 horas/semanales; este es deliberadamente local (sin red, sin `auth.json`).
- El coste de las peticiones nuevas se calcula con la tabla de precios incluida, no se relee del
  transcript, así que un cambio de precios requiere reejecutar `scripts/gen-model-tables.py`
  (tanto la semilla de reanudación como el cálculo por petición están cotejados con el producto).
- El nombre de sesión y la restauración de coste leen `~/.commandcode/projects/**`, y la semilla de
  modelo/effort al arrancar lee `~/.commandcode/config.json`: disposiciones no documentadas. Todo
  está envuelto para degradar a "falta el segmento", nunca a un fallo.
- **Sondeo en repositorios enormes.** La barra relee `git status` cada `refresh` segundos (10 por
  defecto). En repos pequeños esa llamada es gratis; en enormes no: sube `refresh` o ponlo a `0` y
  deja que lo hagan las actualizaciones por evento.

## Proyectos similares

Si buscas otro enfoque: [grknbyk/commandcode-statusline](https://github.com/grknbyk/commandcode-statusline)
(créditos, ventanas de uso, ritmo de gasto), [vikas-gits-good/cmd-statusline](https://github.com/vikas-gits-good/cmd-statusline)
(plantilla de diseño, gestión de terminal estrecha), [estifie/command-code-mod-session-stats](https://github.com/estifie/command-code-mod-session-stats)
(presión de contexto, aciertos de caché, gasto del transcript con subagentes).

## Licencia

MIT
