# cmdc-statusline

[English](README.md) | **简体中文** | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md)

[Command Code](https://commandcode.ai)（`cmd`，Windows 上为 `cmdc`）的状态栏 —— 模型、渐变上下文
进度条、缓存命中率、会话花费、输出速度、子代理用量、会话名与 git 状态，通过
`cmd.ui.setStatus()` 渲染在输入框下方。

![statusline: deepseek-v4.1-flash │ max │ ██████░░░░░░ 96k (47%) │ cache 99% │ $0.013 │ 42 tok/s │ sub 16k │ Simple Reply │ main ↑1 │ +1 ~2 ?1 │ my-project](docs/statusline.png)

**需要 Command Code ≥ 1.10.0。**

## 安装

```bash
cmd mods add cmdc-statusline -g
cmd mods list
```

其他装法：

- **走 git：** `cmd mods add holtwood/cmdc-statusline -g`
- **单文件投放：** 把 `index.ts` 放到 `~/.commandcode/mods/statusline.ts`（Windows 上为
  `%USERPROFILE%\.commandcode\mods\statusline.ts`）——无需构建
- **免安装试跑：** `cmd --mod ./index.ts`（mod 每进程只加载一次——改完用 `/reload` 生效）

Windows 上命令是 `cmdc`（`cmd` 是系统 shell）。装法挑一种——包与投放文件是两个 mod，
会声明同名 flag，而 flag 名是跨 mod 全局解析的。

### 交给 agent 安装

把下面这段贴给 agent：

> 帮我安装 Command Code 的 mod `cmdc-statusline`（用户级）：执行
> `cmd mods add cmdc-statusline -g`（Windows 上用 `cmdc`；若 npm 找不到该包，改用
> `holtwood/cmdc-statusline`），确认 `cmd mods list` 能列出，然后提醒我重启会话。

## 字段

| 字段 | 含义 |
|---|---|
| `deepseek-v4.1-flash` | 当前模型（`raw-model=true` 保留 vendor 前缀） |
| `max` | 上次请求的推理强度 |
| `█░░░ 32k (3.2%)` | 上次请求的上下文：渐变进度条（绿→红）、token 数、占模型窗口比例 |
| `cache 99%` | 上次请求的提示缓存命中率 |
| `$0.013` | 会话花费 —— 恢复时的历史累计 + 新增请求 |
| `42 tok/s` | 上次请求的输出速度（墙钟计时，含首 token 等待） |
| `sub 16k` | 本会话子代理消耗的 token |
| `Simple Reply` | 会话名（`/reload` 与恢复后仍在） |
| `main ↑1` | git 分支与 ahead/behind |
| `+1 ~2 ?1` | 已暂存 · 已修改 · 未跟踪（干净时显示 `clean`） |
| `my-project` | 当前目录名 |

## 配置

```
~/.commandcode/statusline.json          用户级
<项目>/.commandcode/statusline.json     项目级（覆盖用户级）
--mod-option <键>=<值>                   单次运行覆盖
```

```json
{"preset": "full", "bar-width": 12, "refresh": 10, "cache": true, "cost": true}
```

预设：`full`（默认，全部）· `minimal`（model、effort、context、bar、percent、git）·
`usage`（context、bar、percent、cache、cost、sub）。写在预设旁边的键会覆盖它。

| 键 | 默认 | 说明 |
|---|---|---|
| `model`、`effort`、`context` | `true` | 模型 / 推理强度 / 上次请求的上下文 |
| `bar`、`bar-width`、`percent` | `true`、`12`、`true` | 渐变进度条、格数、百分比 |
| `cache`、`cost`、`speed`、`sub` | `true` | 命中率 / 会话花费 / 输出速度 / 子代理 token |
| `name`、`git`、`cwd` | `true` | 会话名（24 字截断）/ 分支 + 改动数 / 目录名 |
| `preset` | `full` | `full` / `minimal` / `usage` |
| `raw-model`、`ascii` | `false` | 保留 vendor 前缀 / 纯 ASCII 渲染 |
| `refresh` | `10` | git 重读间隔秒数（`0` 关闭轮询） |

不碰 JSON 也能查和改，两条命令：

- `/statusline` —— 打印渲染行、原始数值、每个键的「键 / 默认 / 生效 / 来源」表，并对每条
  用不了的内容（未知键、类型错误、不认识的预设）单独告警。（报告文字为中文。）
- `/statusline config` —— 对话框式编辑（选作用域 → 键 → 值 → 确认），只写一个键并立刻
  重绘，不用 `/reload`。

注意：`--mod-option` 只在取值与内置默认不同时才算显式覆盖——显式传 `cwd=true` 压不过
写着 `false` 的配置文件。

## 工作原理

- **启动/恢复：** 首次请求前，模型与 effort 取自 `~/.commandcode/config.json`；恢复的会话
  还会从 transcript 还原上下文、缓存命中与花费。输出速度与子代理 token 必须等真实请求。
- **颜色：** `COLORTERM=truecolor|24bit` → 24-bit 渐变，否则 256 色近似；`ascii=true` 或
  `TERM=dumb` → `#`/`-`；`NO_COLOR` 保留块字符、去色。
- **窄终端：** 按优先级丢字段而不截断（cwd → 速度 → effort → 子代理 → 缓存 → 会话名 →
  花费 → 改动数 → 进度条收缩 → 分支）；模型永不丢。resize 时重绘。
- **数据来源：** 模型/effort/上下文/缓存来自请求事件；花费 = 恢复时的 transcript + 每次请求
  按价格表计算；子代理 token 来自 `subagent_stop`；git 走 `git status --porcelain=v1 -b`
  （5 秒下限 + `refresh` 间隔轮询）。
- **模型表：** 上下文窗口与价格由 CLI 自带模型目录**生成**——
  `python3 scripts/gen-model-tables.py` 重新生成，`--check` 检查漂移（CI 会跑）。表里没有的
  模型优雅降级（无进度条/无花费）。

## 贡献

欢迎提 issue 和 PR。

## 许可

MIT
