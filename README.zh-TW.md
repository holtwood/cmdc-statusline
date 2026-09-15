# cmdc-statusline

[English](README.md) | [简体中文](README.zh-CN.md) | **繁體中文** | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md)

[Command Code](https://commandcode.ai)（`cmd`，Windows 上為 `cmdc`）的狀態列 —— 模型、漸層上下文
進度條、快取命中率、工作階段花費、輸出速度、子代理用量、工作階段名稱與 git 狀態，透過
`cmd.ui.setStatus()` 渲染在輸入框下方。

```text
deepseek-v4.1-flash │ max │ █░░░░░░░░░░░ 32k (3.2%) │ cache 99% │ $0.013 │ 42 tok/s │ sub 16k │ Simple Reply │ main ↑1 │ +1 ~2 ?1 │ my-project
```

**需要 Command Code ≥ 1.10.0。** 舊宿主上本 mod 只留一條升級提示然後停用——`cmdc update`
後重開工作階段。

## 安裝

```bash
cmd mods add cmdc-statusline -g   # -g = 使用者級；去掉則只裝當前專案
cmd mods list
```

其他裝法：

- **走 git：** `cmd mods add holtwood/cmdc-statusline -g`
- **單檔投放：** 把 `index.ts` 放到 `~/.commandcode/mods/statusline.ts`（Windows 上為
  `%USERPROFILE%\.commandcode\mods\statusline.ts`）——無需建置
- **免安裝試跑：** `cmd --mod ./index.ts`（mod 每行程只載入一次——改完用 `/reload` 生效）

Windows 上命令是 `cmdc`（`cmd` 是系統 shell）。裝法挑一種——套件與投放檔是兩個 mod，
會宣告同名 flag，而 flag 名是跨 mod 全域解析的。

交給 AI 代裝，把下面這段貼給 agent：

> 幫我安裝 Command Code 的 mod `cmdc-statusline`（使用者級）：執行
> `cmd mods add cmdc-statusline -g`（Windows 上用 `cmdc`；若 npm 找不到該套件，改用
> `holtwood/cmdc-statusline`），確認 `cmd mods list` 能列出，然後提醒我重開工作階段。

## 欄位

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

## 設定

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

不碰 JSON 也能查和改，兩條命令：

- `/statusline` —— 印出渲染行、原始數值、每個鍵的「鍵 / 預設 / 生效 / 來源」表，並對每條
  用不了的內容（未知鍵、型別錯誤、不認識的預設）單獨告警。（報告文字為簡體中文。）
- `/statusline config` —— 對話框式編輯（選作用域 → 鍵 → 值 → 確認），只寫一個鍵並立刻
  重繪，不用 `/reload`。

注意：`--mod-option` 只在取值與內建預設不同時才算顯式覆蓋——顯式傳 `cwd=true` 壓不過
寫著 `false` 的設定檔。

## 運作原理

- **啟動/恢復：** 首次請求前，模型與 effort 取自 `~/.commandcode/config.json`；恢復的工作階段
  還會從 transcript 還原上下文、快取命中與花費。輸出速度與子代理 token 必須等真實請求。
- **顏色：** `COLORTERM=truecolor|24bit` → 24-bit 漸層，否則 256 色近似；`ascii=true` 或
  `TERM=dumb` → `#`/`-`；`NO_COLOR` 保留塊字符、去色。
- **窄終端：** 按優先順序丟欄位而不截斷（cwd → 速度 → effort → 子代理 → 快取 → 名稱 →
  花費 → 變更數 → 進度條收縮 → 分支）；模型永不丟。resize 時重繪。
- **資料來源：** 模型/effort/上下文/快取來自請求事件；花費 = 恢復時的 transcript + 每次請求
  按價格表計算；子代理 token 來自 `subagent_stop`；git 走 `git status --porcelain=v1 -b`
  （5 秒快取 + `refresh` 間隔輪詢）。
- **模型表：** 上下文視窗與價格由 CLI 自帶模型目錄**產生**——
  `python3 scripts/gen-model-tables.py` 重新產生，`--check` 檢查漂移（CI 會跑）。表裡沒有的
  模型優雅降級（無進度條/無花費）。

## 開發

```bash
npm test                                    # node test/statusline.test.mjs —— 零依賴、無需建置
python3 scripts/gen-model-tables.py --check
```

Node 22.18+/24 匯入時直接擦除 TypeScript 型別，測試跑的就是 `index.ts` 本體。
`STATUSLINE_MOD=/path/to/statusline.ts` 可測另一份副本。CI 覆蓋 Linux、macOS、Windows。

## 已知限制

- 沒有額度/配額欄位——刻意只讀本地（不連網、不碰 `auth.json`）。
- 新請求花費按隨包價格表計算；CLI 價格變動需重跑 `gen-model-tables.py`。
- 工作階段名稱、花費與請求恢復讀取未文件化的 `~/.commandcode/**` 佈局——佈局變了只會
  「少一個欄位」，不會崩。
- `git status` 每 `refresh` 秒輪詢一次——小倉庫無感，超大倉庫請調大 `refresh` 或設 `0`。

## 同類專案

[grknbyk/commandcode-statusline](https://github.com/grknbyk/commandcode-statusline)（額度、用量視窗、花費節奏）·
[vikas-gits-good/cmd-statusline](https://github.com/vikas-gits-good/cmd-statusline)（模板化佈局、窄終端優先順序）·
[estifie/command-code-mod-session-stats](https://github.com/estifie/command-code-mod-session-stats)（上下文壓力、快取命中、transcript 口徑花費）。

## 授權

MIT
