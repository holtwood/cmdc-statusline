# cmdc-statusline

[English](#english) · [简体中文](#简体中文) · [繁體中文](#繁體中文) · [日本語](#日本語) · [한국어](#한국어) · [Español](#español) · [Français](#français) · [Deutsch](#deutsch) · [Русский](#русский)

---

## English

A status line for [Command Code](https://commandcode.ai) (`cmd`, `cmdc` on Windows — either
works in WSL) — model, gradient context bar, cache hit rate, session cost, output speed,
sub-agent usage, session name and git state, rendered under the input panel via
`cmd.ui.setStatus()`.

![statusline: deepseek-v4.1-flash │ max │ ██████░░░░░░ 96k (47%) │ cache 99% │ $0.013 │ 42 tok/s │ sub 16k │ Simple Reply │ main ↑1 │ +1 ~2 ?1 │ my-project](docs/statusline.png)

**Requires Command Code ≥ 1.10.0.**

### Install

```bash
cmd mods add cmdc-statusline -g
cmd mods list
```

Alternatives:

- **From git:** `cmd mods add holtwood/cmdc-statusline -g`
- **Single file:** copy `index.ts` to `~/.commandcode/mods/statusline.ts`
  (`%USERPROFILE%\.commandcode\mods\statusline.ts` on Windows) — no build step
- **Try without installing:** `cmd --mod ./index.ts` (mods load once per process — use
  `/reload` to pick up changes)

On Windows the binary is `cmdc` (`cmd` is the Windows shell); in WSL both `cmd` and `cmdc`
work. Pick one install path — the package and the drop-in file are two mods that declare the
same flag names, which Command Code resolves globally.

#### Install with your agent

Paste this into your agent:

> Install the Command Code mod `cmdc-statusline` at user scope: run
> `cmd mods add cmdc-statusline -g` (`cmdc` on Windows, `cmd` or `cmdc` in WSL; if npm
> can't find it, use `holtwood/cmdc-statusline`), confirm `cmd mods list` shows it, then
> tell me to restart the session.

### Segments

| Segment | Meaning |
|---|---|
| `deepseek-v4.1-flash` | Active model (`raw-model=true` keeps the vendor prefix) |
| `max` | Reasoning effort of the last request |
| `█░░░ 32k (3.2%)` | Context of the last request: gradient bar (green→red), tokens, share of the model's window |
| `cache 99%` | Prompt-cache hit rate of the last request |
| `$0.013` | Session cost — transcript on resume + new requests |
| `42 tok/s` | Output speed of the last request (wall clock, incl. TTFT) |
| `sub 16k` | Tokens burned by sub-agents this session |
| `Simple Reply` | Session name (survives `/reload` and resume) |
| `main ↑1` | Git branch with ahead/behind |
| `+1 ~2 ?1` | staged · modified · untracked (`clean` when empty) |
| `my-project` | Current directory basename |

### Configuration

```
~/.commandcode/statusline.json          user scope
<project>/.commandcode/statusline.json  project scope (overrides user)
--mod-option <key>=<value>              per-run override
```

```json
{"preset": "full", "bar-width": 12, "refresh": 10, "cache": true, "cost": true}
```

Presets: `full` (default, everything) · `minimal` (model, effort, context, bar, percent,
git) · `usage` (context, bar, percent, cache, cost, sub). A key set next to a preset
overrides it.

| Key | Default | Notes |
|---|---|---|
| `model`, `effort`, `context` | `true` | model / reasoning effort / context of the last request |
| `bar`, `bar-width`, `percent` | `true`, `12`, `true` | gradient bar, width in cells, percentage |
| `cache`, `cost`, `speed`, `sub` | `true` | hit rate / session cost / output speed / sub-agent tokens |
| `name`, `git`, `cwd` | `true` | session name (24-char max) / branch + changes / dir basename |
| `preset` | `full` | `full` / `minimal` / `usage` |
| `raw-model`, `ascii` | `false` | keep vendor prefix / plain ASCII rendering |
| `refresh` | `10` | seconds between git re-reads (`0` disables polling) |
| `lang` | `zh` | `zh` / `en` — language of the report and the config dialogs |

Two commands inspect and change this without touching JSON:

- `/statusline` — rendered line, raw values, a `key / default / effective / source` table,
  and a warning for each unusable entry (unknown keys, wrong types, bad presets). The
  report text is Chinese by default; `lang=en` switches it to English.
- `/statusline config` — interactive editor (pick scope → key → value → confirm); writes
  one key and repaints immediately, no `/reload`.

Caveat: `--mod-option` only counts as an override when the value differs from the built-in
default — passing `cwd=true` explicitly won't beat a config file saying `false`.

### How it works

- **Startup/resume:** before the first request, model and effort seed from
  `~/.commandcode/config.json`; a resumed session also restores context, cache rate and
  cost from the transcript. Speed and sub-agent tokens need a live request.
- **Colours:** `COLORTERM=truecolor|24bit` → 24-bit gradient, else 256-colour;
  `ascii=true` or `TERM=dumb` → `#`/`-`; `NO_COLOR` keeps blocks, drops colour.
- **Narrow terminals:** low-priority segments are dropped instead of clipped
  (cwd → speed → effort → sub → cache → name → cost → changes → bar shrinks → branch);
  the model is never dropped. Re-renders on resize.
- **Sources:** model/effort/context/cache from request events; cost = transcript on resume
  + per-request usage priced with a generated table; sub-agent tokens from `subagent_stop`;
  git from `git status --porcelain=v1 -b` (5s floor + `refresh` interval).
- **Model tables:** context windows and prices are generated from the CLI's own catalogue,
  not handwritten — `python3 scripts/gen-model-tables.py` to regenerate, `--check` to
  detect drift (CI runs it). A missing model degrades gracefully (no bar / no cost).

### Contributing

Issues and pull requests are welcome.

### License

MIT

---

## 简体中文

[Command Code](https://commandcode.ai)（`cmd`，Windows 上为 `cmdc`；WSL 中两者皆可用）的状态栏 —— 模型、渐变上下文
进度条、缓存命中率、会话花费、输出速度、子代理用量、会话名与 git 状态，通过
`cmd.ui.setStatus()` 渲染在输入框下方。

**需要 Command Code ≥ 1.10.0。**

### 安装

```bash
cmd mods add cmdc-statusline -g
cmd mods list
```

其他装法：

- **走 git：** `cmd mods add holtwood/cmdc-statusline -g`
- **单文件投放：** 把 `index.ts` 放到 `~/.commandcode/mods/statusline.ts`（Windows 上为
  `%USERPROFILE%\.commandcode\mods\statusline.ts`）——无需构建
- **免安装试跑：** `cmd --mod ./index.ts`（mod 每进程只加载一次——改完用 `/reload` 生效）

Windows 上命令是 `cmdc`（`cmd` 是系统 shell）；WSL 中 `cmd` 与 `cmdc` 都可用。装法挑一种——
包与投放文件是两个 mod，会声明同名 flag，而 flag 名是跨 mod 全局解析的。

#### 交给 agent 安装

把下面这段贴给 agent：

> 帮我安装 Command Code 的 mod `cmdc-statusline`（用户级）：执行
> `cmd mods add cmdc-statusline -g`（Windows 上用 `cmdc`，WSL 中 `cmd`/`cmdc` 均可；若 npm
> 找不到该包，改用 `holtwood/cmdc-statusline`），确认 `cmd mods list` 能列出，然后提醒我重启会话。

### 字段

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

### 配置

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
| `lang` | `zh` | 报告与弹窗的语言：`zh` / `en` |

不碰 JSON 也能查和改，两条命令：

- `/statusline` —— 打印渲染行、原始数值、每个键的「键 / 默认 / 生效 / 来源」表，并对每条
  用不了的内容（未知键、类型错误、不认识的预设）单独告警。（报告文字默认中文，`lang=en` 切英文。）
- `/statusline config` —— 对话框式编辑（选作用域 → 键 → 值 → 确认），只写一个键并立刻
  重绘，不用 `/reload`。

注意：`--mod-option` 只在取值与内置默认不同时才算显式覆盖——显式传 `cwd=true` 压不过
写着 `false` 的配置文件。

### 工作原理

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

### 贡献

欢迎提 issue 和 PR。

### 许可

MIT

---

## 繁體中文

[Command Code](https://commandcode.ai)（`cmd`，Windows 上為 `cmdc`；WSL 中兩者皆可用）的狀態列 —— 模型、漸層上下文
進度條、快取命中率、工作階段花費、輸出速度、子代理用量、工作階段名稱與 git 狀態，透過
`cmd.ui.setStatus()` 渲染在輸入框下方。

**需要 Command Code ≥ 1.10.0。**

### 安裝

```bash
cmd mods add cmdc-statusline -g
cmd mods list
```

其他裝法：

- **走 git：** `cmd mods add holtwood/cmdc-statusline -g`
- **單檔投放：** 把 `index.ts` 放到 `~/.commandcode/mods/statusline.ts`（Windows 上為
  `%USERPROFILE%\.commandcode\mods\statusline.ts`）——無需建置
- **免安裝試跑：** `cmd --mod ./index.ts`（mod 每行程只載入一次——改完用 `/reload` 生效）

Windows 上命令是 `cmdc`（`cmd` 是系統 shell）；WSL 中 `cmd` 與 `cmdc` 都可用。裝法挑一種——
套件與投放檔是兩個 mod，會宣告同名 flag，而 flag 名是跨 mod 全域解析的。

#### 交給 agent 安裝

把下面這段貼給 agent：

> 幫我安裝 Command Code 的 mod `cmdc-statusline`（使用者級）：執行
> `cmd mods add cmdc-statusline -g`（Windows 上用 `cmdc`，WSL 中 `cmd`/`cmdc` 均可；若 npm
> 找不到該套件，改用 `holtwood/cmdc-statusline`），確認 `cmd mods list` 能列出，然後提醒我重開工作階段。

### 欄位

| 欄位 | 含義 |
|---|---|
| `deepseek-v4.1-flash` | 目前模型（`raw-model=true` 保留 vendor 前綴） |
| `max` | 上次請求的推理強度 |
| `█░░░ 32k (3.2%)` | 上次請求的上下文：漸層進度條（綠→紅）、token 數、佔模型視窗比例 |
| `cache 99%` | 上次請求的提示快取命中率 |
| `$0.013` | 工作階段花費 —— 恢復時的歷史累計 + 新增請求 |
| `42 tok/s` | 上次請求的輸出速度（牆鐘計時，含首 token 等待） |
| `sub 16k` | 本工作階段子代理消耗的 token |
| `Simple Reply` | 工作階段名稱（`/reload` 與恢復後仍在） |
| `main ↑1` | git 分支與 ahead/behind |
| `+1 ~2 ?1` | 已暫存 · 已修改 · 未追蹤（乾淨時顯示 `clean`） |
| `my-project` | 目前目錄名稱 |

### 設定

```
~/.commandcode/statusline.json          使用者級
<專案>/.commandcode/statusline.json     專案級（覆蓋使用者級）
--mod-option <鍵>=<值>                   單次執行覆蓋
```

```json
{"preset": "full", "bar-width": 12, "refresh": 10, "cache": true, "cost": true}
```

預設組合：`full`（預設，全部）· `minimal`（model、effort、context、bar、percent、git）·
`usage`（context、bar、percent、cache、cost、sub）。寫在預設組合旁邊的鍵會覆蓋它。

| 鍵 | 預設 | 說明 |
|---|---|---|
| `model`、`effort`、`context` | `true` | 模型 / 推理強度 / 上次請求的上下文 |
| `bar`、`bar-width`、`percent` | `true`、`12`、`true` | 漸層進度條、格數、百分比 |
| `cache`、`cost`、`speed`、`sub` | `true` | 命中率 / 工作階段花費 / 輸出速度 / 子代理 token |
| `name`、`git`、`cwd` | `true` | 工作階段名稱（24 字截斷）/ 分支 + 變更數 / 目錄名稱 |
| `preset` | `full` | `full` / `minimal` / `usage` |
| `raw-model`、`ascii` | `false` | 保留 vendor 前綴 / 純 ASCII 渲染 |
| `refresh` | `10` | git 重讀間隔秒數（`0` 關閉輪詢） |
| `lang` | `zh` | 報告與彈窗的語言：`zh` / `en` |

不碰 JSON 也能查和改，兩條命令：

- `/statusline` —— 印出渲染行、原始數值、每個鍵的「鍵 / 預設 / 生效 / 來源」表，並對每條
  用不了的內容（未知鍵、型別錯誤、不認識的預設）單獨告警。（報告文字預設中文，`lang=en` 切英文。）
- `/statusline config` —— 對話框式編輯（選作用域 → 鍵 → 值 → 確認），只寫一個鍵並立刻
  重繪，不用 `/reload`。

注意：`--mod-option` 只在取值與內建預設不同時才算顯式覆蓋——顯式傳 `cwd=true` 壓不過
寫著 `false` 的設定檔。

### 運作原理

- **啟動/恢復：** 首次請求前，模型與 effort 取自 `~/.commandcode/config.json`；恢復的工作階段
  還會從 transcript 還原上下文、快取命中與花費。輸出速度與子代理 token 必須等真實請求。
- **顏色：** `COLORTERM=truecolor|24bit` → 24-bit 漸層，否則 256 色近似；`ascii=true` 或
  `TERM=dumb` → `#`/`-`；`NO_COLOR` 保留塊字符、去色。
- **窄終端：** 按優先順序丟欄位而不截斷（cwd → 速度 → effort → 子代理 → 快取 → 名稱 →
  花費 → 變更數 → 進度條收縮 → 分支）；模型永不丟。resize 時重繪。
- **資料來源：** 模型/effort/上下文/快取來自請求事件；花費 = 恢復時的 transcript + 每次請求
  按價格表計算；子代理 token 來自 `subagent_stop`；git 走 `git status --porcelain=v1 -b`
  （5 秒下限 + `refresh` 間隔輪詢）。
- **模型表：** 上下文視窗與價格由 CLI 自帶模型目錄**產生**——
  `python3 scripts/gen-model-tables.py` 重新產生，`--check` 檢查漂移（CI 會跑）。表裡沒有的
  模型優雅降級（無進度條/無花費）。

### 貢獻

歡迎送 issue 和 PR。

### 授權

MIT

---

## 日本語

[Command Code](https://commandcode.ai)（`cmd`、Windows では `cmdc`、WSL ではどちらも使える）のステータスライン — モデル、
グラデーション付きコンテキストバー、キャッシュヒット率、セッション費用、出力速度、サブエージェント
使用量、セッション名、git の状態を `cmd.ui.setStatus()` で入力欄の下に表示します。

**Command Code ≥ 1.10.0 が必要。**

### インストール

```bash
cmd mods add cmdc-statusline -g
cmd mods list
```

ほかの方法：

- **git から:** `cmd mods add holtwood/cmdc-statusline -g`
- **単一ファイル:** `index.ts` を `~/.commandcode/mods/statusline.ts` に置く
  （Windows では `%USERPROFILE%\.commandcode\mods\statusline.ts`）——ビルド不要
- **試すだけ:** `cmd --mod ./index.ts`（mod は 1 プロセスにつき 1 回だけ読み込まれます。
  変更後は `/reload` で反映）

Windows ではコマンドは `cmdc` です（`cmd` は Windows のシェル）。WSL では `cmd` と `cmdc` のどちらも使えます。導入方法はどれか 1 つに——
パッケージと直接配置は別々の mod で同じ flag 名を宣言し、flag 名は mod をまたいでグローバルに
解決されます。

#### エージェントに任せる

次を貼ってください:

> Command Code の mod `cmdc-statusline` をユーザースコープでインストールして:
> `cmd mods add cmdc-statusline -g` を実行（Windows では `cmdc`、WSL では `cmd`/`cmdc` どちらでも可。npm に無ければ
> `holtwood/cmdc-statusline` を使う）。`cmd mods list` に出ることを確認したら、セッションを
> 再起動するよう伝えて。

### セグメント

| セグメント | 意味 |
|---|---|
| `deepseek-v4.1-flash` | 現在のモデル（`raw-model=true` でベンダー接頭辞を保持） |
| `max` | 直前のリクエストの推論エフォート |
| `█░░░ 32k (3.2%)` | 直前のリクエストのコンテキスト：グラデーションバー（緑→赤）、トークン数、ウィンドウ占有率 |
| `cache 99%` | 直前のリクエストのプロンプトキャッシュヒット率 |
| `$0.013` | セッション費用 — 再開時の累計 + 新規リクエスト分 |
| `42 tok/s` | 直前のリクエストの出力速度（実時間計測、初トークン待ちを含む） |
| `sub 16k` | このセッションでサブエージェントが消費したトークン |
| `Simple Reply` | セッション名（`/reload` や再開後も保持） |
| `main ↑1` | git ブランチと ahead/behind |
| `+1 ~2 ?1` | ステージ済み · 変更 · 未追跡（クリーンなら `clean`） |
| `my-project` | 現在のディレクトリ名 |

### 設定

```
~/.commandcode/statusline.json          ユーザースコープ
<プロジェクト>/.commandcode/statusline.json  プロジェクトスコープ（ユーザーを上書き）
--mod-option <キー>=<値>                 実行ごとの上書き
```

```json
{"preset": "full", "bar-width": 12, "refresh": 10, "cache": true, "cost": true}
```

プリセット: `full`（既定、すべて）· `minimal`（model, effort, context, bar, percent, git）·
`usage`（context, bar, percent, cache, cost, sub）。プリセットと並べて書いたキーはそれを上書き
します。

| キー | 既定 | 説明 |
|---|---|---|
| `model`, `effort`, `context` | `true` | モデル / 推論エフォート / 直前のリクエストのコンテキスト |
| `bar`, `bar-width`, `percent` | `true`, `12`, `true` | グラデーションバー、セル数、割合 |
| `cache`, `cost`, `speed`, `sub` | `true` | ヒット率 / セッション費用 / 出力速度 / サブエージェントのトークン |
| `name`, `git`, `cwd` | `true` | セッション名（24 文字で切り詰め）/ ブランチ + 変更数 / ディレクトリ名 |
| `preset` | `full` | `full` / `minimal` / `usage` |
| `raw-model`, `ascii` | `false` | ベンダー接頭辞を保持 / 素の ASCII 描画 |
| `refresh` | `10` | git を再読み込みする間隔（秒）（`0` でポーリング停止） |
| `lang` | `zh` | `zh` / `en` — レポートとダイアログの言語 |

JSON を触らずに確認・変更できるコマンドが 2 つあります:

- `/statusline` — 描画行、元の値、全キーの「キー / 既定 / 有効 / 出どころ」表に加え、使えなかった
  項目（未知のキー、型違い、不明なプリセット）を 1 件ずつ警告します。（レポート文は既定で中国語。`lang=en` で英語に切り替わります。）
- `/statusline config` — ダイアログ式の編集（スコープ → キー → 値 → 確認）。1 キーだけ書き込み、
  `/reload` なしで即座に再描画します。

注意: `--mod-option` は値が組み込み既定と異なる場合にだけ明示的な上書きと見なされます——
`cwd=true` を明示しても `false` と書かれた設定ファイルには勝てません。

### 仕組み

- **起動/再開:** 最初のリクエスト前はモデルとエフォートを `~/.commandcode/config.json` から
  取得。再開セッションは transcript からコンテキスト・キャッシュ率・費用も復元します。出力速度と
  サブエージェントのトークンだけは実際のリクエストが必要です。
- **色:** `COLORTERM=truecolor|24bit` → 24-bit グラデーション、それ以外は 256 色近似。
  `ascii=true` または `TERM=dumb` → `#`/`-`。`NO_COLOR` はブロック文字を残して色だけ消します。
- **狭い端末:** 切り詰めずに優先度の低いセグメントから落とします（cwd → 速度 → effort →
  サブエージェント → キャッシュ → 名前 → 費用 → 変更数 → バー縮小 → ブランチ）。モデルは
  落としません。リサイズで再描画。
- **出どころ:** モデル/エフォート/コンテキスト/キャッシュはリクエストイベントから。費用 =
  再開時の transcript + 生成済み価格表によるリクエストごとの課金。サブエージェントのトークンは
  `subagent_stop` から。git は `git status --porcelain=v1 -b`（5 秒の下限 + `refresh` 間隔）。
- **モデル表:** コンテキストウィンドウと価格は CLI 同梱のモデルカタログから**生成**されます——
  `python3 scripts/gen-model-tables.py` で再生成、`--check` でドリフト検出（CI が実行）。
  表に無いモデルは穏やかに縮退します（バー無し / 費用無し）。

### コントリビュート

issue と PR を歓迎します。

### ライセンス

MIT

---

## 한국어

[Command Code](https://commandcode.ai)(`cmd`, Windows에서는 `cmdc`, WSL에서는 둘 다 사용 가능)용 상태 표시줄 — 모델,
그라데이션 컨텍스트 바, 캐시 적중률, 세션 비용, 출력 속도, 서브에이전트 사용량, 세션 이름,
git 상태를 `cmd.ui.setStatus()`로 입력창 아래에 표시합니다.

**Command Code ≥ 1.10.0 필요.**

### 설치

```bash
cmd mods add cmdc-statusline -g
cmd mods list
```

다른 방법:

- **git에서:** `cmd mods add holtwood/cmdc-statusline -g`
- **단일 파일:** `index.ts`를 `~/.commandcode/mods/statusline.ts`에 복사
  (Windows에서는 `%USERPROFILE%\.commandcode\mods\statusline.ts`) — 빌드 불필요
- **설치 없이 시험:** `cmd --mod ./index.ts` (mod는 프로세스당 한 번만 로드됩니다.
  변경 후에는 `/reload`로 반영)

Windows에서는 바이너리가 `cmdc`입니다(`cmd`는 Windows 셸). WSL에서는 `cmd`와 `cmdc` 둘 다 쓸 수 있습니다. 설치 방법은 하나만 고르세요 —
패키지와 직접 배치 파일은 같은 flag 이름을 선언하는 두 개의 mod이며, flag 이름은 mod 전역으로
해석됩니다.

#### 에이전트에게 맡기기

다음을 붙여 넣으세요:

> Command Code mod `cmdc-statusline`을 사용자 범위로 설치해 줘: `cmd mods add cmdc-statusline -g`
> 실행(Windows에서는 `cmdc`, WSL에서는 `cmd`/`cmdc` 모두 가능. npm에 없으면 `holtwood/cmdc-statusline` 사용). `cmd mods list`에
> 뜨는지 확인한 다음 세션을 재시작하라고 알려 줘.

### 세그먼트

| 세그먼트 | 의미 |
|---|---|
| `deepseek-v4.1-flash` | 현재 모델(`raw-model=true`면 벤더 접두사 유지) |
| `max` | 마지막 요청의 추론 강도 |
| `█░░░ 32k (3.2%)` | 마지막 요청의 컨텍스트: 그라데이션 바(초록→빨강), 토큰 수, 윈도우 비율 |
| `cache 99%` | 마지막 요청의 프롬프트 캐시 적중률 |
| `$0.013` | 세션 비용 — 재개 시 누적분 + 새 요청분 |
| `42 tok/s` | 마지막 요청의 출력 속도(실시간 측정, 첫 토큰 대기 포함) |
| `sub 16k` | 이 세션에서 서브에이전트가 쓴 토큰 |
| `Simple Reply` | 세션 이름(`/reload`와 재개 후에도 유지) |
| `main ↑1` | git 브랜치와 ahead/behind |
| `+1 ~2 ?1` | 스테이지 · 수정 · 추적 안 됨(깨끗하면 `clean`) |
| `my-project` | 현재 디렉터리 이름 |

### 설정

```
~/.commandcode/statusline.json          사용자 범위
<프로젝트>/.commandcode/statusline.json  프로젝트 범위(사용자보다 우선)
--mod-option <키>=<값>                   실행 단위 재정의
```

```json
{"preset": "full", "bar-width": 12, "refresh": 10, "cache": true, "cost": true}
```

프리셋: `full`(기본, 전부) · `minimal`(model, effort, context, bar, percent, git) ·
`usage`(context, bar, percent, cache, cost, sub). 프리셋 옆에 쓴 키는 프리셋을 덮어씁니다.

| 키 | 기본값 | 설명 |
|---|---|---|
| `model`, `effort`, `context` | `true` | 모델 / 추론 강도 / 마지막 요청의 컨텍스트 |
| `bar`, `bar-width`, `percent` | `true`, `12`, `true` | 그라데이션 바, 칸 수, 백분율 |
| `cache`, `cost`, `speed`, `sub` | `true` | 적중률 / 세션 비용 / 출력 속도 / 서브에이전트 토큰 |
| `name`, `git`, `cwd` | `true` | 세션 이름(24자에서 자름) / 브랜치 + 변경 수 / 디렉터리 이름 |
| `preset` | `full` | `full` / `minimal` / `usage` |
| `raw-model`, `ascii` | `false` | 벤더 접두사 유지 / 순수 ASCII 렌더링 |
| `refresh` | `10` | git 다시 읽기 간격(초)(`0`이면 폴링 끔) |
| `lang` | `zh` | `zh` / `en` — 리포트와 대화 상자의 언어 |

JSON을 만지지 않고 확인·변경하는 명령 두 개:

- `/statusline` — 렌더링된 줄, 원시 값, 모든 키의 `키 / 기본값 / 적용 / 출처` 표와 함께 쓸 수 없는
  항목(알 수 없는 키, 잘못된 타입, 잘못된 프리셋)을 하나씩 경고합니다. (리포트는 기본 중국어이며 `lang=en`이면 영어로 바뀝니다.)
- `/statusline config` — 대화 상자 편집기(범위 → 키 → 값 → 확인). 키 하나만 쓰고 `/reload` 없이
  즉시 다시 그립니다.

주의: `--mod-option`은 값이 내장 기본값과 다를 때만 명시적 재정의로 인정됩니다 — `cwd=true`를
명시해도 `false`라고 쓴 설정 파일에는 지지 않습니다.

### 동작 원리

- **시작/재개:** 첫 요청 전에는 모델과 effort를 `~/.commandcode/config.json`에서 가져옵니다.
  재개된 세션은 transcript에서 컨텍스트·캐시 적중률·비용도 복원합니다. 출력 속도와 서브에이전트
  토큰만 실제 요청이 필요합니다.
- **색상:** `COLORTERM=truecolor|24bit` → 24비트 그라데이션, 아니면 256색 근사.
  `ascii=true` 또는 `TERM=dumb` → `#`/`-`. `NO_COLOR`는 블록 문자를 유지하고 색만 뺍니다.
- **좁은 터미널:** 자르지 않고 우선순위가 낮은 세그먼트부터 버립니다(cwd → 속도 → effort →
  서브에이전트 → 캐시 → 이름 → 비용 → 변경 수 → 바 축소 → 브랜치). 모델은 절대 버리지 않습니다.
  리사이즈 시 다시 그립니다.
- **출처:** 모델/effort/컨텍스트/캐시는 요청 이벤트에서, 비용 = 재개 시 transcript + 생성된 가격표로
  요청마다 계산, 서브에이전트 토큰은 `subagent_stop`에서, git은 `git status --porcelain=v1 -b`
  (5초 하한 + `refresh` 간격)로 가져옵니다.
- **모델 표:** 컨텍스트 윈도우와 가격은 CLI에 포함된 모델 카탈로그에서 **생성**됩니다 —
  `python3 scripts/gen-model-tables.py`로 재생성, `--check`로 드리프트 감지(CI가 실행).
  표에 없는 모델은 우아하게 축소됩니다(바 없음 / 비용 없음).

### 기여

issue와 PR을 환영합니다.

### 라이선스

MIT

---

## Español

Una barra de estado para [Command Code](https://commandcode.ai) (`cmd`, o `cmdc` en Windows;
en WSL ambos funcionan):
modelo, barra de contexto con degradado, tasa de aciertos de caché, coste de la sesión,
velocidad de salida, uso de subagentes, nombre de sesión y estado de git, dibujada bajo el
panel de entrada con `cmd.ui.setStatus()`.

**Requiere Command Code ≥ 1.10.0.**

### Instalación

```bash
cmd mods add cmdc-statusline -g
cmd mods list
```

Alternativas:

- **Desde git:** `cmd mods add holtwood/cmdc-statusline -g`
- **Un solo archivo:** copia `index.ts` a `~/.commandcode/mods/statusline.ts`
  (`%USERPROFILE%\.commandcode\mods\statusline.ts` en Windows) — sin compilación
- **Probar sin instalar:** `cmd --mod ./index.ts` (los mods se cargan una vez por proceso —
  usa `/reload` para aplicar cambios)

En Windows el binario es `cmdc` (`cmd` es el shell de Windows); en WSL funcionan tanto
`cmd` como `cmdc`. Elige una sola vía — el
paquete y el archivo suelto son dos mods que declaran los mismos flags, y los nombres de
flag se resuelven globalmente entre mods.

#### Instalarlo con tu agente

Pega esto en tu agente:

> Instala el mod `cmdc-statusline` de Command Code en ámbito de usuario: ejecuta
> `cmd mods add cmdc-statusline -g` (usa `cmdc` en Windows, `cmd` o `cmdc` en WSL; si npm
> no lo encuentra, usa `holtwood/cmdc-statusline`), confirma que `cmd mods list` lo
> muestra y luego dime que reinicie la sesión.

### Segmentos

| Segmento | Significado |
|---|---|
| `deepseek-v4.1-flash` | Modelo activo (`raw-model=true` conserva el prefijo del proveedor) |
| `max` | Esfuerzo de razonamiento de la última petición |
| `█░░░ 32k (3.2%)` | Contexto de la última petición: barra con degradado (verde→rojo), tokens, porcentaje de la ventana |
| `cache 99%` | Tasa de aciertos de la caché de prompt |
| `$0.013` | Coste de la sesión: historial al reanudar + peticiones nuevas |
| `42 tok/s` | Velocidad de salida de la última petición (tiempo real, incluye la espera del primer token) |
| `sub 16k` | Tokens consumidos por subagentes en esta sesión |
| `Simple Reply` | Nombre de la sesión (sobrevive a `/reload` y a reanudar) |
| `main ↑1` | Rama de git con ahead/behind |
| `+1 ~2 ?1` | preparado · modificado · sin seguimiento (`clean` si está limpio) |
| `my-project` | Nombre del directorio actual |

### Configuración

```
~/.commandcode/statusline.json          ámbito de usuario
<proyecto>/.commandcode/statusline.json ámbito de proyecto (prevalece sobre el de usuario)
--mod-option <clave>=<valor>            ajuste por ejecución
```

```json
{"preset": "full", "bar-width": 12, "refresh": 10, "cache": true, "cost": true}
```

Presets: `full` (por defecto, todo) · `minimal` (model, effort, context, bar, percent, git)
· `usage` (context, bar, percent, cache, cost, sub). Una clave escrita junto a un preset lo
prevalece.

| Clave | Por defecto | Notas |
|---|---|---|
| `model`, `effort`, `context` | `true` | modelo / esfuerzo / contexto de la última petición |
| `bar`, `bar-width`, `percent` | `true`, `12`, `true` | barra, ancho en celdas, porcentaje |
| `cache`, `cost`, `speed`, `sub` | `true` | aciertos / coste de sesión / velocidad / tokens de subagentes |
| `name`, `git`, `cwd` | `true` | nombre de sesión (24 caracteres máx.) / rama + cambios / directorio |
| `preset` | `full` | `full` / `minimal` / `usage` |
| `raw-model`, `ascii` | `false` | conservar prefijo del proveedor / render ASCII plano |
| `refresh` | `10` | segundos entre lecturas de git (`0` desactiva el sondeo) |
| `lang` | `zh` | `zh` / `en` — idioma del informe y de los diálogos |

Dos comandos lo consultan y lo cambian sin tocar el JSON:

- `/statusline` — la línea renderizada, los valores en bruto, una tabla
  `clave / defecto / efectivo / origen` y un aviso por cada entrada inutilizable (claves
  desconocidas, tipos erróneos, presets inválidos). El informe está en chino por defecto;
  `lang=en` lo pasa a inglés.
- `/statusline config` — editor interactivo (elige ámbito → clave → valor → confirma);
  escribe una sola clave y repinta al instante, sin `/reload`.

Ojo: `--mod-option` solo cuenta como ajuste explícito cuando el valor difiere del
predeterminado — pasar `cwd=true` no gana a un archivo de configuración que dice `false`.

### Cómo funciona

- **Arranque/reanudación:** antes de la primera petición, el modelo y el esfuerzo salen de
  `~/.commandcode/config.json`; una sesión reanudada también restaura contexto, aciertos de
  caché y coste desde el transcript. La velocidad y los tokens de subagentes necesitan una
  petición real.
- **Colores:** `COLORTERM=truecolor|24bit` → degradado de 24 bits, si no aproximación de
  256 colores; `ascii=true` o `TERM=dumb` → `#`/`-`; `NO_COLOR` conserva los bloques y
  quita el color.
- **Terminales estrechas:** se descartan segmentos por prioridad en vez de recortar
  (cwd → velocidad → esfuerzo → subagentes → caché → nombre → coste → cambios → la barra
  encoge → rama); el modelo nunca se descarta. Redibuja al cambiar el tamaño.
- **Orígenes:** modelo/esfuerzo/contexto/caché desde los eventos de petición; coste =
  transcript al reanudar + cada petición tarifada con una tabla generada; tokens de
  subagentes desde `subagent_stop`; git con `git status --porcelain=v1 -b` (mínimo de 5 s +
  sondeo cada `refresh`).
- **Tablas de modelos:** las ventanas de contexto y los precios se **generan** del catálogo
  de modelos incluido en el CLI — `python3 scripts/gen-model-tables.py` para regenerar,
  `--check` para detectar deriva (lo corre CI). Un modelo ausente degrada con gracia
  (sin barra / sin coste).

### Contribuciones

Issues y pull requests son bienvenidos.

### Licencia

MIT

---

## Français

Une ligne de statut pour [Command Code](https://commandcode.ai) (`cmd`, ou `cmdc` sous
Windows ; les deux fonctionnent sous WSL) : modèle, barre de contexte en dégradé, taux de
succès du cache, coût de session, vitesse de sortie, usage des sous-agents, nom de session
et état git, dessinée sous le panneau de saisie via `cmd.ui.setStatus()`.

**Nécessite Command Code ≥ 1.10.0.**

### Installation

```bash
cmd mods add cmdc-statusline -g
cmd mods list
```

Alternatives :

- **Depuis git :** `cmd mods add holtwood/cmdc-statusline -g`
- **Fichier unique :** copiez `index.ts` dans `~/.commandcode/mods/statusline.ts`
  (`%USERPROFILE%\.commandcode\mods\statusline.ts` sous Windows) — sans compilation
- **Essai sans installation :** `cmd --mod ./index.ts` (un mod se charge une fois par
  processus — `/reload` pour prendre un changement)

Sous Windows le binaire est `cmdc` (`cmd` est le shell Windows) ; sous WSL, `cmd` et
`cmdc` fonctionnent tous les deux. Choisissez une seule méthode — le paquet et le fichier
déposé sont deux mods qui déclarent les mêmes noms de flags, résolus globalement entre
mods.

#### Installer via votre agent

Collez ceci dans votre agent :

> Installe le mod `cmdc-statusline` de Command Code en portée utilisateur : exécute
> `cmd mods add cmdc-statusline -g` (`cmdc` sous Windows, `cmd` ou `cmdc` sous WSL ; si
> npm ne trouve pas le paquet, utilise `holtwood/cmdc-statusline`), vérifie que
> `cmd mods list` l'affiche, puis dis-moi de relancer la session.

### Segments

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

### Configuration

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
| `lang` | `zh` | `zh` / `en` — langue du rapport et des boîtes de dialogue |

Deux commandes inspectent et modifient tout ça sans toucher au JSON :

- `/statusline` — ligne rendue, valeurs brutes, table `clé / défaut / effectif / source`,
  et un avertissement par entrée inutilisable (clé inconnue, mauvais type, préréglage
  inconnu). Le rapport est en chinois par défaut ; `lang=en` le passe en anglais.
- `/statusline config` — éditeur interactif (portée → clé → valeur → confirmation) ;
  n'écrit qu'une clé et repeint aussitôt, sans `/reload`.

Attention : `--mod-option` ne compte comme ajustement explicite que si la valeur diffère du
défaut intégré — passer `cwd=true` ne bat pas un fichier de configuration disant `false`.

### Fonctionnement

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
  sous-agents depuis `subagent_stop` ; git via `git status --porcelain=v1 -b` (plancher de 5 s +
  polling à `refresh`).
- **Tables de modèles :** fenêtres de contexte et prix **générés** depuis le catalogue de
  modèles livré avec le CLI — `python3 scripts/gen-model-tables.py` pour régénérer,
  `--check` pour détecter la dérive (le CI le fait). Un modèle absent dégrade proprement
  (pas de barre / pas de coût).

### Contribution

Issues et pull requests sont les bienvenues.

### Licence

MIT

---

## Deutsch

Eine Statuszeile für [Command Code](https://commandcode.ai) (`cmd`, unter Windows `cmdc`,
unter WSL beide):
Modell, Kontextbalken mit Verlauf, Cache-Trefferquote, Sitzungskosten, Ausgabetempo,
Subagent-Nutzung, Sitzungsname und Git-Status — über `cmd.ui.setStatus()` unter dem
Eingabefeld gezeichnet.

**Erfordert Command Code ≥ 1.10.0.**

### Installation

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

Unter Windows heißt das Binary `cmdc` (`cmd` ist die Windows-Shell); unter WSL funktionieren
`cmd` und `cmdc` gleichermaßen. Nur einen Weg wählen —
Paket und abgelegte Datei sind zwei Mods, die dieselben Flag-Namen deklarieren, und Flag-Namen
werden mod-übergreifend global aufgelöst.

#### Vom Agenten installieren lassen

Folgendes in den Agenten einfügen:

> Installiere den Command-Code-Mod `cmdc-statusline` im Benutzer-Scope: führe
> `cmd mods add cmdc-statusline -g` aus (unter Windows `cmdc`, unter WSL `cmd` oder `cmdc`;
> falls npm das Paket nicht findet, `holtwood/cmdc-statusline` verwenden), prüfe, dass
> `cmd mods list` ihn zeigt, und sag mir dann, ich soll die Sitzung neu starten.

### Segmente

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

### Konfiguration

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
| `lang` | `zh` | `zh` / `en` — Sprache des Berichts und der Dialoge |

Zwei Befehle zeigen und ändern das, ohne JSON anzufassen:

- `/statusline` — die gerenderte Zeile, die Rohwerte, eine
  `Schlüssel / Standard / Effektiv / Quelle`-Tabelle und je eine Warnung pro unbrauchbarem
  Eintrag (unbekannte Schlüssel, falsche Typen, unbekannte Presets). Der Bericht ist
  standardmäßig auf Chinesisch; `lang=en` schaltet auf Englisch.
- `/statusline config` — interaktiver Editor (Scope → Schlüssel → Wert → bestätigen);
  schreibt genau einen Schlüssel und zeichnet sofort neu, ohne `/reload`.

Achtung: `--mod-option` gilt nur dann als expliziter Override, wenn der Wert vom eingebauten
Standard abweicht — `cwd=true` explizit zu übergeben schlägt keine Konfigurationsdatei mit
`false`.

### Funktionsweise

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

### Mitwirken

Issues und Pull Requests sind willkommen.

### Lizenz

MIT

---

## Русский

Строка состояния для [Command Code](https://commandcode.ai) (`cmd`, в Windows — `cmdc`,
в WSL работают оба):
модель, контекстная полоса с градиентом, доля попаданий в кэш, стоимость сессии, скорость
вывода, расход субагентов, имя сессии и состояние git — рисуется под панелью ввода через
`cmd.ui.setStatus()`.

**Требуется Command Code ≥ 1.10.0.**

### Установка

```bash
cmd mods add cmdc-statusline -g
cmd mods list
```

Другие способы:

- **Из git:** `cmd mods add holtwood/cmdc-statusline -g`
- **Один файл:** скопируйте `index.ts` в `~/.commandcode/mods/statusline.ts`
  (в Windows — `%USERPROFILE%\.commandcode\mods\statusline.ts`) — сборка не нужна
- **Попробовать без установки:** `cmd --mod ./index.ts` (моды загружаются раз на процесс —
  `/reload` подхватывает изменения)

В Windows бинарник называется `cmdc` (`cmd` — это шелл Windows); в WSL работают и `cmd`,
и `cmdc`. Выберите один способ —
пакет и скопированный файл это два мода с одинаковыми именами флагов, а имена флагов
разрешаются глобально между модами.

#### Установка через агента

Вставьте это в агента:

> Установи мод `cmdc-statusline` для Command Code на пользовательский уровень: выполни
> `cmd mods add cmdc-statusline -g` (в Windows — `cmdc`, в WSL — `cmd` или `cmdc`; если
> npm не находит пакет, используй `holtwood/cmdc-statusline`), проверь, что
> `cmd mods list` его показывает, и скажи мне перезапустить сессию.

### Сегменты

| Сегмент | Значение |
|---|---|
| `deepseek-v4.1-flash` | Текущая модель (`raw-model=true` сохраняет префикс провайдера) |
| `max` | Уровень рассуждений последнего запроса |
| `█░░░ 32k (3.2%)` | Контекст последнего запроса: полоса с градиентом (зелёный→красный), токены, доля окна |
| `cache 99%` | Доля попаданий в кэш промпта |
| `$0.013` | Стоимость сессии: история при возобновлении + новые запросы |
| `42 tok/s` | Скорость вывода последнего запроса (по настенным часам, включая ожидание первого токена) |
| `sub 16k` | Токены, израсходованные субагентами за сессию |
| `Simple Reply` | Имя сессии (переживает `/reload` и возобновление) |
| `main ↑1` | Ветка git с ahead/behind |
| `+1 ~2 ?1` | в индексе · изменено · не отслеживается (`clean`, если чисто) |
| `my-project` | Имя текущего каталога |

### Настройка

```
~/.commandcode/statusline.json          пользовательский уровень
<проект>/.commandcode/statusline.json   уровень проекта (перекрывает пользовательский)
--mod-option <ключ>=<значение>          переопределение на запуск
```

```json
{"preset": "full", "bar-width": 12, "refresh": 10, "cache": true, "cost": true}
```

Пресеты: `full` (по умолчанию, всё) · `minimal` (model, effort, context, bar, percent, git)
· `usage` (context, bar, percent, cache, cost, sub). Ключ, записанный рядом с пресетом,
его перекрывает.

| Ключ | По умолчанию | Примечание |
|---|---|---|
| `model`, `effort`, `context` | `true` | модель / рассуждения / контекст последнего запроса |
| `bar`, `bar-width`, `percent` | `true`, `12`, `true` | полоса, ширина в ячейках, процент |
| `cache`, `cost`, `speed`, `sub` | `true` | кэш / стоимость сессии / скорость / токены субагентов |
| `name`, `git`, `cwd` | `true` | имя сессии (макс. 24 символа) / ветка + изменения / каталог |
| `preset` | `full` | `full` / `minimal` / `usage` |
| `raw-model`, `ascii` | `false` | префикс провайдера / чистый ASCII-рендер |
| `refresh` | `10` | секунды между перечитываниями git (`0` выключает опрос) |
| `lang` | `zh` | `zh` / `en` — язык отчёта и диалогов |

Две команды показывают и меняют настройки без правки JSON:

- `/statusline` — отрисованная строка, сырые значения, таблица
  `ключ / умолчание / действует / источник` и по одному предупреждению на каждую
  непригодную запись (неизвестные ключи, неверные типы, неизвестные пресеты). Отчёт по
  умолчанию на китайском; `lang=en` переключает на английский.
- `/statusline config` — интерактивный редактор (уровень → ключ → значение → подтверждение);
  пишет ровно один ключ и сразу перерисовывает, без `/reload`.

Важно: `--mod-option` считается явным переопределением, только если значение отличается от
встроенного умолчания — явный `cwd=true` не перекроет конфиг с `false`.

### Как это работает

- **Старт/возобновление:** до первого запроса модель и рассуждения берутся из
  `~/.commandcode/config.json`; возобновлённая сессия также восстанавливает контекст,
  кэш и стоимость из транскрипта. Скорость и токены субагентов требуют живого запроса.
- **Цвета:** `COLORTERM=truecolor|24bit` → 24-битный градиент, иначе приближение 256 цветов;
  `ascii=true` или `TERM=dumb` → `#`/`-`; `NO_COLOR` оставляет блоки, убирает цвет.
- **Узкие терминалы:** вместо обрезки сегменты отбрасываются по приоритету
  (cwd → скорость → рассуждения → субагенты → кэш → имя → стоимость → изменения → полоса
  сжимается → ветка); модель не отбрасывается никогда. Перерисовка при ресайзе.
- **Источники:** модель/рассуждения/контекст/кэш — из событий запроса; стоимость =
  транскрипт при возобновлении + каждый запрос, оценённый по сгенерированной таблице цен;
  токены субагентов — из `subagent_stop`; git — через `git status --porcelain=v1 -b`
  (минимум 5 с + опрос каждые `refresh`).
- **Таблицы моделей:** контекстные окна и цены **генерируются** из каталога моделей,
  поставляемого с CLI — `python3 scripts/gen-model-tables.py` для перегенерации, `--check`
  ловит расхождения (это делает CI). Отсутствующая модель деградирует мягко (нет полосы /
  нет стоимости).

### Участие

Issues и pull request'ы приветствуются.

### Лицензия

MIT
