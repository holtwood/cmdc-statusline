# 会话累计 token 字段调研

**日期**：2026-09-16 · **宿主版本**：cmdc 1.54.1 · **结论：暂不做常驻段**

起因：能否统计会话一共消耗多少 token、要不要加进状态栏。调研结论存档，
日后重提此事直接引用。

## 数据源盘点（每个 model_request_end / transcript 行可得的字段）

| 字段 | 含义 | 口径 |
|---|---|---|
| `inputTokens` | 该次请求输入总量 | **含** cacheRead + cacheWrite + 未缓存 |
| `outputTokens` | 该次生成输出 | — |
| `cacheReadTokens` | 缓存命中 | inputTokens 子集 |
| `cacheWriteTokens` | 缓存写入 | inputTokens 子集 |
| `cacheWriteTokens1h` | 其中 1h 档 | 仅 Anthropic 系有 |

- live 累加：`model_request_end` 每次都带上面五个字段 → 进程内可直接求和。
- 恢复播种：transcript 的 usage 带同五字段 + `costUsd`，`readSessionSeed`
  现在只取最后一条种上下文，改成逐条求和即可补历史（重启不清零，与
  cost 同一套 seeded+live 机制）。
- **宿主内部已有汇总** `computeSessionStats` → `getSessionStats()`：
  产出 `tokens{input,output,cacheRead,cacheWrite}` + `costUsd` +
  `contextUsage{current,limit}`，但 1.54.1 里只被 `/name` 命令消费
  （且只用 `.name`）——**产品没有用户可见的「会话总 token」入口**。

## 记不了 / 有坑的部分

- 子代理：`subagent_stop` 只给 `input+output` 合计，无拆分、不进
  transcript、进程重启归零 → 累计段只能含主会话，sub 保持单列。
- thinking token 不单独拆（混在 output 里）。
- 累计 input 被「每轮重发全量上下文」天然放大，绝对值远大于窗口。

## 实测样本

`dev-home` 会话 `da028d96-0968-4304-977a-1fd292b56972`：
416 次请求，Σin 150,135,300（其中 cacheRead 145,365,120 ≈ 96%），
Σout 403,803，ΣcostUsd $1.3939。

## 不做常驻段的理由（2026-09-16 评估）

1. **与 cost 高度重叠**：单模型会话里 Σtoken 与 $ 近线性相关，
   「烧了多少」用美元更可读。
2. **可解读性差**：Σin 主体是重发上下文 + 缓存命中，无对应行动。
   上下文压力看 ctx 条，缓存效率看 cache%，烧钱包看 cost。
3. **占宽度**：底栏有降级队列，多一个常驻段挤掉 name/git/cwd。
4. **例外**：常跑价目表外模型（如 `stealth/ox-alpha`，cost 恒为 0）时，
   Σtoken 是唯一消耗信号——此时做段才不再冗余。

## 若日后要做（备忘方案）

- 先加 `/statusline` 报告数据行：`Σin/Σout/ΣcacheRead`，约 20 行
  （`readSessionSeed` 逐行求和 + `model_request_end` 累加 + state 加字段）。
- 若做段：新增 `tokens` 键，**default false、不进任何 preset**（opt-in），
  显示 `Σ <in+out>` 一个数（与 cost 同口径）；细分留给报告。
