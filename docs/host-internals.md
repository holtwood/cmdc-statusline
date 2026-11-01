# 宿主（cmdc）内部行为考证

对 `command-code` 打包产物逆向出的结论，供「cost 准不准」「事件带什么字段」这类
问题直接引用，不必重新翻 cli.mjs。

**核实版本**：cmdc 1.88.2，2026-10-31（花费链路、事件字段与状态栏行仍于该版复核；
mod API / hook / transcript 形状与 1.87.3 一致）。最早核实版本为 1.54.1（2026-09-16）。

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
- 缓存命中率用 `cacheReadTokens / inputTokens`：`inputTokens` 是总量（含缓存
  读/写），与宿主 `estimateCatalogCostUsd` 的 `未缓存 = input − read − write`
  是同一口径。不要再除以 `input + read + write`——那会把缓存重复计一遍。
- `cmd.getContextUsage()` 返回 `{tokens, contextWindow, percent}`：`tokens` 是
  宿主按消息估算的值（1.82.3 实测长期为 null，1.88.2 的实现在消息变化后才有
  数），**做上下文计数不如 provider 报的 `inputTokens` 准**；`contextWindow`
  来自宿主自己的模型目录，可作为生成表未命中（BYOK / 自定义端点）时的兜底。

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

## 状态栏宽度

- cmdc 1.84 / 1.87 / 1.88 的 `useStatusRowLayout` 都把状态行内容宽度定为
  `termWidth - 3`，`StatusLine` 再给整行加 `paddingLeft: 2`；每行的 `width`
  就是 `termWidth - 3`，因此右侧实际只剩 1 列余量。
- `StatuslineGroup` 用 `wrap: "truncate-end"`：超出内容宽度的部分被直接切掉
  （末尾加省略号），不会换行。mod 自己必须按 `columns - 3` 预算，按 `-2`
  会稳定多出一列，窄终端上表现为最后一个字符/最后一段被吃掉。
- `process.stdout.columns` 不可用时，宿主 TUI 自己按 80 列兜底（`useTerminalWidth`）；
  桌面/移动端视图是否把可视宽度传给 mod 取决于宿主，mod 侧用 `width` 配置显式定宽。
- 1.88.2 的 `mod-builder/reference/ui.md` 新增「In the VS Code extension」一节：
  `setStatus` 在 VS Code 扩展里也渲染为状态栏（commands 进斜杠菜单，notify/toast
  变聊天行），即 `setStatus` 现在有 TUI 与 VS Code 两个渲染面；但两者都不把可视
  宽度暴露给 mod，宽度预算仍只能靠 `stdout.columns` / `COLUMNS` / `width` 配置推断。

## 上下文与压缩（compaction）

- `compaction_start` 只有 `{trigger}`；`compaction_done` 只有
  `{tokensSaved?}`，且 `tokensSaved` 仅在 > 0 时出现。
- `tokensSaved` 是宿主 `estimateTokens(messages)` 前后的差值，与 provider 在
  `usage.inputTokens` 里报的 prompt 大小**不是一个口径**，不能直接相减。
- mod 的处理：`compaction_done` 时清空上下文数字，等下一次
  `model_request_end` 给真值。保留旧值会让进度条在压缩后继续显示压缩前的占用。
- 自动压缩与 `/compact` 都走同一条 `summarizePreservingSkills` 路径；后者直接
  调 model client，**不触发 `model_request_start/end`**，所以不能指望用请求
  事件来发现压缩。

## 速度（TTFT / 解码）

- `model_request_start` 只带 `model`；`model_request_end` 带 `usage` 与
  `stopReason`，没有首 token 时间。
- 首 token 只能从流式事件拿：`thinking_delta` / `text_delta` 的 `delta` 非空
  即为“开始出 token”。思考也算——provider 把 reasoning 计进 `outputTokens`。
- 解码速率 = `outputTokens / (end − firstToken)`；TTFT = `firstToken −
  requestStart`。两者都比“end − requestStart”的墙钟口径更接近真实吞吐。
- 有的路由把整段文本在结束前一次 flush 回来（文本增量 ≤ 2 且首文本到结束
  < 250ms，且没有更早的思考 token）：这时没有解码时间线，mod 退回墙钟并在
  报告里照实给出 TTFT，不假装那是解码速率。
- 中断 / `run_error` 后这次请求没有可信的结束点：mod 清掉起点，避免下一次
  成功请求把中断等待算进速率。

## 账号窗口（5h / 周）

- 宿主 `/usage` 面用的接口：`GET https://api.commandcode.ai/alpha/billing/credits`，
  `Authorization: Bearer <CLI key>`。响应里：
  `{credits:{…}, windowLimits:{fiveHour:{used,cap,resetAt}, weekly:{…}}, …}`。
- `resetAt` 是**毫秒**时间戳（宿主用 `formatResetClock({resetAtMs})` 直接
  `new Date`）；`used/cap` 是同一量纲的计数（百分位 = used/cap）。
- 凭据解析顺序与宿主一致：`COMMAND_CODE_API_KEY` → `~/.commandcode/auth.json`
  的 `apiKey`。CLI 的 `getCommandAuthKey` 就是这么读的。
- **未公开接口**：字段或路径随时可能变。mod 侧 `quota` 默认关；开启后每 120s
  拉一次，3s 超时，`redirect: 'error'`（不让 Authorization 跟着重定向走），
  任何失败只清空这一段，不 notify、不抛、不打印 key；headless 不请求。
- 响应缺字段 / cap ≤ 0 / 非数字一律丢弃；两个窗口都不可用就当作没有数据。

## 活动计数

- `run_start` 是**用户回合**的边界（一次提交到停止）；`turn_start/end` 是模型
  轮次（含工具循环），不是一回事。
- 步数取 `model_request_end` 次数；工具数取 `tool_completed` +
  `tool_errored`，失败数单独记 `tool_errored`。
- `subagent_progress.tokensUsed` 是**该 agent 到目前为止**的累计值（宿主在
  translator 里逐 delta 累加），不是单次增量；按 `toolCallId` 取最大值再求和，
  否则每个 progress 都会重复计。`subagent_stop` 的 `tokensUsed` 是最终值，
  同 id 取 max 后收敛。
