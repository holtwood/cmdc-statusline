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
| `raw-model` | `false` | 模型 id 保留 vendor 前缀 |
| `ascii` | `false` | 强制纯 ASCII 渲染 |
| `refresh` | `10` | 重新读取 git 的间隔秒数（0 = 关闭定时器） |

**优先级说明：** Command Code 会把 `--mod-option` 的**值**从 mod 能看到的 argv 里抹掉，
因此只有当取值**与内置默认不同**时才判定为显式覆盖。显式传默认值（如 `--mod-option cwd=true`）
压不过配置文件。

## 渲染

- `COLORTERM=truecolor|24bit` → 24-bit 真彩渐变条；否则用 256 色近似；
  `ascii=true` 或 `TERM=dumb` → `#`/`-`；`NO_COLOR` 保留块字符但去色。
- **窄终端不截断**：按优先级丢段位（`cwd` → 速度 → effort → 子代理 → 缓存 → session 名 →
  花费 → 改动数，之后上下文按 条 → token+% → token 收缩，再丢分支），并在 resize 时立即重绘。
  模型永不丢。

## 数字从哪来

| 值 | 来源 | 可信度 |
|---|---|---|
| 模型 / effort / 上下文 / 缓存 | `model_request_start` / `model_request_end` 事件载荷 | 精确 |
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
- session 名与花费恢复需要读 `~/.commandcode/projects/**` —— 未文档化的布局。所有读取都做了兜底：
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
