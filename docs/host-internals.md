# 宿主（cmdc）内部行为考证

对 `command-code` 打包产物逆向出的结论，供「cost 准不准」「事件带什么字段」这类
问题直接引用，不必重新翻 cli.mjs。

**核实版本**：cmdc 1.54.1，2026-09-16。

**取证方法**：宿主打包在 `dist/cli.mjs`（约 1.9MB 压缩单文件），按符号名搜即可：
`model_request_end` / `estimateSessionCostUsd` / `getDisplayRates` /
`toSessionUsage` / `createSessionRecorder` / `subagent_stop`。官方 mod 文档在
`dist/bundled/mod-builder/reference/hooks-and-events.md`（字段级细节不全，
以 cli.mjs 为准）。

## 花费（cost）链路

- `model_request_end` 事件发出的是**原始 usage**（`usage: x.usage`，只有
  token 数），**不含 costUsd**。mod 侧拿不到产品算的数，自算估算是唯一途径。
- transcript 里的 `costUsd` 是宿主提交消息时用
  `estimateSessionCostUsd({model, usage})` 补算、由 `toSessionUsage` 写进
  usage 对象的——**它也是估算，不是账单真值**，只是和 mod 用同一套思路。
- 宿主公式：`未缓存输入×inputCost + 输出×outputCost + 缓存读×cacheReadCost
  + 缓存写5m部分×cacheWriteCost + 缓存写1h部分×cacheWrite1hCost`，
  其中 `1h部分 = min(cacheWriteTokens1h, cacheWriteTokens)`。
- **mod 与宿主的实质差异只有一处**：mod 不读 `cacheWriteTokens1h`，全部缓存写
  按 5m 价计。12 个 Anthropic 模型有更高 1h 档（如 opus 系 6.25→10）。跑
  Claude 系且有 1h 缓存写时 mod 偏低；deepseek 系无此字段，两边逐分吻合。
- 宿主 `getDisplayRates` 还覆盖 mod 表之外的目录：gateway / openrouter /
  alibaba / morph / wafer / BYOK 模型；个别模型有 `contextTiers` 分层价
  （gpt-6-astra、Qwen3.6/3.7-Plus）与 `timeOfDay` 时段价（morph 的
  deepseek-v4-flash）。表外模型在 mod 侧估算为 0，`/statusline` 报
  「（单价未知）」。

## usage 字段与会话统计

- `model_request_end` 的 usage 五字段：`inputTokens`（**含** cacheRead +
  cacheWrite + 未缓存）、`outputTokens`、`cacheReadTokens`、
  `cacheWriteTokens`、`cacheWriteTokens1h`（1h 档，仅 Anthropic 系）。
- 宿主有内部汇总 `computeSessionStats` → `getSessionStats()`：
  `tokens{input,output,cacheRead,cacheWrite}` + `costUsd` +
  `contextUsage{current,limit}`；1.54.1 仅被 `/name` 消费（只用 `.name`），
  **无用户可见的会话总 token 命令**。

## 子代理

- `subagent_stop` 只给 `tokensUsed = inputTokens + outputTokens` 合计——
  无缓存拆分、无 model 维度；transcript 不记子代理 usage。**无法精确计价**，
  当前「`sub` 段只显 token、`/statusline` 报告按会话均价折算粗估」已是上限。

## 其它

- transcript 播种时 `"costUsd":N` 整行宽松匹配（不锚定 usage 位置）：消息正文
  若含形如 `"costUsd":0.5` 的文本会被误计入。属刻意宽容（配合 drift 检测）。
- 真实 transcript 行形状（已核实）：
  `{"type":"message","id":"…","message":{…},"usage":{…,"costUsd":N},"model":"…","effort":"…"}`
  ——usage/model/effort 在行尾，与 `ASSISTANT_TAIL` 锚定一致。

## 若要修

按「粗估会话花费」定位，现状已够。唯一值得的改动（日后跑 Claude 系想抹平
偏差时再做）：`Usage` 加 `cacheWriteTokens1h`、价表加 `cacheWrite1h` 列，
公式对齐宿主（`w1h = min(cacheWriteTokens1h, cacheWriteTokens)` 按 1h 价，
其余写按 5m 价）。改动约 20 行 + 生成脚本一列。
