# cmdc-statusline

[English](README.md) | **简体中文** | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md)

> 本译文由 AI 辅助生成，若有歧义以 [英文版](README.md) 为准，欢迎提 PR 修正。

[Command Code](https://commandcode.ai)（`cmd`，Windows 上为 `cmdc`）的状态栏 —— 模型、渐变上下文
进度条、缓存命中率、会话花费、输出速度、子代理用量、session 名与 git 状态，全部渲染在输入框下方的
那一行。

```text
deepseek-v4.1-flash │ max │ █░░░░░░░░░░░ 32k (3.2%) │ cache 99% │ $0.013 │ 42 tok/s │ sub 16k │ Simple Reply │ main ↑1 │ +1 ~2 ?1 │ my-project
```

Command Code 没有 Claude Code 式的 `statusLine` 外部命令钩子——`cmd.ui.setStatus()`（mod 接口）
是唯一能在输入框下方渲染常驻行的方式，本 mod 就建立在它之上。

## 运行要求

**需要 Command Code ≥ 1.10.0**（`cmd`，Windows 上是 `cmdc`）。**旧版本不支持**：检测到旧宿主时本 mod
什么都不做——不注册任何东西、不画底栏，只在消息区留一条升级提示，然后自己停用。跑 `cmdc update`
后重开会话即可。这个下限不是猜的：1.10.0 之前 mod 接口上还没有 `cmd.ui.capabilities`（逐个比对过
npm 上每个 1.x 版本发布的包），mod 因此无法判断宿主到底渲不渲染底栏——它只会直接抛错，而不是降级。
`/statusline` 的报告里会打印它识别到的宿主版本，方便你对照。

## 安装

```bash
cmd mods add cmdc-statusline -g              # npm 安装（-g = 用户级；去掉 -g 则只装到当前项目）
cmd mods list                                # 应能列出本 mod
```

同一个包也可以直接走 git：`cmd mods add holtwood/cmdc-statusline -g`，不想依赖 registry 时可用。

也可以直接投放文件、不走包管理——把 `index.ts` 放到
`~/.commandcode/mods/statusline.ts`（Windows 上为 `%USERPROFILE%\.commandcode\mods\statusline.ts`）
再新开会话：

```bash
mkdir -p ~/.commandcode/mods && curl -o ~/.commandcode/mods/statusline.ts \
  https://raw.githubusercontent.com/holtwood/cmdc-statusline/main/index.ts
```

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.commandcode\mods" | Out-Null
Invoke-WebRequest -OutFile "$env:USERPROFILE\.commandcode\mods\statusline.ts" `
  https://raw.githubusercontent.com/holtwood/cmdc-statusline/main/index.ts
```

两种装法挑一种，别都装：包与投放文件是两个独立的 mod，会声明同名 flag —— Command Code 的 flag 名是
跨 mod 全局解析的。

> Windows 上命令是 `cmdc`（`cmd` 是系统 shell）——即 `cmdc mods add …`、`cmdc mods list`、`cmdc --mod .\index.ts`。

免安装试跑：`cmd --mod ./index.ts`。mod 每进程只加载一次——改完用 `/reload` 或新开会话。无需构建步骤：
Command Code 在加载时直接编译 TypeScript。

### 交给 AI 代装

不想自己敲命令的话，把下面这段贴给 agent（Claude Code、Codex、Command Code 等）：

> 帮我安装 Command Code 的 mod `cmdc-statusline`（用户级）：执行
> `cmd mods add cmdc-statusline -g`（Windows 上用 `cmdc` 代替 `cmd`；若 npm 找不到该包，改用
> `holtwood/cmdc-statusline`），然后确认 `cmd mods list` 中 `cmdc-statusline` 显示为用户级且没有加载
> 警告。最后提醒我重启会话，好让底栏渲染出来。

不需要 root，只会写入 `~/.commandcode/mods/` 与 `~/.commandcode/settings.json` 里的 `mods.sources`。

## 段位

| 段位 | 含义 |
|---|---|
| `deepseek-v4.1-flash` | 当前模型（取自请求本身；`raw-model=true` 保留 vendor 前缀） |
| `max` | 上次请求的推理强度 |
| `█░░░ 32k (3.2%)` | 上次请求的上下文：渐变进度条（按格位绿→黄→红）、token 数、占模型窗口比例 |
| `cache 99%` | 上次请求的提示缓存命中率（缓存读 ÷ 输入） |
| `$0.013` | 会话花费 —— 恢复会话时的历史累计 + 本进程新增 |
| `42 tok/s` | 上次请求的输出速度（墙钟计时，含首 token 等待） |
| `sub 16k` | 本会话子代理（`agent` 工具）消耗的 token |
| `Simple Reply` | session 名（`/reload` 与恢复会话后仍在） |
| `main ↑1` | git 分支与 ahead/behind |
| `+1 ~2 ?1` | 已暂存 · 已修改 · 未跟踪（干净时显示 `clean`） |
| `my-project` | 当前目录名 |

## 配置

配置写在 JSON 里；命令行可按次覆盖。

```
~/.commandcode/statusline.json          用户级
<项目>/.commandcode/statusline.json     项目级（覆盖用户级）
--mod-option <name>=<value>             单次运行覆盖
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

`preset` 给一组现成的段位，省得你一个个列键：

| `preset` | 打开的段位 |
|---|---|
| `full`（默认） | 全部 |
| `minimal` | `model` `effort` `context` `bar` `percent` `git` |
| `usage` | `context` `bar` `percent` `cache` `cost` `sub` |

预设只决定「哪些段位开」。写在它旁边的键会覆盖它（`{"preset": "minimal", "cost": true}` 仍会显示花费），
渲染开关（`ascii`、`raw-model`）与它无关。预设名不认识会被点名，并按 `full` 处理。

| 键 | 默认 | 说明 |
|---|---|---|
| `model`、`effort`、`context` | `true` | 模型 / 推理强度 / 上次请求的上下文 |
| `bar`、`bar-width`、`percent` | `true`、`12`、`true` | 渐变进度条、格数、百分比 |
| `cache` | `true` | 缓存命中率 |
| `cost` | `true` | 会话花费 |
| `speed` | `true` | 输出速度 |
| `sub` | `true` | 子代理 token |
| `name` | `true` | session 名（超过 24 字截断） |
| `git` | `true` | 分支 + 改动数 |
| `cwd` | `true` | 目录名 |
| `preset` | `full` | `full` / `minimal` / `usage` |
| `raw-model` | `false` | 模型 id 保留 vendor 前缀 |
| `ascii` | `false` | 强制纯 ASCII 渲染 |
| `refresh` | `10` | 重新读取 git 的间隔秒数（0 = 关闭定时器） |

### 看见真正生效的是什么

`/statusline` 会打印渲染出的那一行、它背后的原始数值，以及每个键的「键 / 默认 / 生效 / 来源」全表；
再列出读到的配置文件，并把每一条用不了的东西单独点名：不认识的键（通常是拼错）、形状不对的取值、
认不出的预设。被拒的取值会回退到默认并说明原因，而不是半生效、让你猜为什么改了没用。

### 不改 JSON 也能改

`/statusline config` 用 Command Code 的对话框（`cmd.ui.select` / `input` / `confirm`）做同一件事：
选作用域（用户级 / 项目级）→ 选键 → 选值 → 确认。它只重写那一个键，文件里其余内容（包括本 mod
不认识的键）原样保留，然后重新读取并**立刻重绘**底栏，不用 `/reload`。没有对话框桥接的运行
（headless）只打印报告、不写文件；确认时选“否”同样不写。要是写进去的值被更高优先级的东西（项目级文件、
`--mod-option`）压住、底栏根本不会变，流程会直接说出来，而不是让你拿着一个「提示已写入、界面毫无变化」发呆。

（`/statusline` 自身的输出文字是中文。）

**优先级说明：** Command Code 会把 `--mod-option` 的**值**从 mod 能看到的 argv 里抹掉，
因此只有当取值**与内置默认不同**时才判定为显式覆盖。显式传默认值（如 `--mod-option cwd=true`）
压不过配置文件。

## 渲染

- **启动时。** 绝大多数段位描述的是**上一次模型请求**，刚开的会话还没有——所以底栏先把当下能确定的
  画出来，而不是干等第一次 `model_request_end`：模型与推理强度取自 `~/.commandcode/config.json`，
  加上 session 名、git 状态与目录名。**恢复**会话还会从 transcript 还原上一轮请求的模型、effort、
  上下文、缓存命中与花费，于是打开就是上次离开时的完整一行。真正要等到请求发生过的只有输出速度与
  子代理 token（产品两者都不持久化）。
- `COLORTERM=truecolor|24bit` → 24-bit 真彩渐变条；否则用 256 色近似；
  `ascii=true` 或 `TERM=dumb` → `#`/`-`；`NO_COLOR` 保留块字符但去色。
- **窄终端不截断**：按优先级丢段位（`cwd` → 速度 → effort → 子代理 → 缓存 → session 名 →
  花费 → 改动数，之后上下文按 条 → token+% → token 收缩，再丢分支），并在 resize 时立即重绘。
  模型永不丢。

## 数字从哪来

| 值 | 来源 | 可信度 |
|---|---|---|
| 模型 / effort / 上下文 / 缓存 | `model_request_start` / `model_request_end` 事件载荷（首次请求前 model/effort 取自 `~/.commandcode/config.json`，恢复时取自 transcript） | 请求跑过后精确；种子值即产品自己的值 |
| 会话花费 | 恢复时读 `<sessionId>.jsonl` 的 `costUsd` + 每次请求按内置单价表计算 | 恢复部分是产品自己的数字；新增部分逐条复现产品口径（已对录入的 `costUsd` 全量核对） |
| 子代理 token | `subagent_stop` 事件 | token 精确；子代理花费**不**计入花费段（产品自身也不落盘） |
| session 名 | `session_titled` 事件 + 启动时读 `<sessionId>.meta.json` | 尽力而为——该文件布局未文档化，读取包在 `try` 里 |
| 分支 / 改动数 | `cmd.exec` 跑 `git status --porcelain=v1 -b` | 精确，5 秒缓存 |

上下文窗口表与单价表是**生成**的（不是手写），来源是 CLI 随包发布的模型目录：

```bash
python3 scripts/gen-model-tables.py           # CLI 升级后重新生成
python3 scripts/gen-model-tables.py --check   # 表已漂移则失败（CI 会跑）
```

模型不在表里也能优雅降级：没有窗口就不显示进度条/百分比，没有单价就不显示花费。

## 开发

```bash
node test/statusline.test.mjs     # 整套测试：零依赖、无需构建
python3 scripts/gen-model-tables.py --check
```

测试直接导入 `index.ts` —— Node 22.18+/24 原生擦除类型，无需任何工具链。
用 `STATUSLINE_MOD=/path/to/statusline.ts` 可改为测另一份副本。CI 在 Linux、macOS 与 Windows 上
跑同一套测试。

## 已知限制

- **没有额度/配额段位。** 同类 mod 会读 Command Code API 拿剩余额度与 5 小时/每周窗口；
  本 mod 刻意只读本地（不联网、不碰 `auth.json`）。
- 新请求的花费是**按随包价格表算的**，不是从 transcript 读回来的，所以价格变动需要重跑
  `scripts/gen-model-tables.py`（恢复种子与每次请求的算法都已对过产品自己的数字）。
- session 名、花费恢复需要读 `~/.commandcode/projects/**`，启动时的模型/effort 种子要读
  `~/.commandcode/config.json` —— 都是未文档化的布局。所有读取都做了兜底：
  布局变了只会「少一个段位」，不会崩。
- **超大仓库里的轮询。** 底栏每 `refresh` 秒重读一次 `git status`（默认 10 秒）。这次调用在小仓库里
  是白送的，超大仓库不是——把 `refresh` 调大或设为 `0`，交给事件驱动的刷新。

## 同类项目

想换个口味可以看看：[grknbyk/commandcode-statusline](https://github.com/grknbyk/commandcode-statusline)
（额度、用量窗口、花费节奏）、[vikas-gits-good/cmd-statusline](https://github.com/vikas-gits-good/cmd-statusline)
（模板化布局、窄终端优先级处理）、[estifie/command-code-mod-session-stats](https://github.com/estifie/command-code-mod-session-stats)
（上下文压力、缓存命中率、读 transcript 的花费并折算子代理）。

## 许可

MIT
