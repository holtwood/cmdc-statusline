// Command Code mod：输入框下方状态栏
// 段位：模型 / effort / 上下文进度条 / 缓存命中 / 会话花费 / 输出速度 / 子代理用量 /
//       session 名 / git 分支与改动 / 当前目录名
//
// 部署：cp index.ts ~/.commandcode/mods/statusline.ts
//       （或装包：cmd mods add holtwood/cmdc-statusline -g；试跑不安装：cmd --mod ./index.ts）
// 背景：cmdc 没有 Claude Code 式的 statusLine 外部命令钩子，mod 的 cmd.ui.setStatus 是唯一
// 能在输入框下方渲染常驻状态段的接口（见 mod-builder reference/ui.md），本 mod 按此实现。
// 内置两张表（上下文窗口 / 单价）由 scripts/gen-model-tables.py 从产品模型清单生成，勿手改。
// 花费为「会话累计」＝ 恢复时从 transcript 求和的历史部分 + 本进程新产生的部分（重启不清零）。
//
// 配置（优先级：内置默认 < 用户级 < 项目级 < 命令行）：
//   ~/.commandcode/statusline.json          用户级
//   <项目>/.commandcode/statusline.json     项目级（覆盖用户级）
//   --mod-option name=value                 命令行（仅在取值与内置默认不同时才判定为显式覆盖——
//                                           cmdc 会把 --mod-option 的值从 mod 可见的 argv 里抹掉，
//                                           故无法精确区分「显式传了默认值」）
//   可用键：model/effort/context/bar/bar-width/percent/cache/cost/speed/sub/name/git/cwd/
//          raw-model/ascii/refresh
//
// 窄终端：按优先级降级（先丢 cwd→速度→effort→子代理→缓存→session 名→花费→改动数，
//         上下文由「条+token+百分比」逐级退化，支路最后丢，模型永不丢），并监听 resize 立即重绘。

import {createReadStream, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import type {ModApi} from '@commandcode/harness';

type Usage = {
	readonly inputTokens?: number;
	readonly outputTokens?: number;
	readonly cacheReadTokens?: number;
	readonly cacheWriteTokens?: number;
};

type ModelEvent = {
	readonly model?: string;
	readonly effort?: string;
	readonly usage?: Usage;
};

type ConfigChangedEvent = {
	readonly setting?: string;
	readonly value?: unknown;
};

type SessionEvent = {
	readonly source?: string;
	readonly sessionId?: string;
};

type SubagentStopEvent = {
	readonly subagentType?: string;
	readonly tokensUsed?: number;
};

type GitInfo = {
	readonly isRepo: boolean;
	readonly branch?: string;
	readonly ahead: number;
	readonly behind: number;
	readonly staged: number;
	readonly modified: number;
	readonly untracked: number;
};

type Snapshot = GitInfo & {
	model?: string;
	effort?: string;
	contextTokens?: number;
	cacheHit?: number;
	title?: string;
	costUsd: number;
	speed?: number;
	subTokens: number;
};

type Segments = {
	readonly model: boolean;
	readonly effort: boolean;
	readonly context: boolean;
	readonly bar: boolean;
	readonly percent: boolean;
	readonly cache: boolean;
	readonly cost: boolean;
	readonly speed: boolean;
	readonly sub: boolean;
	readonly name: boolean;
	readonly git: boolean;
	readonly cwd: boolean;
};

type ComposeOptions = {
	readonly color: boolean;
	readonly rawModel: boolean;
	readonly mode: ColorMode;
	readonly barWidth: number;
	readonly maxWidth?: number;
	readonly cwd?: string;
};

type ColorMode = 'truecolor' | 'ansi256' | 'ascii';

type Segment = {
	readonly key: string;
	readonly priority: number;
	readonly variants: readonly string[];
};

type Config = Record<string, unknown>;

const SEP = ' │ ';
const GIT_TTL_MS = 5000;
const GIT_TIMEOUT_MS = 10_000;
const TITLE_COLUMNS = 24;
const COST_WARN_USD = 1;
const COST_ALERT_USD = 10;
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

// 窄终端丢弃顺序：数字越大越先丢；0 = 永不丢
const DROP_ORDER = {
	cwd: 11,
	speed: 10,
	effort: 9,
	sub: 8,
	cache: 7,
	name: 6,
	cost: 5,
	gitChanges: 4,
	context: 3,
	gitBranch: 2,
	model: 0,
} as const;

const ANSI = {
	reset: '\u001b[0m',
	bold: '\u001b[1m',
	dim: '\u001b[2m',
	red: '\u001b[31m',
	green: '\u001b[32m',
	yellow: '\u001b[33m',
	cyan: '\u001b[36m',
	magenta: '\u001b[35m',
	gray: '\u001b[90m',
};

// >>> GENERATED:WINDOWS（由 commandcode/gen-model-tables.py 生成，勿手改）
// 上下文窗口表：清单未公布窗口的模型（zai-org/GLM-5.1、MiniMaxAI/MiniMax-M2.7、Qwen/Qwen3.6-Max-Preview、Qwen/Qwen3.6-Plus）不在表内，
// 未命中时只显示 token 数、不显示百分比与进度条（BYOK/自定义端点模型同理）。
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
	'MiniMaxAI/MiniMax-M2.5': 200000,
	'MiniMaxAI/MiniMax-M3': 1000000,
	'Qwen/Qwen3.7-Flash': 1000000,
	'Qwen/Qwen3.7-Max': 1000000,
	'Qwen/Qwen3.7-Plus': 1000000,
	'Qwen/Qwen3.8-27B': 262000,
	'Qwen/Qwen3.8-Flash': 1000000,
	'Qwen/Qwen3.8-Max': 1000000,
	'Qwen/Qwen3.8-Max-0902': 1000000,
	'claude-fable-5': 1000000,
	'claude-fable-5-1': 1000000,
	'claude-haiku-4-5-20251001': 200000,
	'claude-opus-4-7': 1000000,
	'claude-opus-4-8': 1000000,
	'claude-opus-5': 1000000,
	'claude-sonnet-4-6': 1000000,
	'claude-sonnet-5': 1000000,
	'deepseek/deepseek-v4-flash': 1000000,
	'deepseek/deepseek-v4-flash-fast': 1000000,
	'deepseek/deepseek-v4-flash-vision-exp': 1000000,
	'deepseek/deepseek-v4-pro': 1000000,
	'deepseek/deepseek-v4.1-flash': 1000000,
	'google/gemini-3.1-flash-lite': 1000000,
	'google/gemini-3.5-flash': 1000000,
	'google/gemini-3.5-flash-lite': 1000000,
	'google/gemini-3.6-flash': 1000000,
	'google/gemini-3.7-flash': 1050000,
	'google/gemini-3.8-flash': 1000000,
	'gpt-5.3-codex': 400000,
	'gpt-5.4': 400000,
	'gpt-5.4-mini': 400000,
	'gpt-5.5': 400000,
	'gpt-5.6-luna': 1050000,
	'gpt-5.6-sol': 1050000,
	'gpt-5.6-terra': 1050000,
	'gpt-6-astra': 1050000,
	'inclusionai/ling-3.0-flash-sante:free': 262000,
	'meituan/LongCat-2.0:free': 1050000,
	'meta/muse-spark-1.1': 1050000,
	'meta/muse-spark-1.2': 1050000,
	'meta/muse-spark-1.2-contributor': 1050000,
	'meta/muse-spark-1.3': 1050000,
	'meta/muse-spark-1.3-contributor': 1050000,
	'moonshotai/Kimi-K2.5': 256000,
	'moonshotai/Kimi-K2.6': 256000,
	'moonshotai/Kimi-K2.7-Code': 256000,
	'moonshotai/Kimi-K2.7-Code-Highspeed': 262000,
	'moonshotai/Kimi-K3': 1000000,
	'nvidia/nemotron-3-ultra-550b-a55b': 1000000,
	'poolside/laguna-s-2.1-free': 256000,
	'sakana/fugu-ultra': 1000000,
	'stepfun/Step-3.5-Flash': 1000000,
	'stepfun/Step-3.7-Flash': 256000,
	'tencent/hy3-paid': 262000,
	'tencent/hy4-preview': 1050000,
	'thinkingmachines/inkling': 256000,
	'thinkingmachines/inkling-small': 1000000,
	'xai/grok-4.5': 500000,
	'xai/grok-4.6': 500000,
	'xiaomi/mimo-v2.5': 1000000,
	'xiaomi/mimo-v2.5-pro': 1000000,
	'z-ai/glm-5.3-flash': 1050000,
	'zai-org/GLM-5': 200000,
	'zai-org/GLM-5.2': 1000000,
	'zai-org/GLM-5.2-Fast': 1000000,
	'zai-org/GLM-5.3': 1000000,
};
// <<< GENERATED:WINDOWS

// >>> GENERATED:PRICES（由 commandcode/gen-model-tables.py 生成，勿手改）
// 单价表（美元 / 1M token，含缓存读写价）：花费按 usage 自行累计，公式已对产品记录的 costUsd 逐条核对
type ModelPrice = {
	readonly in: number;
	readonly out: number;
	readonly cacheRead: number;
	readonly cacheWrite: number;
};

const MODEL_PRICES: Record<string, ModelPrice> = {
	'MiniMaxAI/MiniMax-M2.5': {in: 0.3, out: 1.2, cacheRead: 0.03, cacheWrite: 0},
	'MiniMaxAI/MiniMax-M2.7': {in: 0.3, out: 1.2, cacheRead: 0.06, cacheWrite: 0},
	'MiniMaxAI/MiniMax-M3': {in: 0.3, out: 1.2, cacheRead: 0.06, cacheWrite: 0},
	'Qwen/Qwen3.6-Max-Preview': {in: 1.3, out: 7.8, cacheRead: 0.26, cacheWrite: 1.63},
	'Qwen/Qwen3.6-Plus': {in: 0.5, out: 3, cacheRead: 0.1, cacheWrite: 0},
	'Qwen/Qwen3.7-Flash': {in: 0.03, out: 0.13, cacheRead: 0.006, cacheWrite: 0.038},
	'Qwen/Qwen3.7-Max': {in: 2.5, out: 7.5, cacheRead: 0.5, cacheWrite: 3.13},
	'Qwen/Qwen3.7-Plus': {in: 0.4, out: 1.6, cacheRead: 0.08, cacheWrite: 0.5},
	'Qwen/Qwen3.8-27B': {in: 0.4, out: 3, cacheRead: 0.04, cacheWrite: 0},
	'Qwen/Qwen3.8-Flash': {in: 0.16, out: 0.47, cacheRead: 0.016, cacheWrite: 0},
	'Qwen/Qwen3.8-Max': {in: 2, out: 6, cacheRead: 0.25, cacheWrite: 2.5},
	'Qwen/Qwen3.8-Max-0902': {in: 2, out: 6, cacheRead: 0.25, cacheWrite: 0},
	'claude-fable-5': {in: 10, out: 50, cacheRead: 1, cacheWrite: 12.5},
	'claude-fable-5-1': {in: 10, out: 50, cacheRead: 0.25, cacheWrite: 12.5},
	'claude-haiku-4-5-20251001': {in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25},
	'claude-opus-4-7': {in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25},
	'claude-opus-4-8': {in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25},
	'claude-opus-5': {in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25},
	'claude-sonnet-4-6': {in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75},
	'claude-sonnet-5': {in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5},
	'deepseek/deepseek-v4-flash': {in: 0.15, out: 0.6, cacheRead: 0.003, cacheWrite: 0},
	'deepseek/deepseek-v4-flash-fast': {in: 0.28, out: 0.56, cacheRead: 0.07, cacheWrite: 0},
	'deepseek/deepseek-v4-flash-vision-exp': {in: 0.15, out: 0.6, cacheRead: 0.003, cacheWrite: 0},
	'deepseek/deepseek-v4-pro': {in: 0.66, out: 1.98, cacheRead: 0.022, cacheWrite: 0},
	'deepseek/deepseek-v4.1-flash': {in: 0.15, out: 0.6, cacheRead: 0.003, cacheWrite: 0},
	'google/gemini-3.1-flash-lite': {in: 0.25, out: 1.5, cacheRead: 0.03, cacheWrite: 0},
	'google/gemini-3.5-flash': {in: 1.5, out: 9, cacheRead: 0.15, cacheWrite: 0},
	'google/gemini-3.5-flash-lite': {in: 0.3, out: 2.5, cacheRead: 0.03, cacheWrite: 0},
	'google/gemini-3.6-flash': {in: 1.5, out: 7.5, cacheRead: 0.15, cacheWrite: 0},
	'google/gemini-3.7-flash': {in: 1.5, out: 7.5, cacheRead: 0.15, cacheWrite: 0.08334},
	'google/gemini-3.8-flash': {in: 1.5, out: 7.5, cacheRead: 0.15, cacheWrite: 0},
	'gpt-5.3-codex': {in: 2, out: 8, cacheRead: 0.5, cacheWrite: 0},
	'gpt-5.4': {in: 2.5, out: 15, cacheRead: 0.25, cacheWrite: 0},
	'gpt-5.4-mini': {in: 0.75, out: 4.5, cacheRead: 0.075, cacheWrite: 0},
	'gpt-5.5': {in: 5, out: 30, cacheRead: 0.5, cacheWrite: 0},
	'gpt-5.6-luna': {in: 0.2, out: 1.2, cacheRead: 0.02, cacheWrite: 0.25},
	'gpt-5.6-sol': {in: 5, out: 30, cacheRead: 0.5, cacheWrite: 6.25},
	'gpt-5.6-terra': {in: 2, out: 12, cacheRead: 0.2, cacheWrite: 2.5},
	'gpt-6-astra': {in: 10, out: 50, cacheRead: 1, cacheWrite: 12.5},
	'inclusionai/ling-3.0-flash-sante:free': {in: 0, out: 0, cacheRead: 0, cacheWrite: 0},
	'meituan/LongCat-2.0:free': {in: 0, out: 0, cacheRead: 0, cacheWrite: 0},
	'meta/muse-spark-1.1': {in: 1.25, out: 4.25, cacheRead: 0.15, cacheWrite: 0},
	'meta/muse-spark-1.2': {in: 1.25, out: 4.25, cacheRead: 0.15, cacheWrite: 0},
	'meta/muse-spark-1.2-contributor': {in: 0.1, out: 0.2, cacheRead: 0.002, cacheWrite: 0},
	'meta/muse-spark-1.3': {in: 1.25, out: 4.25, cacheRead: 0.15, cacheWrite: 0},
	'meta/muse-spark-1.3-contributor': {in: 0.1, out: 0.2, cacheRead: 0.002, cacheWrite: 0},
	'moonshotai/Kimi-K2.5': {in: 0.6, out: 3, cacheRead: 0.1, cacheWrite: 0},
	'moonshotai/Kimi-K2.6': {in: 0.95, out: 4, cacheRead: 0.16, cacheWrite: 0},
	'moonshotai/Kimi-K2.7-Code': {in: 0.95, out: 4, cacheRead: 0.19, cacheWrite: 0},
	'moonshotai/Kimi-K2.7-Code-Highspeed': {in: 1.9, out: 8, cacheRead: 0.38, cacheWrite: 0},
	'moonshotai/Kimi-K3': {in: 3, out: 15, cacheRead: 0.3, cacheWrite: 0},
	'nvidia/nemotron-3-ultra-550b-a55b': {in: 0.6, out: 2.4, cacheRead: 0.12, cacheWrite: 0},
	'poolside/laguna-s-2.1-free': {in: 0, out: 0, cacheRead: 0, cacheWrite: 0},
	'sakana/fugu-ultra': {in: 5, out: 30, cacheRead: 0.5, cacheWrite: 0},
	'stepfun/Step-3.5-Flash': {in: 0.1, out: 0.3, cacheRead: 0.02, cacheWrite: 0},
	'stepfun/Step-3.7-Flash': {in: 0.2, out: 1.15, cacheRead: 0.04, cacheWrite: 0},
	'tencent/hy3-paid': {in: 0.14, out: 0.58, cacheRead: 0.035, cacheWrite: 0},
	'tencent/hy4-preview': {in: 0.834, out: 2.501, cacheRead: 0.042, cacheWrite: 0},
	'thinkingmachines/inkling': {in: 1, out: 4.05, cacheRead: 0.17, cacheWrite: 0},
	'thinkingmachines/inkling-small': {in: 0.5, out: 1.2, cacheRead: 0.1, cacheWrite: 0},
	'xai/grok-4.5': {in: 2, out: 6, cacheRead: 0.5, cacheWrite: 0},
	'xai/grok-4.6': {in: 2, out: 6, cacheRead: 0.5, cacheWrite: 0},
	'xiaomi/mimo-v2.5': {in: 0.14, out: 0.28, cacheRead: 0.0028, cacheWrite: 0},
	'xiaomi/mimo-v2.5-pro': {in: 0.435, out: 0.87, cacheRead: 0.0036, cacheWrite: 0},
	'z-ai/glm-5.3-flash': {in: 0.15, out: 0.5, cacheRead: 0.03, cacheWrite: 0},
	'zai-org/GLM-5': {in: 1, out: 3.2, cacheRead: 0.2, cacheWrite: 0},
	'zai-org/GLM-5.1': {in: 1.4, out: 4.4, cacheRead: 0.26, cacheWrite: 0},
	'zai-org/GLM-5.2': {in: 1.4, out: 4.4, cacheRead: 0.26, cacheWrite: 0},
	'zai-org/GLM-5.2-Fast': {in: 3, out: 10.25, cacheRead: 0.5, cacheWrite: 0},
	'zai-org/GLM-5.3': {in: 1.4, out: 4.4, cacheRead: 0.26, cacheWrite: 0},
};
// <<< GENERATED:PRICES

export function contextWindowFor(model?: string): number | undefined {
	return model ? MODEL_CONTEXT_WINDOWS[model] : undefined;
}

export function modelPriceFor(model?: string): ModelPrice | undefined {
	return model ? MODEL_PRICES[model] : undefined;
}

export function shortModel(model: string): string {
	const index = model.lastIndexOf('/');
	return index === -1 ? model : model.slice(index + 1);
}

// cmd.cwd 在 Windows 上是反斜杠绝对路径（实测 D:\...），故两种分隔符都要切
export function cwdBasename(cwd: string): string | undefined {
	const parts = cwd.split(/[/\\]/).filter(Boolean);
	return parts.length > 0 ? parts[parts.length - 1] : undefined;
}

export function formatTokens(tokens: number): string {
	if (tokens < 1000) return String(tokens);
	if (tokens < 10000) return `${(tokens / 1000).toFixed(1)}k`;
	return `${Math.round(tokens / 1000)}k`;
}

export function formatWindow(tokens: number): string {
	if (tokens >= 1_000_000) {
		const millions = tokens / 1_000_000;
		return `${Number.isInteger(millions) ? millions : millions.toFixed(2)}M`;
	}
	return `${Math.round(tokens / 1000)}k`;
}

export function formatPercent(tokens: number, window: number): string {
	const percent = (tokens / window) * 100;
	if (percent <= 0) return '0%';
	if (percent >= 10) return `${Math.round(percent)}%`;
	return `${percent.toFixed(1)}%`;
}

export function formatRate(percent: number): string {
	if (percent >= 99.95) return '100%';
	if (percent >= 10) return `${Math.floor(percent)}%`;
	return `${percent.toFixed(1)}%`;
}

export function formatCost(usd: number): string {
	if (usd <= 0) return '$0';
	const digits = usd < 0.0001 ? 5 : usd < 0.01 ? 4 : usd < 1 ? 3 : 2;
	const text = usd.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
	return `$${text}`;
}

export function estimateCost(usage: Usage, model?: string): number {
	const price = modelPriceFor(model);
	if (!price) return 0;
	const cacheRead = usage.cacheReadTokens ?? 0;
	const cacheWrite = usage.cacheWriteTokens ?? 0;
	const uncached = Math.max(0, (usage.inputTokens ?? 0) - cacheRead - cacheWrite);
	return (
		(uncached * price.in +
			cacheRead * price.cacheRead +
			cacheWrite * price.cacheWrite +
			(usage.outputTokens ?? 0) * price.out) /
		1_000_000
	);
}

export function cacheHitRate(usage: Usage): number | undefined {
	const input = usage.inputTokens ?? 0;
	if (input <= 0) return undefined;
	return ((usage.cacheReadTokens ?? 0) / input) * 100;
}

export function rgbForPosition(t: number): [number, number, number] {
	const mix = (from: number[], to: number[], k: number): [number, number, number] => [
		Math.round(from[0] + (to[0] - from[0]) * k),
		Math.round(from[1] + (to[1] - from[1]) * k),
		Math.round(from[2] + (to[2] - from[2]) * k),
	];
	const position = Math.max(0, Math.min(1, t));
	return position < 0.5
		? mix([0, 200, 0], [200, 200, 0], position / 0.5)
		: mix([200, 200, 0], [200, 0, 0], (position - 0.5) / 0.5);
}

function sgrColor([r, g, b]: [number, number, number], mode: ColorMode): string {
	if (mode === 'truecolor') return `\u001b[38;2;${r};${g};${b}m`;
	const toCube = (value: number) => Math.round((value / 255) * 5);
	return `\u001b[38;5;${16 + 36 * toCube(r) + 6 * toCube(g) + toCube(b)}m`;
}

export function renderBar(
	percent: number,
	width: number,
	mode: ColorMode,
	color: boolean,
): string {
	const ratio = Math.max(0, Math.min(100, percent)) / 100;
	const filled = Math.max(percent > 0 ? 1 : 0, Math.round(ratio * width));
	const cells: string[] = [];
	for (let index = 0; index < width; index += 1) {
		const isFilled = index < filled;
		const glyph = mode === 'ascii' ? (isFilled ? '#' : '-') : isFilled ? '█' : '░';
		if (!color) {
			cells.push(glyph);
			continue;
		}
		if (!isFilled) {
			cells.push(`${ANSI.dim}${glyph}${ANSI.reset}`);
			continue;
		}
		const position = width > 1 ? index / (width - 1) : 0;
		cells.push(`${sgrColor(rgbForPosition(position), mode)}${glyph}${ANSI.reset}`);
	}
	return cells.join('');
}

// 终端显示宽度：ANSI 不计宽；CJK / 全角 / 常见 emoji 占 2 列（按字符数算会让中文标题算窄一半）
const WIDE_CHAR =
	/[\u{1100}-\u{115F}\u{2E80}-\u{303E}\u{3041}-\u{33FF}\u{3400}-\u{4DBF}\u{4E00}-\u{9FFF}\u{A000}-\u{A4CF}\u{AC00}-\u{D7A3}\u{F900}-\u{FAFF}\u{FE30}-\u{FE6F}\u{FF00}-\u{FF60}\u{FFE0}-\u{FFE6}\u{1F300}-\u{1F64F}\u{1F900}-\u{1F9FF}\u{20000}-\u{3FFFD}]/u;

export function visibleLength(text: string): number {
	let width = 0;
	for (const char of text.replace(ANSI_PATTERN, '')) {
		width += WIDE_CHAR.test(char) ? 2 : 1;
	}
	return width;
}

export function truncateToWidth(text: string, max: number): string {
	if (visibleLength(text) <= max) return text;
	let width = 0;
	let out = '';
	for (const char of text) {
		const next = width + (WIDE_CHAR.test(char) ? 2 : 1);
		if (next > max - 1) break;
		width = next;
		out += char;
	}
	return `${out}…`;
}

export function parseGitStatus(porcelain: string, isRepo = true): GitInfo {
	const info = {
		isRepo,
		branch: undefined as string | undefined,
		ahead: 0,
		behind: 0,
		staged: 0,
		modified: 0,
		untracked: 0,
	};
	for (const line of porcelain.split('\n')) {
		if (!line) continue;
		if (line.startsWith('## ')) {
			const header = line.slice(3);
			if (header.startsWith('HEAD (no branch)')) {
				info.branch = 'detached';
			} else {
				info.branch = header.split('...')[0].split(' ')[0];
				const ahead = /ahead (\d+)/.exec(header);
				const behind = /behind (\d+)/.exec(header);
				if (ahead) info.ahead = Number(ahead[1]);
				if (behind) info.behind = Number(behind[1]);
			}
			continue;
		}
		const index = line[0];
		const worktree = line[1];
		if (index === '?' && worktree === '?') {
			info.untracked += 1;
			continue;
		}
		if (index !== ' ' && index !== '?') info.staged += 1;
		if (worktree !== ' ' && worktree !== '?') info.modified += 1;
	}
	return info;
}

export function composeLine(
	snapshot: Snapshot,
	segments: Segments,
	options: ComposeOptions,
): string {
	const paint = (code: string, text: string) =>
		options.color ? `${code}${text}${ANSI.reset}` : text;
	const entries: {key: string; priority: number; variants: string[]}[] = [];
	const push = (key: string, variants: string[]): void => {
		const filled = variants.filter(Boolean);
		if (filled.length > 0) {
			entries.push({key, priority: DROP_ORDER[key as keyof typeof DROP_ORDER] ?? 5, variants: filled});
		}
	};

	if (segments.model && snapshot.model) {
		const name = options.rawModel ? snapshot.model : shortModel(snapshot.model);
		push('model', [paint(ANSI.bold + ANSI.cyan, name)]);
	}
	if (segments.effort && snapshot.effort) {
		push('effort', [paint(ANSI.dim, snapshot.effort)]);
	}
	if (segments.context && snapshot.contextTokens) {
		const window = contextWindowFor(snapshot.model);
		const percent = window ? (snapshot.contextTokens / window) * 100 : undefined;
		const withBar = segments.bar && percent !== undefined && options.barWidth > 0;
		const tokens = paint(
			ANSI.gray,
			`${withBar ? '' : 'ctx '}${formatTokens(snapshot.contextTokens)}`,
		);
		const bar = withBar
			? renderBar(percent as number, options.barWidth, options.mode, options.color)
			: '';
		const percentText =
			segments.percent && percent !== undefined
				? paint(percent >= 90 ? ANSI.red : percent >= 80 ? ANSI.yellow : ANSI.gray, `(${formatPercent(snapshot.contextTokens, window as number)})`)
				: '';
		push('context', [
			[bar, tokens, percentText].filter(Boolean).join(' '),
			[tokens, percentText].filter(Boolean).join(' '),
			paint(ANSI.gray, `ctx ${formatTokens(snapshot.contextTokens)}`),
		]);
	}
	if (segments.cache && snapshot.cacheHit !== undefined) {
		const code =
			snapshot.cacheHit >= 90 ? ANSI.green : snapshot.cacheHit >= 50 ? ANSI.gray : ANSI.yellow;
		push('cache', [paint(code, `cache ${formatRate(snapshot.cacheHit)}`)]);
	}
	if (segments.cost && snapshot.costUsd > 0) {
		const code =
			snapshot.costUsd >= COST_ALERT_USD
				? ANSI.red
				: snapshot.costUsd >= COST_WARN_USD
					? ANSI.yellow
					: ANSI.gray;
		push('cost', [paint(code, formatCost(snapshot.costUsd))]);
	}
	if (segments.speed && snapshot.speed && Math.round(snapshot.speed) > 0) {
		push('speed', [paint(ANSI.gray, `${Math.round(snapshot.speed)} tok/s`)]);
	}
	if (segments.sub && snapshot.subTokens > 0) {
		push('sub', [paint(ANSI.gray, `sub ${formatTokens(snapshot.subTokens)}`)]);
	}
	if (segments.name && snapshot.title) {
		push('name', [paint(ANSI.bold, truncateToWidth(snapshot.title, TITLE_COLUMNS))]);
	}
	if (segments.git && snapshot.isRepo && snapshot.branch) {
		let branch = paint(ANSI.magenta, snapshot.branch);
		if (snapshot.ahead > 0 || snapshot.behind > 0) {
			const delta = [
				snapshot.ahead > 0 ? `↑${snapshot.ahead}` : '',
				snapshot.behind > 0 ? `↓${snapshot.behind}` : '',
			]
				.filter(Boolean)
				.join('');
			branch += paint(ANSI.dim, ` ${delta}`);
		}
		push('gitBranch', [branch, paint(ANSI.magenta, snapshot.branch)]);
		const changes = [
			snapshot.staged > 0 ? paint(ANSI.green, `+${snapshot.staged}`) : '',
			snapshot.modified > 0 ? paint(ANSI.yellow, `~${snapshot.modified}`) : '',
			snapshot.untracked > 0 ? paint(ANSI.gray, `?${snapshot.untracked}`) : '',
		]
			.filter(Boolean)
			.join(' ');
		push('gitChanges', [changes || paint(ANSI.dim, 'clean'), '']);
	}
	if (segments.cwd && options.cwd) {
		push('cwd', [paint(ANSI.gray, options.cwd)]);
	}

	const variantIndex = new Map<string, number>(entries.map(entry => [entry.key, 0]));
	const joined = (): string =>
		entries
			.map(entry => entry.variants[variantIndex.get(entry.key) ?? 0])
			.filter(Boolean)
			.join(paint(ANSI.dim, SEP));

	const maxWidth = options.maxWidth ?? 0;
	if (maxWidth > 0) {
		let guard = 0;
		while (visibleLength(joined()) > maxWidth && guard < 64) {
			guard += 1;
			const droppable = entries
				.filter(entry => entry.priority > 0)
				.sort((a, b) => b.priority - a.priority);
			const target = droppable[0];
			if (!target) break;
			const index = variantIndex.get(target.key) ?? 0;
			if (index < target.variants.length - 1) {
				variantIndex.set(target.key, index + 1);
			} else {
				entries.splice(entries.indexOf(target), 1);
			}
		}
	}

	return joined();
}

export function loadConfig(cwd: string): {config: Config; sources: string[]} {
	const config: Config = {};
	const sources: string[] = [];
	const paths = [
		join(homedir(), '.commandcode', 'statusline.json'),
		join(cwd, '.commandcode', 'statusline.json'),
	];
	for (const path of paths) {
		try {
			const parsed = JSON.parse(readFileSync(path, 'utf8')) as Config;
			if (parsed && typeof parsed === 'object') {
				Object.assign(config, parsed);
				sources.push(path);
			}
		} catch {
			// 文件不存在或不是合法 JSON → 跳过
		}
	}
	return {config, sources};
}

function sessionPath(sessionId: string, cwd: string, suffix: string): string {
	const slug = cwd.replace(/^[/\\]+/, '').replace(/[/\\:]+/g, '-');
	return join(homedir(), '.commandcode', 'projects', slug, `${sessionId}${suffix}`);
}

function readSessionTitle(sessionId: string, cwd: string): string | undefined {
	try {
		const meta = JSON.parse(
			readFileSync(sessionPath(sessionId, cwd, '.meta.json'), 'utf8'),
		) as {title?: unknown};
		return typeof meta.title === 'string' && meta.title.trim() ? meta.title : undefined;
	} catch {
		return undefined;
	}
}

// 会话累计花费：流式扫 transcript 抽取 costUsd 求和（恢复会话时用，避免花费从 0 重算）。
// 只对含 "costUsd" 的行做正则抽取，不做 JSON.parse —— transcript 里单行可达上百 KB。
export async function readSessionCost(
	sessionId: string,
	cwd: string,
): Promise<number | undefined> {
	let reader: ReturnType<typeof createInterface> | undefined;
	try {
		reader = createInterface({
			input: createReadStream(sessionPath(sessionId, cwd, '.jsonl'), {
				encoding: 'utf8',
			}),
			crlfDelay: Infinity,
		});
		let total = 0;
		let found = false;
		for await (const line of reader) {
			if (!line.includes('"costUsd"')) continue;
			for (const match of line.matchAll(/"costUsd":\s*([\d.eE+-]+)/g)) {
				const value = Number(match[1]);
				if (Number.isFinite(value)) {
					total += value;
					found = true;
				}
			}
		}
		return found ? total : 0;
	} catch {
		return undefined;
	} finally {
		reader?.close();
	}
}

export default function (cmd: ModApi): void {
	cmd.addFlag('model', {type: 'boolean', default: true, description: '显示当前模型'});
	cmd.addFlag('effort', {type: 'boolean', default: true, description: '显示 thinking effort'});
	cmd.addFlag('context', {
		type: 'boolean',
		default: true,
		description: '显示上一次请求的上下文 token 数',
	});
	cmd.addFlag('bar', {
		type: 'boolean',
		default: true,
		description: '用渐变进度条显示上下文占窗（需命中内置窗口表）',
	});
	cmd.addFlag('bar-width', {type: 'string', default: '12', description: '进度条格数'});
	cmd.addFlag('percent', {
		type: 'boolean',
		default: true,
		description: '显示上下文占模型窗口的百分比',
	});
	cmd.addFlag('cache', {
		type: 'boolean',
		default: true,
		description: '显示上一次请求的缓存命中率',
	});
	cmd.addFlag('cost', {
		type: 'boolean',
		default: true,
		description: '显示本次会话累计花费（按内置单价表推算）',
	});
	cmd.addFlag('speed', {
		type: 'boolean',
		default: true,
		description: '显示上一次请求的输出速度（tok/s）',
	});
	cmd.addFlag('sub', {
		type: 'boolean',
		default: true,
		description: '显示子代理（agent 工具）累计消耗 token',
	});
	cmd.addFlag('name', {type: 'boolean', default: true, description: '显示 session 名'});
	cmd.addFlag('git', {type: 'boolean', default: true, description: '显示 git 分支与改动数'});
	cmd.addFlag('cwd', {type: 'boolean', default: true, description: '显示当前目录名'});
	cmd.addFlag('raw-model', {
		type: 'boolean',
		default: false,
		description: '模型显示完整 id（不省略 vendor 前缀）',
	});
	cmd.addFlag('ascii', {
		type: 'boolean',
		default: false,
		description: '纯 ASCII 渲染（无 Unicode 块、无颜色）',
	});
	cmd.addFlag('refresh', {
		type: 'string',
		default: '10',
		description: '刷新间隔秒数（0 = 关闭定时刷新）',
	});

	const {config, sources: configSources} = loadConfig(cmd.cwd);
	const snapshot: Snapshot = {
		isRepo: false,
		ahead: 0,
		behind: 0,
		staged: 0,
		modified: 0,
		untracked: 0,
		costUsd: 0,
		subTokens: 0,
	};
	let sessionId: string | undefined;
	let gitCheckedAt = 0;
	let requestStartedAt = 0;
	let seededCost = 0;
	let sessionCost = 0;
	let costSeeded = false;
	let timer: NodeJS.Timeout | undefined;
	let refreshing = false;
	let pending = false;

	// 命令行只在「与内置默认不同」时才判定为显式覆盖（宿主会抹掉 argv 里的 =value）
	const flag = (name: string, fallback: boolean): boolean => {
		const value = cmd.getFlag(name);
		if (typeof value === 'boolean' && value !== fallback) return value;
		const configured = config[name];
		if (typeof configured === 'boolean') return configured;
		return typeof value === 'boolean' ? value : fallback;
	};

	const flagNumber = (name: string, fallback: number, max: number): number => {
		const value = cmd.getFlag(name);
		if (typeof value === 'string' && value !== String(fallback)) {
			const parsed = Number(value);
			if (Number.isFinite(parsed) && parsed >= 0) return Math.min(max, Math.floor(parsed));
		}
		const configured = config[name];
		if (typeof configured === 'number' && Number.isFinite(configured) && configured >= 0) {
			return Math.min(max, Math.floor(configured));
		}
		if (typeof configured === 'string') {
			const parsed = Number(configured);
			if (Number.isFinite(parsed) && parsed >= 0) return Math.min(max, Math.floor(parsed));
		}
		const parsedFlag = Number(value ?? fallback);
		return Number.isFinite(parsedFlag) && parsedFlag >= 0
			? Math.min(max, Math.floor(parsedFlag))
			: fallback;
	};

	const barWidth = (): number => flagNumber('bar-width', 12, 40);

	const asciiOnly = (): boolean => flag('ascii', false) || process.env.TERM === 'dumb';

	const colorEnabled = (): boolean => !process.env.NO_COLOR && !asciiOnly();

	const colorMode = (): ColorMode => {
		if (asciiOnly()) return 'ascii';
		return /truecolor|24bit/i.test(process.env.COLORTERM ?? '') ? 'truecolor' : 'ansi256';
	};

	const segments = (): Segments => ({
		model: flag('model', true),
		effort: flag('effort', true),
		context: flag('context', true),
		bar: flag('bar', true),
		percent: flag('percent', true),
		cache: flag('cache', true),
		cost: flag('cost', true),
		speed: flag('speed', true),
		sub: flag('sub', true),
		name: flag('name', true),
		git: flag('git', true),
		cwd: flag('cwd', true),
	});

	const terminalWidth = (): number => {
		const columns = process.stdout.columns ?? 0;
		if (!Number.isFinite(columns) || columns <= 0) return 0;
		return Math.max(20, columns - 2);
	};

	const cwdName = (): string | undefined => cwdBasename(cmd.cwd);

	const seedTitle = (): void => {
		if (!flag('name', true) || !sessionId || snapshot.title) return;
		const title = readSessionTitle(sessionId, cmd.cwd);
		if (title) snapshot.title = title;
	};

	// 显示值 = 从 transcript 恢复的历史累计 + 本进程新产生的部分（两部分都只算一次，不会重复计）
	const updateCost = (): void => {
		snapshot.costUsd = seededCost + sessionCost;
	};

	const seedCost = async (): Promise<void> => {
		if (costSeeded || !flag('cost', true) || !sessionId) return;
		costSeeded = true;
		const total = await readSessionCost(sessionId, cmd.cwd);
		if (total && total > 0) {
			seededCost = total;
			updateCost();
			void refresh();
		}
	};

	const readGit = async (force: boolean): Promise<void> => {
		if (!force && Date.now() - gitCheckedAt < GIT_TTL_MS) return;
		gitCheckedAt = Date.now();
		// 超时兜底：git 挂死（锁、死挂载、超大仓库）不能让 refreshing 永远为真——那会把底栏冻住
		const controller = new AbortController();
		const killer = setTimeout(() => controller.abort(), GIT_TIMEOUT_MS);
		try {
			const {stdout, code} = await cmd.exec({
				command: 'git',
				args: ['status', '--porcelain=v1', '-b'],
				cwd: cmd.cwd,
				signal: controller.signal,
			});
			const info =
				code === 0
					? parseGitStatus(stdout)
					: {
							isRepo: false,
							ahead: 0,
							behind: 0,
							staged: 0,
							modified: 0,
							untracked: 0,
						};
			snapshot.isRepo = info.isRepo;
			snapshot.branch = info.branch;
			snapshot.ahead = info.ahead;
			snapshot.behind = info.behind;
			snapshot.staged = info.staged;
			snapshot.modified = info.modified;
			snapshot.untracked = info.untracked;
		} catch {
			snapshot.isRepo = false;
			snapshot.branch = undefined;
		} finally {
			clearTimeout(killer);
		}
	};

	const composer = (): string =>
		composeLine(snapshot, segments(), {
			color: colorEnabled(),
			rawModel: flag('raw-model', false),
			mode: colorMode(),
			barWidth: barWidth(),
			maxWidth: terminalWidth(),
			cwd: cwdName(),
		});

	const refresh = async (): Promise<void> => {
		if (!cmd.ui.capabilities.status) return;
		if (refreshing) {
			pending = true;
			return;
		}
		refreshing = true;
		try {
			if (flag('git', true)) await readGit(false);
			cmd.ui.setStatus(composer() || null);
		} finally {
			refreshing = false;
			if (pending) {
				pending = false;
				void refresh();
			}
		}
	};

	const startTimer = (): void => {
		const seconds = flagNumber('refresh', 10, 3600);
		if (seconds <= 0 || timer) return;
		timer = setInterval(() => {
			gitCheckedAt = 0;
			void refresh();
		}, seconds * 1000);
		timer.unref?.();
	};

	const stopTimer = (): void => {
		if (!timer) return;
		clearInterval(timer);
		timer = undefined;
	};

	const onResize = (): void => {
		void refresh();
	};

	cmd.hooks({
		onSessionStart: info => {
			const data = info as unknown as SessionEvent;
			if (typeof data.sessionId === 'string') sessionId = data.sessionId;
			seedTitle();
			void seedCost();
			startTimer();
			// 幂等：会话被替换时若 start 再次触发，避免监听器叠加
			process.stdout.off('resize', onResize);
			process.stdout.on('resize', onResize);
			void refresh();
		},
		onSessionEnd: () => {
			stopTimer();
			process.stdout.off('resize', onResize);
			cmd.ui.setStatus(null);
		},
	});

	cmd.on('run_start', event => {
		const data = event as unknown as SessionEvent;
		if (!sessionId && typeof data.sessionId === 'string') sessionId = data.sessionId;
		seedTitle();
		void seedCost();
		void refresh();
	});

	cmd.on('session_titled', event => {
		const data = event as unknown as {title?: unknown};
		if (typeof data.title === 'string' && data.title.trim()) {
			snapshot.title = data.title;
		}
		void refresh();
	});

	cmd.on('model_request_start', event => {
		const data = event as unknown as ModelEvent;
		if (typeof data.model === 'string') snapshot.model = data.model;
		requestStartedAt = Date.now();
		void refresh();
	});

	cmd.on('model_request_end', event => {
		const data = event as unknown as ModelEvent;
		if (typeof data.model === 'string') snapshot.model = data.model;
		if (typeof data.effort === 'string') snapshot.effort = data.effort;
		if (typeof data.usage?.inputTokens === 'number') {
			snapshot.contextTokens = data.usage.inputTokens;
		}
		if (data.usage) {
			const hit = cacheHitRate(data.usage);
			if (hit !== undefined) snapshot.cacheHit = hit;
			const cost = estimateCost(data.usage, snapshot.model);
			if (cost > 0) {
				sessionCost += cost;
				updateCost();
			}
			const output = data.usage.outputTokens ?? 0;
			const elapsed = (Date.now() - requestStartedAt) / 1000;
			if (requestStartedAt > 0 && elapsed > 0 && output > 0) {
				snapshot.speed = output / elapsed;
			}
		}
		void refresh();
	});

	// 子代理的模型请求不走 model_request_*（实测），用量只能从 subagent_stop 折进来；
	// 产品自身也不把子代理 token 计入 transcript，故这里只累计 token、不改动精确花费。
	cmd.on('subagent_stop', event => {
		const data = event as unknown as SubagentStopEvent;
		if (typeof data.tokensUsed === 'number' && data.tokensUsed > 0) {
			snapshot.subTokens += data.tokensUsed;
			void refresh();
		}
	});

	cmd.on('turn_end', () => void refresh());

	cmd.on('config_setting_changed', event => {
		const data = event as unknown as ConfigChangedEvent;
		if (data.setting === 'model' && typeof data.value === 'string') {
			snapshot.model = data.value;
		}
		void refresh();
	});

	cmd.addCommand({
		name: 'statusline',
		description: '查看状态栏内容与数据来源（模型 / effort / 上下文 / 缓存 / 花费 / 速度 / 子代理 / session 名 / git）',
		handler: () => {
			const plain = composeLine(snapshot, segments(), {
				color: false,
				rawModel: true,
				mode: 'ascii',
				barWidth: barWidth(),
				maxWidth: 0,
				cwd: cwdName(),
			});
			const window = contextWindowFor(snapshot.model);
			const priced = modelPriceFor(snapshot.model) !== undefined;
			const subEstimate =
				snapshot.subTokens > 0 && snapshot.costUsd > 0 && snapshot.contextTokens
					? (snapshot.costUsd / snapshot.contextTokens) * snapshot.subTokens
					: 0;
			const state = [
				`model=${snapshot.model ?? '-'}`,
				`effort=${snapshot.effort ?? '-'}`,
				`ctx=${snapshot.contextTokens ? formatTokens(snapshot.contextTokens) : '-'}${
					window ? `/${formatWindow(window)}` : '（窗口未知）'
				}`,
				`cache=${snapshot.cacheHit !== undefined ? formatRate(snapshot.cacheHit) : '-'}`,
				`cost=${snapshot.costUsd > 0 ? formatCost(snapshot.costUsd) : '-'}${
					seededCost > 0 ? `（含恢复 ${formatCost(seededCost)}）` : ''
				}${priced ? '' : '（单价未知）'}`,
				`speed=${snapshot.speed ? `${Math.round(snapshot.speed)} tok/s` : '-'}`,
				`sub=${snapshot.subTokens > 0 ? `${formatTokens(snapshot.subTokens)}（约 ${formatCost(subEstimate)}，未计入上面 cost）` : '-'}`,
				`name=${snapshot.title ?? '-'}`,
				`git=${snapshot.isRepo ? (snapshot.branch ?? '-') : '非仓库'}`,
				`render=${asciiOnly() ? 'ascii' : colorMode()}`,
				`width=${terminalWidth() || '未知'}`,
				`config=${configSources.length > 0 ? configSources.join(' + ') : '内置默认'}`,
				`footer=${cmd.ui.capabilities.status ? '渲染中' : '本运行不渲染（headless）'}`,
			].join(' | ');
			return {message: `状态栏：${plain}\n数据：${state}`};
		},
	});
}
