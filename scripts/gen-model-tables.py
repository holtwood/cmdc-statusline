#!/usr/bin/env python3
"""从 cmdc 产品模型清单生成 index.ts 的内置表（上下文窗口 + 单价）。

表源：command-code 包内 dist/bundled/command-code-knowledge/reference/models.md
      （随 CLI 版本更新；CLI 升级后重跑本脚本即可对齐）

用法：
  python3 scripts/gen-model-tables.py            # 就地更新 index.ts
  python3 scripts/gen-model-tables.py --check    # 只校验是否已同步（退出码 1 = 需重跑）
  python3 scripts/gen-model-tables.py --models-md /path/to/models.md
"""

from __future__ import annotations

import argparse
import glob
import os
import re
import sys

MOD = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "index.ts")

ROW = re.compile(r"^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|")
PRICE = re.compile(
    r"\$([\d.]+)/\$([\d.]+)\s*·\s*cache\s*\$([\d.]+)(?:\s*\(write\s*\$([\d.]+)\))?"
)


RELATIVE = "command-code/dist/bundled/command-code-knowledge/reference/models.md"


def force_utf8_output() -> None:
    """Windows 控制台/CI 管道的默认编码是 GBK/CP1252，直接输出 ✓ 会 UnicodeEncodeError。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def default_models_md() -> str:
    """定位 CLI 内置的模型清单：先问 npm 全局根，再扫常见全局安装路径。"""
    candidates: list[str] = []
    try:
        import subprocess

        # Windows 上 npm 是 .cmd 垫片，不加 shell 无法直接执行（会抛 FileNotFoundError）
        root = subprocess.run(
            ["npm", "root", "-g"],
            capture_output=True,
            text=True,
            timeout=20,
            shell=os.name == "nt",
        ).stdout.strip()
        if root:
            candidates.append(os.path.join(root, *RELATIVE.split("/")))
    except Exception:
        pass
    candidates += [
        os.path.expanduser(f"~/.nvm/versions/node/*/lib/node_modules/{RELATIVE}"),
        f"/usr/local/lib/node_modules/{RELATIVE}",
        f"/usr/lib/node_modules/{RELATIVE}",
        os.path.expanduser(f"~/.npm-global/lib/node_modules/{RELATIVE}"),
    ]
    appdata = os.environ.get("APPDATA")
    if appdata:
        candidates.append(os.path.join(appdata, "npm", "node_modules", *RELATIVE.split("/")))
    for pattern in candidates:
        matches = sorted(glob.glob(pattern))
        if matches:
            return matches[-1]
    sys.exit(
        "找不到产品模型清单（models.md）：请先安装 command-code（npm i -g command-code），"
        "或用 --models-md 指定路径"
    )


def to_tokens(text: str) -> int | None:
    match = re.match(r"^([\d.]+)\s*([KM])$", text.strip())
    if not match:
        return None
    value = float(match.group(1))
    return int(value * 1000) if match.group(2) == "K" else int(value * 1_000_000)


def parse(models_md: str) -> tuple[dict[str, int], dict[str, dict[str, float]], list[str]]:
    windows: dict[str, int] = {}
    prices: dict[str, dict[str, float]] = {}
    unknown: list[str] = []
    for line in open(models_md, encoding="utf-8"):
        match = ROW.match(line)
        if not match:
            continue
        model_id, context, price_text = match.group(1), match.group(3), match.group(5)
        if model_id == "Id (use EXACTLY this)":
            continue
        tokens = to_tokens(context)
        if tokens:
            windows[model_id] = tokens
        else:
            unknown.append(model_id)
        price = PRICE.search(price_text)
        if price:
            prices[model_id] = {
                "in": float(price.group(1)),
                "out": float(price.group(2)),
                "cacheRead": float(price.group(3)),
                "cacheWrite": float(price.group(4)) if price.group(4) else 0.0,
            }
    return windows, prices, unknown


def render(windows: dict[str, int], prices: dict[str, dict[str, float]], unknown: list[str]) -> tuple[str, str]:
    window_rows = "\n".join(f"\t'{k}': {v}," for k, v in sorted(windows.items()))
    window_block = (
        "// 上下文窗口表：清单未公布窗口的模型（"
        + ("、".join(unknown) if unknown else "无")
        + "）不在表内，\n// 未命中时只显示 token 数、不显示百分比与进度条（BYOK/自定义端点模型同理）。\n"
        + "const MODEL_CONTEXT_WINDOWS: Record<string, number> = {\n"
        + window_rows
        + "\n};"
    )

    def num(value: float) -> str:
        return f"{value:g}"

    price_rows = "\n".join(
        f"\t'{k}': {{in: {num(v['in'])}, out: {num(v['out'])}, cacheRead: {num(v['cacheRead'])}, cacheWrite: {num(v['cacheWrite'])}}},"
        for k, v in sorted(prices.items())
    )
    price_block = (
        "// 单价表（美元 / 1M token，含缓存读写价）：花费按 usage 自行累计，公式已对产品记录的 costUsd 逐条核对\n"
        + "type ModelPrice = {\n\treadonly in: number;\n\treadonly out: number;\n\treadonly cacheRead: number;\n\treadonly cacheWrite: number;\n};\n\n"
        + "const MODEL_PRICES: Record<string, ModelPrice> = {\n"
        + price_rows
        + "\n};"
    )
    return window_block, price_block


def splice(source: str, name: str, block: str) -> str:
    pattern = re.compile(
        rf"(// >>> GENERATED:{name}.*?\n)(.*?)(// <<< GENERATED:{name})", re.S
    )
    if not pattern.search(source):
        sys.exit(f"statusline.ts 里找不到 GENERATED:{name} 标记块")
    return pattern.sub(lambda m: m.group(1) + block + "\n" + m.group(3), source)


def main() -> int:
    force_utf8_output()
    parser = argparse.ArgumentParser()
    parser.add_argument("--models-md", default=default_models_md())
    parser.add_argument("--check", action="store_true", help="只校验，不写入")
    parser.add_argument("--ts", default=MOD)
    args = parser.parse_args()

    windows, prices, unknown = parse(args.models_md)
    window_block, price_block = render(windows, prices, unknown)
    source = open(args.ts, encoding="utf-8").read()
    updated = splice(splice(source, "WINDOWS", window_block), "PRICES", price_block)

    if args.check:
        if updated == source:
            print(f"✓ 已同步（窗口 {len(windows)} · 单价 {len(prices)}）")
            return 0
        print(f"✗ 需重跑：{args.ts} 与 {os.path.basename(args.models_md)} 不一致")
        return 1

    if updated != source:
        open(args.ts, "w", encoding="utf-8").write(updated)
    print(f"✓ 已更新 {args.ts}：窗口 {len(windows)} · 单价 {len(prices)} · 无窗口 {len(unknown)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
