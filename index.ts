// Command Code mod：输入框下方状态栏
// 段位：模型 / effort / 上下文进度条 / 缓存命中 / 会话花费 / 输出速度 / 子代理用量 /
//       session 名 / git 分支与改动 / 当前目录名
//
// 部署：cp index.ts ~/.commandcode/mods/statusline.ts
//       （或装包：cmd mods add holtwood/cmdc-statusline -g；试跑不安装：cmd --mod ./index.ts）
// 要求：cmdc ≥ MIN_HOST_VERSION（当前 1.10.0）。旧宿主不做兼容——加载时检测到偏旧就停用：只在消息区
//       留一条升级提示，flag / 命令 / hook / 底栏一概不注册。版本读不出来时按可用处理（不猜）。
// 背景：cmdc 没有 Claude Code 式的 statusLine 外部命令钩子，mod 的 cmd.ui.setStatus 是唯一
// 能在输入框下方渲染常驻状态段的接口（见 mod-builder reference/ui.md），本 mod 按此实现。
// 内置两张表（上下文窗口 / 单价）由 scripts/gen-model-tables.py 从产品模型清单生成，勿手改。
// 花费为「会话累计」＝ 恢复时从 transcript 求和的历史部分 + 本进程新产生的部分（重启不清零）。
// 除了花费，恢复时同一遍扫描还会种入最后一轮请求的 model/effort/上下文/缓存命中；刚开 cmdc、
// 还没有任何请求时，model/effort 先从 ~/.commandcode/config.json 画出来——否则底栏要等到
// 第一次 model_request_end 才补齐，中间那段只剩 git 与目录名。
//
// 配置（优先级：内置默认 < preset < 用户级 < 项目级 < 命令行）：
//   ~/.commandcode/statusline.json          用户级
//   <项目>/.commandcode/statusline.json     项目级（覆盖用户级）
//   --mod-option statusline.<键>=<值>       命令行（仅在取值与内置默认不同时才判定为显式覆盖——
//                                           cmdc 会把 --mod-option 的值从 mod 可见的 argv 里抹掉，
//                                           故无法精确区分「显式传了默认值」）
//   可用键：model/effort/context/bar/bar-width/percent/cache/cost/speed/sub/name/git/cwd/
//          preset/raw-model/ascii/refresh/lang（lang=zh|en 只影响报告与弹窗文案）
//   preset：full（全部，默认）/ minimal（模型+effort+上下文+分支）/ usage（上下文+缓存+花费+子代理）。
//           它只决定「哪些段位开」，写死某个键即可覆盖它；渲染开关（ascii/raw-model）与它无关。
//
// 为什么 flag 名有前缀、配置键没有：宿主把 mod 的 flag 取值放在一张进程级共享表里按名字索引
// （实测：addFlag 写默认值时先到先得，getFlag 一律从这张表读，--mod-option 的类型由第一个
// 声明者决定）——两个 mod 声明同名 flag 就会静默串值，撞名的另一方连自己的默认值都读不到。
// 配置文件没有这个问题：statusline.json 这个文件名本身就是它的命名空间。所以只有发往宿主的
// flag 名带 statusline. 前缀，键名（JSON、报告表、选择器）保持短名；flagName() 是唯一派生点。
//
// 自助排错与配置（不需要翻 README）：
//   /statusline         打印「键 / 默认 / 生效 / 来源」全表，并把 JSON 里的未知键（拼错）与
//                       类型不对的键单独报警；文件来源也一并列出
//   /statusline config  用 cmd.ui.select/input/confirm 交互式改，选完即写入并立刻重绘，无需 /reload
//
// 窄终端：按优先级降级（先丢 cwd→速度→effort→子代理→缓存→session 名→花费→改动数，
//         上下文由「条+token+百分比」逐级退化，支路最后丢，模型永不丢），并监听 resize 立即重绘。

import {createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import {createInterface} from 'node:readline';
// ModApi 的类型不在任何已发布包里（@commandcode/harness 未发布）——用仓库里的本地声明，
// 只供 tsc --noEmit 校验；运行时 import type 被整个擦除，不解析、不影响单文件投放。
import type {ModApi} from './mod-api.js';

// ── 类型 ────────────────────────────────────────────────────────────────────────────
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
	isRepo: boolean;
	branch?: string;
	ahead: number;
	behind: number;
	staged: number;
	modified: number;
	untracked: number;
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

// 一次会话的全套可变状态收在一个对象里：mod 在进程里只装一次，宿主却会在同进程换会话
// （onSessionEnd 的 reason 有 'replaced' —— navigateTree / resume 另一条会话都走这条路）。
// id 变了就整体重建：名字/花费/seed 标记一个都不能漏给下一个会话。
// 新字段必须进 freshSession() —— 类型逼着这么做，不存在「加了字段忘了重置」。
type SessionState = {
	id?: string;
	seeded: boolean;
	seededCost: number;
	sessionCost: number;
	/** transcript 有 usage/model 行但行尾锚全空 → 格式可能变了，报告里点名 */
	seedDrifted: boolean;
	snapshot: Snapshot;
};

const freshSession = (id?: string): SessionState => ({
	id,
	seeded: false,
	seededCost: 0,
	sessionCost: 0,
	seedDrifted: false,
	snapshot: {
		isRepo: false,
		ahead: 0,
		behind: 0,
		staged: 0,
		modified: 0,
		untracked: 0,
		costUsd: 0,
		subTokens: 0,
	},
});

type ComposeOptions = {
	readonly color: boolean;
	readonly rawModel: boolean;
	readonly mode: ColorMode;
	readonly barWidth: number;
	readonly maxWidth?: number;
	readonly cwd?: string;
};

type ColorMode = 'truecolor' | 'ansi256' | 'ascii';

type Config = Record<string, unknown>;

// ── 常量 ────────────────────────────────────────────────────────────────────────────
const SEP = ' │ ';
const GIT_TTL_MS = 5000;
const GIT_TIMEOUT_MS = 10_000;
const TITLE_COLUMNS = 24;
const COST_WARN_USD = 1;
const COST_ALERT_USD = 10;

// 慢仓库的自适应退避：放行间隔 = max(GIT_TTL_MS, GIT_BACKOFF × 上次实测耗时)，
// 也就是「git 最多占 20% 的墙钟时间」。正常仓库永远被 5 秒地板罩住，行为与从前完全一致。
const GIT_BACKOFF = 5;

// 窄终端降级的循环上界，见 composeLine：正常永远撞不到，是给逻辑 bug 兜底的
const DROP_STEPS_MAX = 64;

export function gitGapMs(durationMs: number): number {
	return Math.max(GIT_TTL_MS, GIT_BACKOFF * Math.max(0, durationMs));
}

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

// 窄终端丢弃顺序：数字越大越先丢；0 = 永不丢。
// 注意这里的键不是 flag 键：git 一段在渲染时拆成 gitBranch / gitChanges 两个条目，
// 各自有一个在这里的排名。条目键的类型就取自这张表（DropKey），所以 push() 里写错名字
// 是编译错误，不会像从前那样静默落到一个中间优先级上。
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

type DropKey = keyof typeof DROP_ORDER;

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

// ── 纯函数：格式化、宽度、颜色、git 解析、组装 ──────────────────────────────────────
// 这两张表在文件末尾的生成区（机器写入）—— 用表只经这两个口子，别处不要直接索引
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
	const entries: {key: DropKey; priority: number; variants: string[]}[] = [];
	const push = (key: DropKey, variants: string[]): void => {
		const filled = variants.filter(Boolean);
		if (filled.length > 0) {
			entries.push({key, priority: DROP_ORDER[key], variants: filled});
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
		// 每轮要么把某个条目的变体降一级、要么把它整个丢掉，所以轮数本就有上界；
		// DROP_STEPS_MAX 是给「算宽度 / 丢条目」这套逻辑本身出 bug 时兜底的（别转死循环）。
		let guard = 0;
		while (visibleLength(joined()) > maxWidth && guard < DROP_STEPS_MAX) {
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

// ── flag 注册表（键名的唯一事实来源） ───────────────────────────────────────────────
type FlagSpec = {
	readonly name: string;
	readonly type: 'boolean' | 'string';
	readonly default: boolean | string;
	readonly description: string;
	readonly descriptionEn: string;
	readonly segment?: boolean;
	/** 数值键：取值必须能解析成非负数字（字符串或数字都收） */
	readonly numeric?: boolean;
	readonly max?: number;
};

// 键的唯一事实来源：addFlag、/statusline 的表、交互式选择器都读这里，不再各写一份
const FLAG_SPECS: readonly FlagSpec[] = [
	{name: 'model', type: 'boolean', default: true, description: '显示当前模型', descriptionEn: 'show the active model', segment: true},
	{name: 'effort', type: 'boolean', default: true, description: '显示 thinking effort', descriptionEn: 'show the thinking effort', segment: true},
	{name: 'context', type: 'boolean', default: true, description: '显示上一次请求的上下文 token 数', descriptionEn: 'context tokens of the last request', segment: true},
	{name: 'bar', type: 'boolean', default: true, description: '用渐变进度条显示上下文占窗（需命中内置窗口表）', descriptionEn: 'gradient bar of context window share (needs a known window)', segment: true},
	{name: 'percent', type: 'boolean', default: true, description: '显示上下文占模型窗口的百分比', descriptionEn: 'context share of the model window', segment: true},
	{name: 'cache', type: 'boolean', default: true, description: '显示上一次请求的缓存命中率', descriptionEn: 'cache hit rate of the last request', segment: true},
	{name: 'cost', type: 'boolean', default: true, description: '显示本次会话累计花费（按内置单价表推算）', descriptionEn: 'session cost (estimated via the built-in price table)', segment: true},
	{name: 'speed', type: 'boolean', default: true, description: '显示上一次请求的输出速度（tok/s）', descriptionEn: 'output speed of the last request (tok/s)', segment: true},
	{name: 'sub', type: 'boolean', default: true, description: '显示子代理（agent 工具）累计消耗 token', descriptionEn: 'tokens burned by sub-agents', segment: true},
	{name: 'name', type: 'boolean', default: true, description: '显示 session 名', descriptionEn: 'show the session name', segment: true},
	{name: 'git', type: 'boolean', default: true, description: '显示 git 分支与改动数', descriptionEn: 'git branch + changes', segment: true},
	{name: 'cwd', type: 'boolean', default: true, description: '显示当前目录名', descriptionEn: 'current directory basename', segment: true},
	{name: 'preset', type: 'string', default: 'full', description: '字段预设：full / minimal / usage（单个键可覆盖预设）', descriptionEn: 'segment preset: full / minimal / usage (a single key overrides it)'},
	{name: 'bar-width', type: 'string', default: '12', description: '进度条格数', descriptionEn: 'bar width in cells', numeric: true, max: 40},
	{name: 'raw-model', type: 'boolean', default: false, description: '模型显示完整 id（不省略 vendor 前缀）', descriptionEn: 'full model id (keep the vendor prefix)'},
	{name: 'ascii', type: 'boolean', default: false, description: '纯 ASCII 渲染（无 Unicode 块、无颜色）', descriptionEn: 'plain ASCII rendering (no Unicode blocks, no colour)'},
	{name: 'refresh', type: 'string', default: '10', description: '刷新间隔秒数（0 = 关闭定时刷新）', descriptionEn: 'seconds between git re-reads (0 disables polling)', numeric: true, max: 3600},
	{name: 'lang', type: 'string', default: 'zh', description: '界面语言：zh / en', descriptionEn: 'ui language: zh / en'},
];

const FLAG_BY_NAME = new Map(FLAG_SPECS.map(spec => [spec.name, spec]));

// 「键」与「flag 名」是同一个东西的两副名字：键是 statusline.json 里的短名（也是报告表与
// 选择器里的名字），flag 名是发给宿主的那份，必须带前缀——宿主的 flag 取值表是进程级共享、
// 按名字索引的，不加前缀就会和别的 mod 撞（见文件头）。派生只有这一处：改前缀就全改。
export function flagName(key: string): string {
	return `statusline.${key}`;
}

// ── 预设与取值的校验 / 归一化 ───────────────────────────────────────────────────────
// 预设只决定段位开关，没列出的键按「关」算（否则 minimal 不 minimal）
const PRESETS: Record<string, Record<string, boolean>> = {
	full: {
		model: true,
		effort: true,
		context: true,
		bar: true,
		percent: true,
		cache: true,
		cost: true,
		speed: true,
		sub: true,
		name: true,
		git: true,
		cwd: true,
	},
	minimal: {model: true, effort: true, context: true, bar: true, percent: true, git: true},
	usage: {context: true, bar: true, percent: true, cache: true, cost: true, sub: true},
};

const PRESET_NAMES = ['full', 'minimal', 'usage'];

function isPresetName(value: unknown): boolean {
	return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PRESETS, value);
}

// 预设对某个键的取值；不是段位键（ascii/raw-model/refresh…）或预设名不认识时返回 undefined
function presetValue(preset: string, key: string): boolean | undefined {
	if (!FLAG_BY_NAME.get(key)?.segment || !isPresetName(preset)) return undefined;
	return PRESETS[preset][key] ?? false;
}

// 配置文件里这个取值能不能用：布尔键必须是布尔；数字键允许 number 或数字字符串，但得解析得出非负数；
// 其余字符串键（目前只有 preset）只收字符串 —— 否则 {"preset": 123} 会被判为「可用」，
// 诊断表照抄 123 报成生效值，而 presetName() 只认字符串、实际走的是 full：又是表在撒谎。
function acceptsValue(spec: FlagSpec, value: unknown): boolean {
	if (spec.type === 'boolean') return typeof value === 'boolean';
	if (spec.numeric) {
		if (typeof value !== 'string' && typeof value !== 'number') return false;
		const parsed = Number(value);
		return Number.isFinite(parsed) && parsed >= 0;
	}
	return typeof value === 'string';
}

type Lang = 'zh' | 'en';

// lang 键的归一化：zh / zh-CN / en / en-US 都认；其余返回 undefined（诊断会点名 + 回落 zh）
function langOf(value: unknown): Lang | undefined {
	if (typeof value !== 'string') return undefined;
	const head = value.trim().toLowerCase();
	if (head === 'zh' || head.startsWith('zh-') || head.startsWith('zh_')) return 'zh';
	if (head === 'en' || head.startsWith('en-') || head.startsWith('en_')) return 'en';
	return undefined;
}

function describeExpectation(spec: FlagSpec, lang: Lang = 'zh'): string {
	if (spec.numeric) return lang === 'en' ? 'non-negative number' : '非负数字';
	return spec.type === 'boolean' ? 'true / false' : lang === 'en' ? 'string' : '字符串';
}

// 数值键的规范化：解析得出非负数就取整数并按 max 截断，否则回落默认。
// flagNumber() 与诊断表都走这里 —— 否则配置写 bar-width: 100 时，表里报 100、底栏用的是 40。
function clampedNumber(spec: FlagSpec, value: unknown): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) return Number(spec.default);
	return Math.min(spec.max ?? Number.MAX_SAFE_INTEGER, Math.floor(parsed));
}

// preset / lang 名大小写不敏感（presetName() 与 langOf() 也是这么归一化的）：这里不改，
// 诊断表就会把 "Minimal" / "EN" 原样报出来 —— 与实际生效的值对不上
function canonical(spec: FlagSpec, value: unknown): unknown {
	if (typeof value !== 'string') return value;
	if (spec.name === 'preset') return value.toLowerCase();
	// en-US → en；不认识的值原样保留，诊断表照实报出、实际按 zh 走
	if (spec.name === 'lang') return langOf(value) ?? value;
	return value;
}

// ── 配置文件（路径、读取、写入） ────────────────────────────────────────────────────
function userConfigPath(): string {
	return join(homedir(), '.commandcode', 'statusline.json');
}

function projectConfigPath(cwd: string): string {
	return join(cwd, '.commandcode', 'statusline.json');
}

type ConfigLoad = {
	readonly config: Config;
	readonly sources: readonly string[];
	/** 每个键最后是被哪份文件设上的（诊断表要按这个报来源） */
	readonly origin: Record<string, string>;
	/** 文件在、但读不动（JSON 非法 / 顶层不是对象）：静默跳过会让「改了没反应」无从解释 */
	readonly broken: readonly string[];
};

// Windows 记事本存 UTF-8 会带 BOM，JSON.parse 见到它直接抛 —— 以前这种文件会被整份忽略，
// 用户看到的是「配置没生效」，可文件内容明明是对的。读的时候先剥掉。
function stripBom(text: string): string {
	return text.startsWith('\uFEFF') ? text.slice(1) : text;
}

export function loadConfig(cwd: string): ConfigLoad {
	// 无原型：不然文件里的 "__proto__" 键会改掉 config 的原型，config[name] 就吃到继承来的值，
	// 而 origin 里没有它 —— 诊断表会把「文件里的值」谎报成「内置默认」。origin 同理。
	const config: Config = Object.create(null) as Config;
	const origin: Record<string, string> = Object.create(null) as Record<string, string>;
	const sources: string[] = [];
	const broken: string[] = [];
	for (const path of [userConfigPath(), projectConfigPath(cwd)]) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(stripBom(readFileSync(path, 'utf8')));
		} catch {
			if (existsSync(path)) broken.push(path);
			continue;
		}
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			broken.push(path);
			continue;
		}
		for (const [key, value] of Object.entries(parsed as Config)) {
			config[key] = value;
			origin[key] = path;
		}
		sources.push(path);
	}
	return {config, sources, origin, broken};
}

// 读-改-写：保留文件里其它键（包括我们不认识的——那是用户自己的东西）
export function writeConfigKey(path: string, key: string, value: unknown): void {
	let current: Record<string, unknown> = {};
	if (existsSync(path)) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(stripBom(readFileSync(path, 'utf8')));
		} catch {
			// 覆盖坏文件会把用户原有的键整份抹掉：宁可拒绝，让他先修好
			throw new Error(`${path} 不是合法 JSON，已放弃写入`);
		}
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			throw new Error(`${path} 的顶层不是对象，已放弃写入`);
		}
		current = parsed as Record<string, unknown>;
	}
	current[key] = value;
	mkdirSync(dirname(path), {recursive: true});
	// 先写临时文件再原子改名：直接写目标文件，中途崩溃会留下半个 JSON，
	// 下次加载被当坏文件整份忽略 —— 用户看到的是「配置全丢了」而不是「上次写挂了」
	const tmp = `${path}.${process.pid}.tmp`;
	try {
		writeFileSync(tmp, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
		renameSync(tmp, path);
	} catch (error) {
		// 写半截的 tmp 留在配置目录里只是垃圾；清不掉也别盖住原始错误
		try {
			rmSync(tmp, {force: true});
		} catch {}
		throw error;
	}
}

// ── 宿主版本闸门 ────────────────────────────────────────────────────────────────────
// 下限是查出来的，不是拍脑袋定的：抓 npm 上相邻两版的 dist/cli.mjs 直接比对
// （1.9.0 / 1.10.0），再在 1.20 / 1.30 / 1.40 / 1.50 / 1.54 上复验。
// 最晚出现的依赖是 cmd.ui.capabilities —— mod 靠它判断这个宿主到底渲不渲染底栏。
// 1.9.0 的 ModUi 上还没有这个属性（该版本里 capabilities 只出现在 MCP 协议与提示词文本中），
// 于是 cmd.ui.capabilities.status 会直接抛 TypeError：不是降级，是崩。1.10.0 起才有。
// 其余依赖（对话框、subagent_stop / session_titled / config_setting_changed 事件、
// model_request_end 上的 effort、transcript 行尾形状、exec 的 signal、run_start 的 sessionId）
// 在 1.10.0 上已全部存在；且 ModUi 的 confirm/select/input/capabilities 实现（把压缩后的
// 标识符名归一化后）在 1.10.0 与 1.54.0 上完全相同 —— 不只是「在」，语义也不随版本漂。
export const MIN_HOST_VERSION = '1.10.0';

// 宿主版本：cmd 的表面没有任何 version 字段（探针实测 cmd 的键里没有），只能从 CLI 入口旁边的
// package.json 读。读不到就返回 undefined —— 那时一律不做版本判断，免得凭空误报。
export function hostVersion(): string | undefined {
	try {
		const entry = process.argv?.[1];
		if (!entry) return undefined;
		const manifest = JSON.parse(
			readFileSync(join(dirname(entry), '..', 'package.json'), 'utf8'),
		) as {name?: unknown; version?: unknown};
		// argv[1] 不一定是 cmdc（跑测试时就是测试文件本身）：名字对不上就不认
		if (manifest.name !== 'command-code') return undefined;
		// 只认以数字开头的版本号：""、"unknown" 这类根本没法比较，必须当成「读不到」。
		// 否则它们会被解析成 0 去比 MIN_HOST_VERSION，把一个好端端的安装判成过旧、直接停用。
		if (typeof manifest.version !== 'string' || !/^\d/.test(manifest.version)) return undefined;
		return manifest.version;
	} catch {
		return undefined;
	}
}

export function versionAtLeast(actual: string, minimum: string): boolean {
	const parts = (text: string): number[] =>
		text.split('.').map(part => Number.parseInt(part, 10) || 0);
	const left = parts(actual);
	const right = parts(minimum);
	for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
		const a = left[index] ?? 0;
		const b = right[index] ?? 0;
		if (a !== b) return a > b;
	}
	return true;
}

// ── 会话数据（transcript / meta / 用户配置） ────────────────────────────────────────
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

type SessionSeed = {
	readonly costUsd: number;
	readonly model?: string;
	readonly effort?: string;
	readonly usage?: Usage;
	/** transcript 里有 usage+model 记录、但行尾锚一条都没匹配上 → 产品的记录格式可能变了 */
	readonly drifted?: boolean;
};

// 助手消息条目把 usage / model / effort 排在行尾（内容体在前面）：
// {"type":"message",…,"message":{…},"usage":{…},"model":"…","effort":"…"}
// 行尾锚定是为了不被消息正文里长得很像的文本骗到。
const ASSISTANT_TAIL = /"usage":\{([^}]*)\},"model":"([^"]+)"(?:,"effort":"([^"]+)")?\}$/;

function usageFromFields(fields: string): Usage {
	const number = (key: string): number | undefined => {
		const match = new RegExp(`"${key}":(\\d+)`).exec(fields);
		return match ? Number(match[1]) : undefined;
	};
	return {
		inputTokens: number('inputTokens'),
		outputTokens: number('outputTokens'),
		cacheReadTokens: number('cacheReadTokens'),
		cacheWriteTokens: number('cacheWriteTokens'),
	};
}

// 会话累计花费 + 最后一轮请求的 model/effort/usage：一遍流式扫描全拿到（恢复会话时用，
// 让底栏一开就是上次的样子，不必等下一次请求）。只做正则抽取，不做 JSON.parse ——
// transcript 里单行可达上百 KB。
export async function readSessionSeed(
	sessionId: string,
	cwd: string,
): Promise<SessionSeed | undefined> {
	let reader: ReturnType<typeof createInterface> | undefined;
	try {
		reader = createInterface({
			input: createReadStream(sessionPath(sessionId, cwd, '.jsonl'), {
				encoding: 'utf8',
			}),
			crlfDelay: Infinity,
		});
		let total = 0;
		let model: string | undefined;
		let effort: string | undefined;
		let usage: Usage | undefined;
		// 计数而不只取「最后一条」：transcript 里同时带 usage 与 model 的行存在、但行尾锚
		// 一条都没中 → 行形状变了。没有这个信号，格式漂移会静默变成「花费归零/上下文消失」。
		let usageLines = 0;
		let tailHits = 0;
		for await (const line of reader) {
			if (line.includes('"costUsd"')) {
				for (const match of line.matchAll(/"costUsd":\s*([\d.eE+-]+)/g)) {
					const value = Number(match[1]);
					if (Number.isFinite(value)) total += value;
				}
			}
			if (line.includes('"usage"') && line.includes('"model"')) usageLines += 1;
			const tail = ASSISTANT_TAIL.exec(line);
			if (tail) {
				tailHits += 1;
				model = tail[2];
				effort = tail[3];
				usage = usageFromFields(tail[1]);
			}
		}
		return {costUsd: total, model, effort, usage, drifted: usageLines > 0 && tailHits === 0};
	} catch {
		return undefined;
	} finally {
		reader?.close();
	}
}

// cmdc 把「当前模型 + 各模型的 reasoning effort」记在 ~/.commandcode/config.json：
//   {"model":"deepseek/deepseek-v4.1-flash","reasoningEffort":{"deepseek/deepseek-v4.1-flash":"high"}}
// 刚开 cmdc 时没有任何请求可问，前两段（模型、effort）只能靠它先画出来。
export function readUserConfig(): {model?: string; reasoningEffort: Record<string, string>} {
	// 同样无原型：否则 config.json 里一个 "__proto__" 就能凭空造出一个 effort 显示出来
	const reasoningEffort: Record<string, string> = Object.create(null) as Record<string, string>;
	try {
		const parsed = JSON.parse(
			readFileSync(join(homedir(), '.commandcode', 'config.json'), 'utf8'),
		) as {model?: unknown; reasoningEffort?: unknown};
		if (parsed.reasoningEffort && typeof parsed.reasoningEffort === 'object') {
			for (const [key, value] of Object.entries(
				parsed.reasoningEffort as Record<string, unknown>,
			)) {
				if (typeof value === 'string') reasoningEffort[key] = value;
			}
		}
		return {...(typeof parsed.model === 'string' ? {model: parsed.model} : {}), reasoningEffort};
	} catch {
		return {reasoningEffort};
	}
}

// ── 界面文案（lang 键：zh 默认 / en） ───────────────────────────────────────────────
// flag 描述与版本闸门提示在注册期出文案，那会儿还没有 getFlag —— 只看配置文件里的 lang；
// 其余全部按生效 lang 实时切（写完 lang=en，下一条报告就是英文）。两个入口的取舍不同：
// 报告/弹窗每次取 currentLang()，注册期描述只读配置文件 —— CLI --mod-option lang=en 管不到
// 已经注册出去的描述文本，这是宿主的限制，不是这里能绕的。
const L10N = {
	zh: {
		builtin: '内置默认',
		userScope: '用户',
		projectScope: '项目',
		// 命令行这一条带 flag 全名：报告表里的键是短名，命令行上写的是带前缀的 flag 名
		cliFlag: (flag: string) => `命令行 (--mod-option ${flag})`,
		presetSource: (name: string) => `预设 ${name}`,
		on: '开',
		off: '关',
		userLevel: '用户级',
		projectLevel: '项目级',
		done: '完成',
		doneDesc: '结束配置',
		allProjects: '所有项目',
		thisProject: '只影响这个项目',
		scopeTitle: (preset: string) => `把配置写到哪一份？（当前预设 ${preset}）`,
		editorTitle: (scope: string, changed: number) =>
			`状态栏 · 写入${scope} · 本次已改 ${changed} 项`,
		presetTitle: '选一个预设（单个键仍可覆盖它）',
		langTitle: '选界面语言',
		numberTitle: (name: string, expect: string, max?: number) =>
			`${name}（${expect}${max === undefined ? '' : `，最大 ${max}`}）`,
		boolTitle: (name: string, desc: string) => `${name}：${desc}`,
		confirmTitle: (name: string, value: string) => `写入 ${name} = ${value}？`,
		confirmBody: (path: string, name: string, current: string, source: string, value: string) =>
			`${path}\n${name}: 当前 ${current}（${source}）→ 写入 ${value}`,
		writeFailed: (msg: string) => `写入失败：${msg}`,
		shadowed: (name: string, effective: string, source: string, scope: string) =>
			`${name} 实际生效的是 ${effective}（来源：${source}）—— 你刚写进${scope}的值被更高优先级盖住了，底栏不会变`,
		wrote: (path: string, changes: readonly string[]) =>
			`已写入 ${path}：\n${changes.map(change => `  ${change}`).join('\n')}`,
		noChanges: '没有改动。',
		needTui: `交互式配置需要 TUI 与交互面板（cmd.ui.select / input / confirm，需 cmdc ≥ ${MIN_HOST_VERSION}）。`,
		noModal: '这次运行没有交互面板（headless 下属正常）——没有写任何文件。',
		noModalShort: '交互式配置需要 TUI（headless 下选择器返回 undefined，不会写任何文件）。',
		lineLabel: '状态栏',
		dataLabel: '数据',
		colon: '：',
		configHead: '配置（键 / 默认 / 生效 / 来源）：',
		filesLabel: '文件',
		windowUnknown: '（窗口未知）',
		priceUnknown: '（单价未知）',
		notRepo: '非仓库',
		unknown: '未知',
		restored: (v: string) => `（含恢复 ${v}）`,
		subNote: (v: string) => `（约 ${v}，未计入上面 cost）`,
		requires: (v: string) => `（本 mod 要求 ≥ ${v}）`,
		rendering: '渲染中',
		headless: '本运行不渲染（headless）',
		activeTag: '（生效）',
		brokenTag: '（读不动）',
		noFilesNote: '（两份配置文件都没有生效 —— 生效值逐行看「来源」列：内置默认 / 预设 / 命令行）',
		brokenFile: (path: string) =>
			`${path} 读不动（JSON 非法或顶层不是对象）—— 已整体忽略，里面的键一个都没生效`,
		unknownKey: (key: string, source: string) => `未知键 "${key}"（${source}）—— 拼错了？`,
		badValue: (key: string, expect: string, actual: string, source: string) =>
			`"${key}" 的取值不可用：期望 ${expect}，实际 ${actual}（${source}）—— 已忽略`,
		unknownPreset: (value: string, source: string, effective: string) =>
			`未知预设 ${value}（${source}）—— 可用：${PRESET_NAMES.join(' / ')}；${
				effective === 'full' ? '已按 full 处理' : `当前生效的是 preset=${effective}`
			}`,
		unknownLang: (value: string, source: string, effective: string) =>
			`未知语言 ${value}（${source}）—— 可用：zh / en；${
				effective === 'zh' ? '已按 zh 处理' : `当前生效的是 lang=${effective}`
			}`,
		seedDrift:
			'transcript 里有 usage/model 记录，但一条都没按现有行尾格式解析出来 —— ' +
			'产品的 transcript 格式可能已变化，恢复出的花费/上下文可能不准',
		// 表里的键是短名，命令行上要写 flag 全名 —— 提示里按 flagName() 出，前缀改了它跟着改
		tip: `提示：/statusline config 交互式修改（选完即写入并立刻重绘，不用 /reload）；命令行覆盖写作 --mod-option ${flagName('<键>')}=<值>`,
		oldHost: (min: string, current: string) =>
			`statusline 需要 cmdc ≥ ${min}（当前 ${current}）：本 mod 不支持旧版本，已停用。请先更新 cmdc（cmdc update），再重开会话。`,
		slowGit: (durationS: string, intervalS: number, gapS: number) =>
			`本仓库 git status 用了 ${durationS}s（≥ refresh=${intervalS}s）：` +
			`已自动放慢到每 ${gapS}s 读一次。想彻底关掉轮询就把 refresh 设为 0。`,
	},
	en: {
		builtin: 'builtin',
		userScope: 'user',
		projectScope: 'project',
		cliFlag: (flag: string) => `CLI (--mod-option ${flag})`,
		presetSource: (name: string) => `preset ${name}`,
		on: 'On',
		off: 'Off',
		userLevel: 'User level',
		projectLevel: 'Project level',
		done: 'Done',
		doneDesc: 'finish',
		allProjects: 'all projects',
		thisProject: 'this project only',
		scopeTitle: (preset: string) => `Which file should config go to? (current preset: ${preset})`,
		editorTitle: (scope: string, changed: number) =>
			`Status line · writing ${scope} · ${changed} changed this run`,
		presetTitle: 'Pick a preset (a single key can still override it)',
		langTitle: 'Pick the ui language',
		numberTitle: (name: string, expect: string, max?: number) =>
			`${name} (${expect}${max === undefined ? '' : `, max ${max}`})`,
		boolTitle: (name: string, desc: string) => `${name}: ${desc}`,
		confirmTitle: (name: string, value: string) => `Write ${name} = ${value}?`,
		confirmBody: (path: string, name: string, current: string, source: string, value: string) =>
			`${path}\n${name}: current ${current} (${source}) → write ${value}`,
		writeFailed: (msg: string) => `Write failed: ${msg}`,
		shadowed: (name: string, effective: string, source: string, scope: string) =>
			`${name} still resolves to ${effective} (source: ${source}) — the value just written to ${scope} is overridden by higher precedence; the line won't change`,
		wrote: (path: string, changes: readonly string[]) =>
			`Wrote ${path}:\n${changes.map(change => `  ${change}`).join('\n')}`,
		noChanges: 'No changes.',
		needTui: `Interactive config needs the TUI interaction modal (cmd.ui.select / input / confirm, requires cmdc ≥ ${MIN_HOST_VERSION}).`,
		noModal: 'No interaction modal this run (expected headless) — nothing was written.',
		noModalShort: 'Interactive config needs the TUI (select returns undefined headless; nothing was written).',
		lineLabel: 'Status line',
		dataLabel: 'Data',
		colon: ': ',
		configHead: 'Config (key / default / effective / source):',
		filesLabel: 'Files',
		windowUnknown: ' (window unknown)',
		priceUnknown: ' (price unknown)',
		notRepo: 'not a repo',
		unknown: 'unknown',
		restored: (v: string) => ` (incl. restored ${v})`,
		subNote: (v: string) => ` (~${v}, not counted in cost above)`,
		requires: (v: string) => ` (requires ≥ ${v})`,
		rendering: 'rendering',
		headless: 'not rendered this run (headless)',
		activeTag: ' (active)',
		brokenTag: ' (unreadable)',
		noFilesNote: '(neither config file took effect — check the source column per row: builtin / preset / CLI)',
		brokenFile: (path: string) =>
			`${path} is unreadable (invalid JSON or top level is not an object) — ignored entirely; no key applied`,
		unknownKey: (key: string, source: string) => `unknown key "${key}" (${source}) — typo?`,
		badValue: (key: string, expect: string, actual: string, source: string) =>
			`"${key}" has an unusable value: expected ${expect}, got ${actual} (${source}) — ignored`,
		unknownPreset: (value: string, source: string, effective: string) =>
			`unknown preset ${value} (${source}) — valid: ${PRESET_NAMES.join(' / ')}; ${
				effective === 'full' ? 'treated as full' : `effective preset=${effective}`
			}`,
		unknownLang: (value: string, source: string, effective: string) =>
			`unknown lang ${value} (${source}) — valid: zh / en; ${
				effective === 'zh' ? 'treated as zh' : `effective lang=${effective}`
			}`,
		seedDrift:
			'the transcript has usage/model records but none matched the expected tail shape — ' +
			'the internal format may have changed; restored cost/context may be off',
		tip: `Tip: /statusline config edits interactively (writes + repaints right away, no /reload); a CLI override reads --mod-option ${flagName('<key>')}=<value>`,
		oldHost: (min: string, current: string) =>
			`statusline requires cmdc ≥ ${min} (current ${current}): old hosts are not supported; disabled. Update cmdc (cmdc update) and reopen the session.`,
		slowGit: (durationS: string, intervalS: number, gapS: number) =>
			`git status took ${durationS}s in this repo (≥ refresh=${intervalS}s): ` +
			`polling slowed to every ${gapS}s. Set refresh=0 to stop polling entirely.`,
	},
} as const;

// 两份文案形状必须完全一致；字符串字段宽化成 string，让 zh/en 可互赋
type Strings = {readonly [K in keyof (typeof L10N)['zh']]: (typeof L10N)['zh'][K] extends string ? string : (typeof L10N)['zh'][K]};

// ── mod 工厂 ────────────────────────────────────────────────────────────────────────
export default function (cmd: ModApi): void {
	// 配置文件先读（纯文件 IO，不依赖任何已注册的 flag）：版本提示与 flag 描述的语言
	// 都只看文件里的 lang —— 这两个文案在注册期就要出，那会儿 getFlag 还不可用。
	let {config, sources: configSources, origin: configOrigin, broken: configBroken} = loadConfig(
		cmd.cwd,
	);
	const fileLang = langOf(config['lang']) ?? 'zh';

	// 版本闸门：本 mod 不支持旧宿主，也不做降级。
	// 读到版本且确实偏旧 → 提示升级后立即停用，连 flag 与命令都不注册 ——
	// 宁可什么都不做，也不要留下一个「有反应但不正确」的底栏。
	// 版本读不到时不猜（那种情况下无从判断，按可用处理，报告里标成 cmdc=未知）。
	const host = hostVersion();
	if (host !== undefined && !versionAtLeast(host, MIN_HOST_VERSION)) {
		const message = L10N[fileLang].oldHost(MIN_HOST_VERSION, host);
		try {
			cmd.ui.notify(message, 'error');
		} catch {
			// 老宿主的 notice 通道不一定在，兜底打到终端，别让提示彻底消失
			console.error(message);
		}
		return;
	}

	for (const spec of FLAG_SPECS) {
		cmd.addFlag(flagName(spec.name), {
			type: spec.type,
			default: spec.default,
			// 描述文本此刻只能看配置文件里的 lang：flag 还没注册，CLI 覆盖无从谈起
			description: fileLang === 'en' ? spec.descriptionEn : spec.description,
		});
	}

	let session = freshSession();
	let requestStartedAt = 0;
	let timer: NodeJS.Timeout | undefined;
	// git 的自适应闸门：读完的时刻（不是开始的时刻）+ 上次实测耗时 + 是否已经为「慢」提醒过
	let gitFinishedAt = 0;
	let gitDurationMs = 0;
	let gitSlowNotified = false;
	let gitReading = false;

	const presetName = (): string => {
		const cli = cmd.getFlag(flagName('preset'));
		const configured = config['preset'];
		// 命令行只在「与内置默认不同」时才算显式覆盖（宿主会抹掉 argv 里的 =value）
		const raw =
			typeof cli === 'string' && cli !== 'full'
				? cli
				: typeof configured === 'string'
					? configured
					: 'full';
		return raw.toLowerCase();
	};

	// 生效来源是数据不是字符串：文案延迟到渲染处按当前 lang 出，
	// 否则 lang=en 的报告里会混进中文的「命令行/预设 x」。
	// CLI 那条带着键名：来源列要说清「命令行」具体是哪个 flag —— 报告和选择器里的名字是短键，
	// 命令行上要用的是带前缀的 flag 名，两副名字必须在这里对上。
	type FlagSource =
		| {kind: 'cli'; key: string}
		| {kind: 'file'; path?: string}
		| {kind: 'preset'; name: string}
		| {kind: 'default'};

	// 唯一的取值解析入口：flag() / flagNumber() / 诊断表都走它，
	// 这样「表里写的生效值」与「实际用的值」不可能漂移。
	// 优先级：命令行（异于内置默认）> 配置文件 > preset > 内置默认。
	const resolveFlag = (name: string): {value: unknown; source: FlagSource} => {
		const spec = FLAG_BY_NAME.get(name);
		const base = spec?.default;
		const cli = cmd.getFlag(flagName(name));
		if (spec && typeof cli === typeof base && cli !== base) {
			return {value: canonical(spec, cli), source: {kind: 'cli', key: name}};
		}
		const configured = config[name];
		if (spec && configured !== undefined && acceptsValue(spec, configured)) {
			return {value: canonical(spec, configured), source: {kind: 'file', path: configOrigin[name]}};
		}
		const preset = presetValue(presetName(), name);
		// 预设取值与内置默认相同时不报「预设 x」——那行字不含信息（full 就是内置默认的别名）
		if (preset !== undefined && preset !== base) {
			return {value: preset, source: {kind: 'preset', name: presetName()}};
		}
		return {value: preset ?? base, source: {kind: 'default'}};
	};

	const currentLang = (): Lang => langOf(resolveFlag('lang').value) ?? 'zh';
	const s = (): Strings => L10N[currentLang()];

	const sourceText = (source: FlagSource): string => {
		const t = s();
		switch (source.kind) {
			case 'cli':
				return t.cliFlag(flagName(source.key));
			case 'file':
				return source.path === undefined
					? t.builtin
					: source.path === userConfigPath()
						? t.userScope
						: t.projectScope;
			case 'preset':
				return t.presetSource(source.name);
			default:
				return t.builtin;
		}
	};

	// 键描述的语言也按生效 lang 实时切（注册期那份描述文本改不动，但交互列表是我们自己画的）
	const specDesc = (spec: FlagSpec): string =>
		currentLang() === 'en' ? spec.descriptionEn : spec.description;

	// 没有 fallback 参数：默认值只由注册表定，调用点再传一个只会有第二个「事实来源」
	const flag = (name: string): boolean => resolveFlag(name).value === true;

	// 上限取自注册表的 spec.max，不再由调用点各传一个（两处各写一份迟早会漂）
	const flagNumber = (name: string): number => {
		const spec = FLAG_BY_NAME.get(name);
		return spec ? clampedNumber(spec, resolveFlag(name).value) : 0;
	};

	const reloadConfig = (): void => {
		({config, sources: configSources, origin: configOrigin, broken: configBroken} = loadConfig(
			cmd.cwd,
		));
	};

	// JSON 里写了但我们不认识的键（拼错）、取值不可用的键、认不出的 preset / lang —— 全部点名，
	// 否则用户改了配置却毫无反馈，只会以为「这功能坏了」
	const configWarnings = (): string[] => {
		const t = s();
		const warnings: string[] = [];
		for (const [key, path] of Object.entries(configOrigin)) {
			const spec = FLAG_BY_NAME.get(key);
			if (!spec) {
				warnings.push(t.unknownKey(key, sourceText({kind: 'file', path})));
				continue;
			}
			if (!acceptsValue(spec, config[key])) {
				warnings.push(
					t.badValue(
						key,
						describeExpectation(spec, currentLang()),
						JSON.stringify(config[key]),
						sourceText({kind: 'file', path}),
					),
				);
			}
		}
		// 大小写不敏感，所以判定也要先归一化 —— 否则 {"preset":"Minimal"} 会被误报成未知预设
		const cliPreset = cmd.getFlag(flagName('preset'));
		const configured = config['preset'];
		const bogus =
			typeof cliPreset === 'string' && cliPreset !== 'full' && !isPresetName(cliPreset.toLowerCase())
				? {value: cliPreset, where: t.cliFlag(flagName('preset'))}
				: typeof configured === 'string' && !isPresetName(configured.toLowerCase())
					? {value: configured, where: sourceText({kind: 'file', path: configOrigin['preset']})}
					: undefined;
		if (bogus) {
			// 落点要按「实际会生效的那个预设」说：命令行压着配置时，说「已按 full 处理」就是假的
			const effective = isPresetName(presetName()) ? presetName() : 'full';
			warnings.push(t.unknownPreset(JSON.stringify(bogus.value), bogus.where, effective));
		}
		// lang 同 preset：字符串但认不出（如 "fr"）→ 点名 + 实际按 zh 走；非字符串已被上面 badValue 兜住
		const cliLang = cmd.getFlag(flagName('lang'));
		const confLang = config['lang'];
		const bogusLang =
			typeof cliLang === 'string' && cliLang !== 'zh' && langOf(cliLang) === undefined
				? {value: cliLang, where: t.cliFlag(flagName('lang'))}
				: typeof confLang === 'string' && langOf(confLang) === undefined
					? {value: confLang, where: sourceText({kind: 'file', path: configOrigin['lang']})}
					: undefined;
		if (bogusLang) {
			// 落点按「实际生效的」说，与 preset 同理：命令行 lang=en 压着文件里的坏值时，
			// 报「已按 zh 处理」就是在撒谎
			warnings.push(t.unknownLang(JSON.stringify(bogusLang.value), bogusLang.where, currentLang()));
		}
		return warnings;
	};

	const barWidth = (): number => flagNumber('bar-width');

	const asciiOnly = (): boolean => flag('ascii') || process.env.TERM === 'dumb';

	const colorEnabled = (): boolean => !process.env.NO_COLOR && !asciiOnly();

	const colorMode = (): ColorMode => {
		if (asciiOnly()) return 'ascii';
		return /truecolor|24bit/i.test(process.env.COLORTERM ?? '') ? 'truecolor' : 'ansi256';
	};

	const segments = (): Segments => ({
		model: flag('model'),
		effort: flag('effort'),
		context: flag('context'),
		bar: flag('bar'),
		percent: flag('percent'),
		cache: flag('cache'),
		cost: flag('cost'),
		speed: flag('speed'),
		sub: flag('sub'),
		name: flag('name'),
		git: flag('git'),
		cwd: flag('cwd'),
	});

	const terminalWidth = (): number => {
		const columns = process.stdout.columns ?? 0;
		if (!Number.isFinite(columns) || columns <= 0) return 0;
		return Math.max(20, columns - 2);
	};

	const cwdName = (): string | undefined => cwdBasename(cmd.cwd);

	const seedTitle = (): void => {
		const snapshot = session.snapshot;
		if (!flag('name') || !session.id || snapshot.title) return;
		const title = readSessionTitle(session.id, cmd.cwd);
		if (title) snapshot.title = title;
	};

	// 显示值 = 从 transcript 恢复的历史累计 + 本进程新产生的部分（两部分都只算一次，不会重复计）
	const updateCost = (): void => {
		session.snapshot.costUsd = session.seededCost + session.sessionCost;
	};

	// 配置里的模型 / effort：只补还空着的段，第一次请求回来之后就不必再读盘
	const seedFromConfig = (): void => {
		const snapshot = session.snapshot;
		if (snapshot.model && snapshot.effort) return;
		const {model, reasoningEffort} = readUserConfig();
		if (!snapshot.model && model) snapshot.model = model;
		if (!snapshot.effort && snapshot.model) snapshot.effort = reasoningEffort[snapshot.model];
	};

	// 事件携带 sessionId 且不是当前会话的 → 整条丢弃：会话被替换后，旧会话迟到的
	// 事件（在途请求收尾、titled、turn_end 等）不许写进新会话的状态。
	// 两边有一边不知道 id 就没法判，放行 —— 宁可多画一次，也不能把正常事件滤没了。
	const forCurrentSession = (event: unknown): boolean => {
		const id = (event as {sessionId?: unknown}).sessionId;
		return typeof id !== 'string' || session.id === undefined || id === session.id;
	};

	// 恢复会话：transcript 记录的是实际发生过的事，压过配置里读来的猜测值
	const seedSession = async (): Promise<void> => {
		if (session.seeded || !session.id) return;
		session.seeded = true;
		const snapshot = session.snapshot;
		const seed = await readSessionSeed(session.id, cmd.cwd);
		// await 期间会话可能已被换掉：那份 transcript 属于旧会话，整个丢弃
		if (!seed || session.snapshot !== snapshot) return;
		if (seed.drifted) session.seedDrifted = true;
		if (seed.costUsd > 0) session.seededCost = seed.costUsd;
		if (seed.model) snapshot.model = seed.model;
		if (seed.effort) snapshot.effort = seed.effort;
		if (seed.usage) {
			if (typeof seed.usage.inputTokens === 'number') {
				snapshot.contextTokens = seed.usage.inputTokens;
			}
			const hit = cacheHitRate(seed.usage);
			if (hit !== undefined) snapshot.cacheHit = hit;
		}
		updateCost();
		refresh();
	};

	// 开局能恢复的三件事：配置里的模型/effort、会话名、以及 transcript 里的历史累计。
	// 两个入口（onSessionStart 与 run_start）都要跑同一套 —— 谁先到都可能，重复跑是幂等的。
	const seedFromKnownSources = (): void => {
		seedFromConfig();
		seedTitle();
		void seedSession();
	};

	// 一次读的耗时超过配置的刷新间隔时提醒一次：这正是「用户不知道自己的仓库慢」那种不可见故障
	const noteSlowGit = (): void => {
		if (gitSlowNotified) return;
		const intervalMs = flagNumber('refresh') * 1000;
		if (intervalMs <= 0 || gitDurationMs < intervalMs) return;
		gitSlowNotified = true;
		cmd.ui.notify(
			s().slowGit(
				(gitDurationMs / 1000).toFixed(1),
				intervalMs / 1000,
				Math.round(gitGapMs(gitDurationMs) / 1000),
			),
			'warning',
		);
	};

	const readGit = async (): Promise<void> => {
		// 自适应闸门：慢仓库自己把间隔拉开（间隔取自「上次读完的时刻」，不是开始时刻——
		// 否则一次 8 秒的调用返回时 5 秒 TTL 早已过期，之后每个事件都会再触发一次）
		if (gitReading || Date.now() - gitFinishedAt < gitGapMs(gitDurationMs)) return;
		gitReading = true;
		const startedAt = Date.now();
		// 超时兜底：git 挂死（锁、死挂载、超大仓库）不能让这次读永远挂着
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
			// git 结果是仓库属性、不随会话变：写进「当前」会话（await 期间会话被换掉也不丢这次读）
			const snapshot = session.snapshot;
			snapshot.isRepo = info.isRepo;
			snapshot.branch = info.branch;
			snapshot.ahead = info.ahead;
			snapshot.behind = info.behind;
			snapshot.staged = info.staged;
			snapshot.modified = info.modified;
			snapshot.untracked = info.untracked;
		} catch {
			session.snapshot.isRepo = false;
			session.snapshot.branch = undefined;
		} finally {
			clearTimeout(killer);
			gitReading = false;
			gitDurationMs = Date.now() - startedAt;
			gitFinishedAt = Date.now();
			noteSlowGit();
			// git 回来后再画一次；慢仓库里它只是让 git 段位晚一点出现，不会拖住别的段位
			paint();
		}
	};

	const composer = (): string =>
		composeLine(session.snapshot, segments(), {
			color: colorEnabled(),
			rawModel: flag('raw-model'),
			mode: colorMode(),
			barWidth: barWidth(),
			maxWidth: terminalWidth(),
			cwd: cwdName(),
		});

	// 本运行到底渲不渲染底栏。两件事在这里合成一个判断：
	//   status === false  → 宿主明说了不画（headless）
	//   capabilities 缺席 → 1.9.0 那种旧宿主，版本闸门又是尽力而为的（版本读不出来时不猜、放行），
	//                       于是走到这里。直接取 .status 会让每次事件都变成一个 mod_error，
	//                       兜底成「什么都不画」比在用户会话里持续报错体面。
	// 报告里要区分这两种情况，所以那边不看这个函数，直接读三态。
	const rendersFooter = (): boolean => cmd.ui.capabilities?.status === true;

	// 重绘是同步且幂等的（宿主自己会去重相同文本），所以它永远不等 git：
	// 从前 refresh() 先 await git 再画，一个 8 秒的 git status 会把模型/花费/上下文一起卡 8 秒。
	const paint = (): void => {
		if (!rendersFooter()) return;
		cmd.ui.setStatus(composer() || null);
	};

	const refresh = (): void => {
		// 本运行不渲染底栏（headless）就什么都别做：连 git 进程都不该起
		if (!rendersFooter()) return;
		paint();
		// 该不该真去读 git 由 readGit 的自适应闸门决定；这里只管把请求发出去
		if (flag('git')) void readGit();
	};

	const startTimer = (): void => {
		const seconds = flagNumber('refresh');
		if (seconds <= 0 || timer) return;
		// 定时器的唯一职责是「外部改动」：进程内的事件本来就会刷新。
		// 它不再去 poke 时间戳强制读——放行与否统一由从实测耗时算出的闸门决定。
		timer = setInterval(() => refresh(), seconds * 1000);
		timer.unref?.();
	};

	const stopTimer = (): void => {
		if (!timer) return;
		clearInterval(timer);
		timer = undefined;
	};

	const onResize = (): void => {
		refresh();
	};

	cmd.hooks({
		onSessionStart: info => {
			const data = info as unknown as SessionEvent;
			const id = typeof data.sessionId === 'string' ? data.sessionId : undefined;
			// 宿主会在同进程换会话（onSessionEnd 的 reason 有 'replaced'）：id 变了就整体重建，
			// 否则上一个会话的名字/花费/seed 标记会原样漏进新会话。同一 id 再触发不重置——
			// 否则会把正在进行的会话的累计清零。
			if (id !== undefined && id !== session.id) {
				session = freshSession(id);
				requestStartedAt = 0;
			}
			seedFromKnownSources();
			startTimer();
			// 幂等：会话被替换时若 start 再次触发，避免监听器叠加
			process.stdout.off('resize', onResize);
			process.stdout.on('resize', onResize);
			// 新会话的第一次 git 读总是值得的（换会话时别被上一个会话的退避闸门挡住）
			gitFinishedAt = 0;
			refresh();
		},
		onSessionEnd: () => {
			stopTimer();
			process.stdout.off('resize', onResize);
			cmd.ui.setStatus(null);
		},
	});

	cmd.on('run_start', event => {
		const data = event as unknown as SessionEvent;
		if (!forCurrentSession(event)) return;
		// 只在还没拿到 id 时收养：run 的 sessionId 理应属于当前会话，
		// 换个 id 就重置的话，一次意外的嵌套 run 会把整份会话状态抹掉
		if (session.id === undefined && typeof data.sessionId === 'string') session.id = data.sessionId;
		seedFromKnownSources();
		refresh();
	});

	cmd.on('session_titled', event => {
		if (!forCurrentSession(event)) return;
		const data = event as unknown as {title?: unknown};
		if (typeof data.title === 'string' && data.title.trim()) {
			session.snapshot.title = data.title;
		}
		refresh();
	});

	cmd.on('model_request_start', event => {
		if (!forCurrentSession(event)) return;
		const data = event as unknown as ModelEvent;
		if (typeof data.model === 'string') session.snapshot.model = data.model;
		requestStartedAt = Date.now();
		refresh();
	});

	cmd.on('model_request_end', event => {
		if (!forCurrentSession(event)) return;
		const data = event as unknown as ModelEvent;
		const snapshot = session.snapshot;
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
				session.sessionCost += cost;
				updateCost();
			}
			const output = data.usage.outputTokens ?? 0;
			const elapsed = (Date.now() - requestStartedAt) / 1000;
			if (requestStartedAt > 0 && elapsed > 0 && output > 0) {
				snapshot.speed = output / elapsed;
			}
		}
		refresh();
	});

	// 子代理的模型请求不走 model_request_*（实测），用量只能从 subagent_stop 折进来；
	// 产品自身也不把子代理 token 计入 transcript，故这里只累计 token、不改动精确花费。
	cmd.on('subagent_stop', event => {
		if (!forCurrentSession(event)) return;
		const data = event as unknown as SubagentStopEvent;
		if (typeof data.tokensUsed === 'number' && data.tokensUsed > 0) {
			session.snapshot.subTokens += data.tokensUsed;
			refresh();
		}
	});

	cmd.on('turn_end', event => {
		if (!forCurrentSession(event)) return;
		refresh();
	});

	cmd.on('config_setting_changed', event => {
		if (!forCurrentSession(event)) return;
		const data = event as unknown as ConfigChangedEvent;
		if (data.setting === 'model' && typeof data.value === 'string') {
			session.snapshot.model = data.value;
			// effort 是按模型存的，换模型就得换值——配置里没有就清空，留着上一个模型的 effort 是错的
			session.snapshot.effort = readUserConfig().reasoningEffort[data.value];
		}
		// /effort 改完立刻重画，不必等下一次 model_request_end 才更新
		if (data.setting === 'effort' && typeof data.value === 'string') {
			session.snapshot.effort = data.value;
		}
		refresh();
	});

	// 键的展示值：数值键显示钳制后的值。显示原始配置值是不行的 ——
	// 写 bar-width: 100 时底栏用的是 40（spec.max），表里报 100 就是在撒谎。
	const displayValue = (spec: FlagSpec, value: unknown): string => {
		if (spec.numeric) return String(clampedNumber(spec, value));
		if (typeof value === 'boolean') return value ? 'true' : 'false';
		return String(value ?? '-');
	};

	const presetHint = (name: string): string =>
		Object.entries(PRESETS[name] ?? {})
			.filter(([, on]) => on)
			.map(([key]) => key)
			.join(' + ');

	// 诊断：一张「键 / 默认 / 生效 / 来源」表 + 告警。
	// 它同时解决「键名没入口」（不用翻 README）和「改了没生效也没反馈」（未知键/坏值点名）。
	const statuslineReport = (): string => {
		const t = s();
		const snapshot = session.snapshot;
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
				window ? `/${formatWindow(window)}` : t.windowUnknown
			}`,
			`cache=${snapshot.cacheHit !== undefined ? formatRate(snapshot.cacheHit) : '-'}`,
			`cost=${snapshot.costUsd > 0 ? formatCost(snapshot.costUsd) : '-'}${
				session.seededCost > 0 ? t.restored(formatCost(session.seededCost)) : ''
			}${priced ? '' : t.priceUnknown}`,
			`speed=${snapshot.speed ? `${Math.round(snapshot.speed)} tok/s` : '-'}`,
			`sub=${snapshot.subTokens > 0 ? `${formatTokens(snapshot.subTokens)}${t.subNote(formatCost(subEstimate))}` : '-'}`,
			`name=${snapshot.title ?? '-'}`,
			`git=${snapshot.isRepo ? (snapshot.branch ?? '-') : t.notRepo}`,
			`render=${asciiOnly() ? 'ascii' : colorMode()}`,
			`width=${terminalWidth() || t.unknown}`,
			`cmdc=${host ?? t.unknown}${t.requires(MIN_HOST_VERSION)}`,
			// 三态而不是两态：宿主说「不渲染」（headless）与宿主压根没有这个属性（旧宿主、
			// 版本又没读出来——闸门放行了）是两回事，后者报成 headless 就是在撒谎
			`footer=${
				cmd.ui.capabilities
					? cmd.ui.capabilities.status
						? t.rendering
						: t.headless
					: t.unknown
			}`,
		].join(' | ');

		const pad = (text: string, width: number): string => text.padEnd(width, ' ');
		const rows = FLAG_SPECS.map(spec => {
			const {value, source} = resolveFlag(spec.name);
			return [spec.name, String(spec.default), displayValue(spec, value), sourceText(source)];
		});
		// 列宽按内容算：写死的宽度会在值变长时和下一列黏在一起（preset=minimal 恰好 7 字符）
		const columnWidth = (index: number): number =>
			Math.max(...rows.map(row => row[index].length)) + 1;
		const table = rows.map(row =>
			row.map((cell, index) => pad(cell, columnWidth(index))).join('').trimEnd(),
		);
		// 两个候选文件都点名，并标出这一份到底读没读动 —— 只列「读到的」会把
		// 「文件在但坏了」显示成「没有配置文件」，那正是用户最需要知道的那种情况
		const files = [userConfigPath(), projectConfigPath(cmd.cwd)]
			.map(path =>
				configSources.includes(path)
					? `${path}${t.activeTag}`
					: configBroken.includes(path)
						? `${path}${t.brokenTag}`
						: path,
			)
			.join(' + ');

		const lines = [
			`${t.lineLabel}${t.colon}${plain}`,
			`${t.dataLabel}${t.colon}${state}`,
			t.configHead,
			...table,
			`${t.filesLabel}${t.colon}${files}`,
		];
		if (configSources.length === 0) {
			// 不能写「全部走内置默认」：没有配置文件时，命令行与预设照样能定值，
			// 那样写会和上面表格里的「预设 x / 命令行」自相矛盾
			lines.push(t.noFilesNote);
		}
		for (const path of configBroken) {
			lines.push(`⚠ ${t.brokenFile(path)}`);
		}
		if (session.seedDrifted) {
			lines.push(`⚠ ${t.seedDrift}`);
		}
		for (const warning of configWarnings()) lines.push(`⚠ ${warning}`);
		lines.push(t.tip);
		return lines.join('\n');
	};

	// 交互式配置：走 cmd.ui.select/input/confirm（TUI 里的真弹窗）。
	// headless 下 select 直接返回 undefined，于是整条流程自然退回「打印诊断」，不会瞎写文件。
	const configureStatusline = async (ui: ModApi['ui']): Promise<string> => {
		// 交互面板不一定存在（headless 会返回 undefined；非常规宿主可能干脆没有这几个方法，
		// 连 ui 本身都没有）：缺哪个都别抛出去变成一个 mod_error，退回打印诊断就行
		const canAsk =
			typeof ui?.select === 'function' &&
			typeof ui?.input === 'function' &&
			typeof ui?.confirm === 'function';
		if (!canAsk) {
			return [s().needTui, s().noModal, '', statuslineReport()].join('\n');
		}
		// 作用域存语义键不存 label：用户在流程中改 lang 后，旧的 label 字符串就对不上了
		const scopePick = await ui.select({
			title: s().scopeTitle(presetName()),
			options: [
				{label: s().userLevel, description: `${userConfigPath()} · ${s().allProjects}`},
				{label: s().projectLevel, description: `${projectConfigPath(cmd.cwd)} · ${s().thisProject}`},
			],
		});
		if (scopePick === undefined) {
			return [s().noModalShort, '', statuslineReport()].join('\n');
		}
		const scopeKey = scopePick === s().userLevel ? 'user' : 'project';
		const path = scopeKey === 'user' ? userConfigPath() : projectConfigPath(cmd.cwd);
		const scopeLabel = () => (scopeKey === 'user' ? s().userLevel : s().projectLevel);
		const changes: string[] = [];
		const notes: string[] = [];

		for (;;) {
			const t = s();
			const pick = await ui.select({
				title: t.editorTitle(scopeLabel(), changes.length),
				options: [
					...FLAG_SPECS.map(spec => {
						const {value} = resolveFlag(spec.name);
						const shown = spec.numeric
							? String(clampedNumber(spec, value))
							: typeof value === 'boolean'
								? value
									? t.on
									: t.off
								: String(value);
						return {label: spec.name, description: `${shown} · ${specDesc(spec)}`};
					}),
					{label: t.done, description: t.doneDesc},
				],
			});
			if (pick === undefined || pick === t.done) break;
			const spec = FLAG_BY_NAME.get(pick);
			if (!spec) continue;

			let value: unknown;
			if (spec.name === 'preset') {
				value = await ui.select({
					title: t.presetTitle,
					options: PRESET_NAMES.map(name => ({label: name, description: presetHint(name)})),
				});
			} else if (spec.name === 'lang') {
				// lang 是字符串键但不是自由输入：写别的值只会吃到「未知语言」告警
				value = await ui.select({
					title: t.langTitle,
					options: [
						{label: 'zh', description: '中文'},
						{label: 'en', description: 'English'},
					],
				});
			} else if (spec.numeric) {
				const typed = await ui.input({
					title: t.numberTitle(spec.name, describeExpectation(spec, currentLang()), spec.max),
					placeholder: String(spec.default),
				});
				const parsed = Number(typed);
				if (typed !== undefined && Number.isFinite(parsed)) value = parsed;
			} else {
				const picked = await ui.select({
					title: t.boolTitle(spec.name, specDesc(spec)),
					options: [
						{label: t.on, description: 'true'},
						{label: t.off, description: 'false'},
					],
				});
				if (picked !== undefined) value = picked === t.on;
			}
			if (value === undefined) continue;

			// 显示「当前实际生效」而不是「这份文件里写的」：同名键可能被另一份文件压着，
			// 只看自己这份会让用户以为改动是多余的（或反过来以为会变）
			const effective = resolveFlag(spec.name);
			const agreed = await ui.confirm({
				title: s().confirmTitle(spec.name, JSON.stringify(value)),
				message: s().confirmBody(
					path,
					spec.name,
					displayValue(spec, effective.value),
					sourceText(effective.source),
					JSON.stringify(value),
				),
			});
			if (!agreed) continue;

			try {
				writeConfigKey(path, spec.name, value);
			} catch (error) {
				ui.notify(s().writeFailed(error instanceof Error ? error.message : String(error)), 'error');
				continue;
			}
			changes.push(`${spec.name}=${JSON.stringify(value)}`);
			reloadConfig();
			// refresh 改的是定时器间隔：重启它，否则「不用 /reload」这句就是假的
			stopTimer();
			startTimer();
			refresh();
			// 写到用户级、但项目级有同名键（或命令行压着）→ 底栏不会变。这种事必须当面说，
			// 否则用户看到的是「提示已写入，界面毫无变化」，只会觉得功能坏了
			const applied = resolveFlag(spec.name);
			if (displayValue(spec, applied.value) !== displayValue(spec, value)) {
				notes.push(
					s().shadowed(
						spec.name,
						displayValue(spec, applied.value),
						sourceText(applied.source),
						scopeLabel(),
					),
				);
			}
		}

		const head =
			changes.length > 0 ? s().wrote(path, changes) : s().noChanges;
		return [head, ...notes.map(note => `⚠ ${note}`), '', statuslineReport()].join('\n');
	};

	cmd.addCommand({
		name: 'statusline',
		description:
			fileLang === 'en'
				? 'inspect the status line and config sources; `/statusline config` edits interactively'
				: '查看状态栏与配置来源；`/statusline config` 交互式修改',
		handler: async (context: {args?: unknown; ui?: ModApi['ui']}) => {
			const sub = String(context?.args ?? '').trim().toLowerCase();
			if (sub === 'config') {
				return {message: await configureStatusline(context?.ui ?? cmd.ui)};
			}
			return {message: statuslineReport()};
		},
	});
}

// ── 生成区（机器写入，勿手改） ──────────────────────────────────────────────────────
// scripts/gen-model-tables.py 从 CLI 自带的模型清单生成这两张表，CI 用 --check 比对漂移。
// 放在文件末尾是为了让上面连成一片手写代码 —— 它们是附录，不在阅读路径上；
// 上面用表的地方都走 contextWindowFor / modelPriceFor 两个口子，表本身不必挨着调用点。
// >>> GENERATED:WINDOWS（由 scripts/gen-model-tables.py 生成，勿手改）
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

// >>> GENERATED:PRICES（由 scripts/gen-model-tables.py 生成，勿手改）
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
