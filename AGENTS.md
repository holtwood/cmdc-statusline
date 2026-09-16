# cmdc-statusline

Command Code（cmdc）的状态栏 mod，单文件 `index.ts`（约 2k 行），部署即拷到
`~/.commandcode/mods/statusline.ts`。文件末尾 GENERATED 区（上下文窗口 / 单价
两张表）由 `scripts/gen-model-tables.py` 维护，勿手改。

## 验证

```bash
npm test                # node test/statusline.test.mjs（无框架，自断言）
npm run typecheck       # tsc --noEmit
npm run tables:check    # 比对生成表与产品模型清单是否漂移（CI 也跑）
```

## 约定速查

- flag 名必须带 `statusline.` 前缀（宿主 flag 取值表进程级共享，撞名静默串值）；
  配置键/JSON 用短名。派生点唯一：`flagName()`。
- 会话状态全在 `freshSession()`；同进程换会话（sessionId 变）整体重建。
- 窄终端按 `DROP_ORDER` 丢段；模型永不丢。
- 版本下限 `MIN_HOST_VERSION = 1.10.0`（`cmd.ui.capabilities` 自该版起存在）。

## 参考文档

- `docs/host-internals.md` —— 对宿主打包产物逆向出的结论（事件字段、花费估算
  公式、子代理数据限制），回答「cost 准不准」类问题前先看它。
- `docs/session-tokens.md` —— 「会话累计 token」调研存档：数据源、口径、
  2026-09-16 评估为不做常驻段的理由与日后备忘方案。
