# cmdc-statusline

[English](README.md) | [简体中文](README.zh-CN.md) | **繁體中文** | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md)

> 本譯文由 AI 輔助產生，若有歧義以 [英文版](README.md) 為準，歡迎送 PR 修正。

[Command Code](https://commandcode.ai)（`cmdc`）的狀態列 —— 模型、漸層上下文進度條、快取命中率、
工作階段花費、輸出速度、子代理用量、工作階段名稱與 git 狀態，全部顯示在輸入框下方那一行。

```text
deepseek-v4.1-flash │ max │ █░░░░░░░░░░░ 32k (3.2%) │ cache 99% │ $0.013 │ 42 tok/s │ sub 16k │ Simple Reply │ main ↑1 │ +1 ~2 ?1 │ my-project
```

Command Code 沒有 Claude Code 那種 `statusLine` 外部指令掛鉤——`cmd.ui.setStatus()`（mod 介面）
是唯一能在輸入框下方渲染常駐列的方式，本 mod 就建立在其上。

## 安裝

```bash
cmd mods add holtwood/cmdc-statusline -g     # 使用者層級；去掉 -g 則為專案層級
cmd mods list                                # 應能列出本 mod
```

也可以直接投放檔案、不使用套件管理：

```bash
mkdir -p ~/.commandcode/mods
curl -o ~/.commandcode/mods/statusline.ts \
  https://raw.githubusercontent.com/holtwood/cmdc-statusline/main/index.ts
```

> Windows 上指令是 `cmdc`（`cmd` 是系統 shell）——即 `cmdc mods add …`、`cmdc mods list`。

免安裝試跑：`cmd --mod ./index.ts`。mod 每個行程只載入一次——改完請用 `/reload` 或開新工作階段。
不需建置步驟：Command Code 在載入時直接編譯 TypeScript。

## 欄位

| 欄位 | 含義 |
|---|---|
| `deepseek-v4.1-flash` | 目前模型（取自請求本身；`raw-model=true` 保留 vendor 前綴） |
| `max` | 上次請求的推理強度 |
| `█░░░ 32k (3.2%)` | 上次請求的上下文：漸層進度條（依格位綠→黃→紅）、token 數、佔模型視窗比例 |
| `cache 99%` | 上次請求的提示快取命中率（快取讀 ÷ 輸入） |
| `$0.013` | 工作階段花費 —— 恢復工作階段時的歷史累計 + 本行程新增 |
| `42 tok/s` | 上次請求的輸出速度（牆鐘計時，含首 token 等待） |
| `sub 16k` | 本工作階段子代理（`agent` 工具）消耗的 token |
| `Simple Reply` | 工作階段名稱（`/reload` 與恢復後仍在） |
| `main ↑1` | git 分支與 ahead/behind |
| `+1 ~2 ?1` | 已暫存 · 已修改 · 未追蹤（乾淨時顯示 `clean`） |
| `my-project` | 目前目錄名稱 |

## 設定

設定寫在 JSON；命令列可逐次覆寫。

```
~/.commandcode/statusline.json          使用者層級
<專案>/.commandcode/statusline.json     專案層級（覆寫使用者層級）
--mod-option <name>=<value>             單次執行覆寫
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

| 鍵 | 預設 | 說明 |
|---|---|---|
| `model`、`effort`、`context` | `true` | 模型 / 推理強度 / 上次請求的上下文 |
| `bar`、`bar-width`、`percent` | `true`、`12`、`true` | 漸層進度條、格數、百分比 |
| `cache` | `true` | 快取命中率 |
| `cost` | `true` | 工作階段花費 |
| `speed` | `true` | 輸出速度 |
| `sub` | `true` | 子代理 token |
| `name` | `true` | 工作階段名稱（超過 24 字截斷） |
| `git` | `true` | 分支 + 變更數 |
| `cwd` | `true` | 目錄名稱 |
| `raw-model` | `false` | 模型 id 保留 vendor 前綴 |
| `ascii` | `false` | 強制純 ASCII 渲染 |
| `refresh` | `10` | 重新讀取 git 的間隔秒數（0 = 關閉計時器） |

**優先順序注意：** Command Code 會把 `--mod-option` 的**值**從 mod 看得到的 argv 中抹除，
因此只有取值**與內建預設不同**時才判定為明確覆寫。明確傳入預設值
（例如 `--mod-option cwd=true`）壓不過設定檔。

## 渲染

- `COLORTERM=truecolor|24bit` → 24-bit 真彩漸層條；否則以 256 色近似；
  `ascii=true` 或 `TERM=dumb` → `#`/`-`；`NO_COLOR` 保留區塊字元但去色。
- **窄終端不截斷**：依優先順序丟欄位（`cwd` → 速度 → effort → 子代理 → 快取 → 工作階段名稱 →
  花費 → 變更數，接著上下文依 條 → token+% → token 收縮，再丟分支），並在 resize 時立即重繪。
  模型永不丟。

## 數字從哪裡來

| 值 | 來源 | 可信度 |
|---|---|---|
| 模型 / effort / 上下文 / 快取 | `model_request_start` / `model_request_end` 事件負載 | 精確 |
| 工作階段花費 | 恢復時讀 `<sessionId>.jsonl` 的 `costUsd` + 每次請求依內建單價表計算 | 恢復部分是產品自己的數字；新增部分逐筆重現產品口徑（已對既有 `costUsd` 全量核對） |
| 子代理 token | `subagent_stop` 事件 | token 精確；子代理花費**不**計入花費欄位（產品本身也不落地） |
| 工作階段名稱 | `session_titled` 事件 + 啟動時讀 `<sessionId>.meta.json` | 盡力而為——該檔案佈局未文件化，讀取包在 `try` 內 |
| 分支 / 變更數 | `cmd.exec` 執行 `git status --porcelain=v1 -b` | 精確，5 秒快取 |

上下文視窗表與單價表是**產生**的（非手寫），來源是 CLI 隨套件發布的模型目錄：

```bash
python3 scripts/gen-model-tables.py           # CLI 升級後重新產生
python3 scripts/gen-model-tables.py --check   # 表已漂移則失敗（CI 會執行）
```

模型不在表中也能優雅降級：沒有視窗就不顯示進度條/百分比，沒有單價就不顯示花費。

## 開發

```bash
node test/statusline.test.mjs     # 136 項斷言，零依賴、無需建置
python3 scripts/gen-model-tables.py --check
```

測試直接匯入 `index.ts` —— Node 22.18+/24 原生抹除型別，無需任何工具鏈。
用 `STATUSLINE_MOD=/path/to/statusline.ts` 可改測另一份副本。

## 已知限制

- **沒有額度/配額欄位。** 同類 mod 會讀 Command Code API 取得剩餘額度與 5 小時/每週視窗；
  本 mod 刻意只讀本地（不連網、不碰 `auth.json`）。
- 新請求的花費是**依隨套件價格表計算**的，不是從 transcript 讀回，因此價格變動需重跑
  `scripts/gen-model-tables.py`（恢復種子與每次請求的算法都已對過產品自己的數字）。
- 工作階段名稱與花費恢復需要讀 `~/.commandcode/projects/**` —— 未文件化的佈局。所有讀取都有兜底：
  佈局改變只會「少一個欄位」，不會崩潰。

## 同類專案

想換個口味可以看看：[grknbyk/commandcode-statusline](https://github.com/grknbyk/commandcode-statusline)
（額度、用量視窗、花費節奏）、[vikas-gits-good/cmd-statusline](https://github.com/vikas-gits-good/cmd-statusline)
（模板化佈局、窄終端優先順序處理）、[estifie/command-code-mod-session-stats](https://github.com/estifie/command-code-mod-session-stats)
（上下文壓力、快取命中率、讀 transcript 的花費並折算子代理）。

## 授權

MIT
