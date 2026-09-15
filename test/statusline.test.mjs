import {existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

// 直接吃 TypeScript：Node 22.18+/24 原生类型擦除，无需构建或 jiti。
// 想测另一份副本（例如已部署的 ~/.commandcode/mods/statusline.ts）：STATUSLINE_MOD=/path/to/file.ts
const MOD_PATH =
	process.env.STATUSLINE_MOD ?? fileURLToPath(new URL('../index.ts', import.meta.url));

// fixture 工作目录必须是「每次运行现造」的：写成固定路径的话，任何一次残留（曾经真发生过 ——
// 一条用例往这里写过 statusline.json）都会污染之后所有运行，因为默认 stub 的 cwd 就是它。
// 父目录唯一、basename 仍叫 my-project，好让那些断言渲染结果的用例不必改。
const FIXTURE_CWD = join(mkdtempSync(join(tmpdir(), 'statusline-fixture-')), 'my-project');
mkdirSync(FIXTURE_CWD, {recursive: true});

let passed = 0;
const failures = [];

function check(name, actual, expected) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (ok) passed += 1;
	else failures.push(`${name}\n    actual:   ${JSON.stringify(actual)}\n    expected: ${JSON.stringify(expected)}`);
}

function checkTrue(name, cond, detail = '') {
	if (cond) passed += 1;
	else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

function checkClose(name, actual, expected, tolerance = 1e-12) {
	if (typeof actual === 'number' && Math.abs(actual - expected) <= tolerance) passed += 1;
	else failures.push(`${name}\n    actual:   ${actual}\n    expected: ${expected} (±${tolerance})`);
}

const settle = () => new Promise(resolve => setTimeout(resolve, 25));
const strip = text => (typeof text === 'string' ? text.replace(/\u001b\[[0-9;]*m/g, '') : text);

// os.homedir() reads HOME on POSIX and USERPROFILE on Windows — redirect both. The suite
// starts on a throwaway home so the developer's real ~/.commandcode/statusline.json can
// never leak into an assertion.
const homeKeys = ['HOME', 'USERPROFILE'];
const useHome = home => {
	for (const key of homeKeys) process.env[key] = home;
};
const baseHome = mkdtempSync(join(tmpdir(), 'statusline-base-home-'));
useHome(baseHome);

const ns = await import(pathToFileURL(MOD_PATH).href);
const {
	formatTokens,
	formatPercent,
	formatWindow,
	formatCost,
	estimateCost,
	shortModel,
	parseGitStatus,
	composeLine,
	contextWindowFor,
	modelPriceFor,
	renderBar,
	rgbForPosition,
	readSessionSeed,
	readUserConfig,
	cacheHitRate,
	formatRate,
	visibleLength,
	loadConfig,
	cwdBasename,
} = ns;

// ── pure helpers ────────────────────────────────────────────────────────────────────
check('formatTokens 999', formatTokens(999), '999');
check('formatTokens 5120', formatTokens(5120), '5.1k');
check('formatTokens 28421', formatTokens(28421), '28k');
check('shortModel strips vendor', shortModel('deepseek/deepseek-v4.1-flash'), 'deepseek-v4.1-flash');
check('shortModel keeps bare id', shortModel('gpt-5.6'), 'gpt-5.6');
check('cwdBasename posix', cwdBasename('/tmp/statusline-fixture/my-project'), 'my-project');
check('cwdBasename windows', cwdBasename('D:\\02-repo\\github\\cmdc-statusline'), 'cmdc-statusline');
check('cwdBasename mixed separators', cwdBasename('C:/Users/me/my-project'), 'my-project');
check('cwdBasename empty', cwdBasename(''), undefined);
check('formatPercent small', formatPercent(28421, 1000000), '2.8%');
check('formatPercent big', formatPercent(850000, 1000000), '85%');
check('formatWindow 1M', formatWindow(1000000), '1M');
check('formatWindow 1.05M', formatWindow(1050000), '1.05M');
check('window known (1M)', contextWindowFor('deepseek/deepseek-v4.1-flash'), 1000000);
check('window known (K)', contextWindowFor('moonshotai/Kimi-K2.6'), 256000);
check('window unknown id', contextWindowFor('gpt-5.6'), undefined);
check('price known', modelPriceFor('deepseek/deepseek-v4.1-flash'), {in: 0.15, out: 0.6, cacheRead: 0.003, cacheWrite: 0});
check('price known (claude write price)', modelPriceFor('claude-opus-5'), {in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25});
check('price unknown id', modelPriceFor('unknown/model'), undefined);

check('formatCost zero', formatCost(0), '$0');
check('formatCost sub-cent', formatCost(0.003777054), '$0.0038');
check('formatCost small', formatCost(0.5), '$0.5');
check('formatCost mid', formatCost(12.3456), '$12.35');
check('formatCost big', formatCost(1234.5), '$1234.5');
check('formatCost micro', formatCost(0.00004), '$0.00004');

// 与产品自身记录的 costUsd 对齐（transcript 中逐条核对过的真实值）
checkClose(
	'cost matches product sample A',
	estimateCost({inputTokens: 31537, outputTokens: 167, cacheReadTokens: 7168, cacheWriteTokens: 0}, 'deepseek/deepseek-v4.1-flash'),
	0.0037770539999999997,
);
checkClose(
	'cost matches product sample B',
	estimateCost({inputTokens: 40058, outputTokens: 529, cacheReadTokens: 34688, cacheWriteTokens: 0}, 'deepseek/deepseek-v4.1-flash'),
	0.001226964,
);
checkClose('cost unknown price', estimateCost({inputTokens: 1000}, 'unknown/model'), 0);
checkClose(
	'cost claude cache write',
	estimateCost({inputTokens: 2000, outputTokens: 1000, cacheReadTokens: 500, cacheWriteTokens: 500}, 'claude-opus-5'),
	(1000 * 5 + 500 * 0.5 + 500 * 6.25 + 1000 * 25) / 1_000_000,
);

check('bar 2.8% width 12', renderBar(2.8, 12, 'ansi256', false), '█░░░░░░░░░░░');
check('bar 100% width 10', renderBar(100, 10, 'ansi256', false), '██████████');
check('bar 0% width 10', renderBar(0, 10, 'ansi256', false), '░░░░░░░░░░');
check('bar 50% width 10', renderBar(50, 10, 'ansi256', false), '█████░░░░░');
check('bar width 1', renderBar(50, 1, 'ansi256', false), '█');
check('bar ascii 25% width 8', renderBar(25, 8, 'ascii', false), '##------');
checkTrue('bar truecolor escapes', renderBar(50, 4, 'truecolor', true).includes('\u001b[38;2;'));
checkTrue('bar 256-color escapes', renderBar(50, 4, 'ansi256', true).includes('\u001b[38;5;'));
checkTrue('bar no color when disabled', !renderBar(50, 4, 'ansi256', false).includes('\u001b['));
check('rgb start is green', rgbForPosition(0), [0, 200, 0]);
check('rgb middle is yellow', rgbForPosition(0.5), [200, 200, 0]);
check('rgb end is red', rgbForPosition(1), [200, 0, 0]);

check('cacheHitRate basic', cacheHitRate({inputTokens: 1000, cacheReadTokens: 900}), 90);
check('cacheHitRate fractional', Math.round(cacheHitRate({inputTokens: 31537, cacheReadTokens: 7168})), 23);
check('cacheHitRate no input', cacheHitRate({outputTokens: 10}), undefined);
check('formatRate 99.96 → 100%', formatRate(99.96), '100%');
check('formatRate 99.8 → 99%（不谎报 100）', formatRate(99.8), '99%');
check('formatRate 87.3 → 87%', formatRate(87.3), '87%');
check('formatRate 3.44 → 3.4%', formatRate(3.44), '3.4%');
check('visibleLength ignores ansi', visibleLength('\u001b[31mabc\u001b[0m │ \u001b[2mde\u001b[0m'), 8);
check('visibleLength counts CJK as two columns', visibleLength('提交'), 4);
check('visibleLength mixed ascii + CJK', visibleLength('abc中文'), 7);
check('visibleLength strips ansi around CJK', visibleLength('\u001b[1m中文\u001b[0m'), 4);
check('truncateToWidth keeps short text', ns.truncateToWidth('abc', 5), 'abc');
check('truncateToWidth ascii', ns.truncateToWidth('abcdef', 4), 'abc…');
check('truncateToWidth CJK', ns.truncateToWidth('提交并推送', 5), '提交…');
check('truncateToWidth CJK width is exact', visibleLength(ns.truncateToWidth('提交并推送', 5)), 5);

{
	const dir = mkdtempSync(join(tmpdir(), 'statusline-cfg-'));
	mkdirSync(join(dir, '.commandcode'), {recursive: true});
	writeFileSync(join(dir, '.commandcode', 'statusline.json'), JSON.stringify({cwd: false, 'bar-width': 4}));
	const loaded = loadConfig(dir);
	check('loadConfig reads project file', [loaded.config.cwd, loaded.config['bar-width']], [false, 4]);
	check('loadConfig reports source', loaded.sources.length, 1);
	writeFileSync(join(dir, '.commandcode', 'statusline.json'), '{broken');
	check('loadConfig tolerates broken json', loadConfig(dir).sources.length, 0);
}

const porcelain = ['## main...origin/main [ahead 1, behind 2]', ' M changed.ts', 'M  staged.ts', '?? new.ts', ''].join('\n');
const parsed = parseGitStatus(porcelain);
check('parse branch', parsed.branch, 'main');
check('parse ahead/behind', [parsed.ahead, parsed.behind], [1, 2]);
check('parse staged/modified/untracked', [parsed.staged, parsed.modified, parsed.untracked], [1, 1, 1]);
check('parse detached', parseGitStatus('## HEAD (no branch)\n').branch, 'detached');
check('parse empty (non-repo)', parseGitStatus('', false).branch, undefined);

const allSegments = {
	model: true,
	effort: true,
	context: true,
	bar: true,
	percent: true,
	cost: true,
	speed: true,
	name: true,
	git: true,
	cwd: true,
};
const snapshot = {
	isRepo: true,
	branch: 'main',
	ahead: 1,
	behind: 0,
	staged: 1,
	modified: 2,
	untracked: 1,
	model: 'deepseek/deepseek-v4.1-flash',
	effort: 'max',
	contextTokens: 28421,
	title: 'Commit And Push',
	costUsd: 0.0123,
	speed: 42.4,
};
const plain = (segments, extra = {}) =>
	composeLine(snapshot, segments, {color: false, rawModel: false, mode: 'ascii', barWidth: 12, ...extra});

check(
	'compose full line',
	plain(allSegments, {cwd: 'my-project'}),
	'deepseek-v4.1-flash │ max │ #----------- 28k (2.8%) │ $0.012 │ 42 tok/s │ Commit And Push │ main ↑1 │ +1 ~2 ?1 │ my-project',
);
check(
	'compose bar off keeps ctx prefix',
	plain({...allSegments, bar: false}),
	'deepseek-v4.1-flash │ max │ ctx 28k (2.8%) │ $0.012 │ 42 tok/s │ Commit And Push │ main ↑1 │ +1 ~2 ?1',
);
check(
	'compose cost off',
	plain({...allSegments, cost: false}),
	'deepseek-v4.1-flash │ max │ #----------- 28k (2.8%) │ 42 tok/s │ Commit And Push │ main ↑1 │ +1 ~2 ?1',
);
check(
	'compose speed off',
	plain({...allSegments, speed: false}),
	'deepseek-v4.1-flash │ max │ #----------- 28k (2.8%) │ $0.012 │ Commit And Push │ main ↑1 │ +1 ~2 ?1',
);
check(
	'compose unknown window drops bar + percent',
	composeLine({...snapshot, model: 'gpt-5.6'}, allSegments, {color: false, rawModel: false, mode: 'ascii', barWidth: 12}),
	'gpt-5.6 │ max │ ctx 28k │ $0.012 │ 42 tok/s │ Commit And Push │ main ↑1 │ +1 ~2 ?1',
);
check(
	'compose zero cost drops segment',
	composeLine({...snapshot, costUsd: 0}, allSegments, {color: false, rawModel: false, mode: 'ascii', barWidth: 12}),
	'deepseek-v4.1-flash │ max │ #----------- 28k (2.8%) │ 42 tok/s │ Commit And Push │ main ↑1 │ +1 ~2 ?1',
);
check(
	'compose sub-1 tok/s drops segment',
	composeLine({...snapshot, speed: 0.3}, allSegments, {color: false, rawModel: false, mode: 'ascii', barWidth: 12}),
	'deepseek-v4.1-flash │ max │ #----------- 28k (2.8%) │ $0.012 │ Commit And Push │ main ↑1 │ +1 ~2 ?1',
);
check(
	'compose bar width 0 drops bar',
	composeLine(snapshot, allSegments, {color: false, rawModel: false, mode: 'ascii', barWidth: 0}),
	'deepseek-v4.1-flash │ max │ ctx 28k (2.8%) │ $0.012 │ 42 tok/s │ Commit And Push │ main ↑1 │ +1 ~2 ?1',
);
check(
	'compose truncates long title',
	composeLine({...snapshot, title: 'A very long generated session title'}, allSegments, {color: false, rawModel: false, mode: 'ascii', barWidth: 12}),
	'deepseek-v4.1-flash │ max │ #----------- 28k (2.8%) │ $0.012 │ 42 tok/s │ A very long generated s… │ main ↑1 │ +1 ~2 ?1',
);
check(
	'compose clean tree',
	composeLine({...snapshot, staged: 0, modified: 0, untracked: 0}, allSegments, {color: false, rawModel: false, mode: 'ascii', barWidth: 12}),
	'deepseek-v4.1-flash │ max │ #----------- 28k (2.8%) │ $0.012 │ 42 tok/s │ Commit And Push │ main ↑1 │ clean',
);
{
	const colored = composeLine(snapshot, allSegments, {color: true, rawModel: false, mode: 'truecolor', barWidth: 12});
	checkTrue('compose colors the bar', colored.includes('\u001b[38;2;'));
	checkTrue(
		'compose percent >=95 red',
		composeLine({...snapshot, contextTokens: 950000}, allSegments, {color: true, rawModel: false, mode: 'ansi256', barWidth: 12}).includes('\u001b[31m'),
	);
	checkTrue(
		'compose percent >=80 yellow',
		composeLine({...snapshot, contextTokens: 820000}, allSegments, {color: true, rawModel: false, mode: 'ansi256', barWidth: 12}).includes('\u001b[33m'),
	);
	checkTrue(
		'compose cost >=$10 red',
		composeLine({...snapshot, costUsd: 12}, allSegments, {color: true, rawModel: false, mode: 'ansi256', barWidth: 12}).includes('\u001b[31m'),
	);
	checkTrue(
		'compose cost >=$1 yellow',
		composeLine({...snapshot, costUsd: 2}, allSegments, {color: true, rawModel: false, mode: 'ansi256', barWidth: 12}).includes('\u001b[33m'),
	);
}

// 窄终端：按优先级降级——模型永不丢，上下文逐级退化（条+token+% → token+% → token）
{
	const base = {color: false, rawModel: false, mode: 'ascii', barWidth: 12, cwd: 'my-project'};
	const full = composeLine(snapshot, allSegments, {...base, maxWidth: 0});
	const fullWidth = visibleLength(full);
	checkTrue('no maxWidth → no dropping', fullWidth > 60, `${fullWidth}`);

	check('width == line length → unchanged', composeLine(snapshot, allSegments, {...base, maxWidth: fullWidth}), full);
	checkTrue(
		'narrow: cwd dropped first',
		!composeLine(snapshot, allSegments, {...base, maxWidth: fullWidth - 1}).includes('my-project'),
	);

	const narrow = composeLine(snapshot, allSegments, {...base, maxWidth: 40});
	checkTrue('narrow 40: model survives', narrow.includes('deepseek-v4.1-flash'), narrow);
	checkTrue(
		'narrow 40: drops cwd/speed/cache',
		!narrow.includes('my-project') && !narrow.includes('tok/s') && !narrow.includes('cache'),
		narrow,
	);
	checkTrue('narrow 40: actually fits', visibleLength(narrow) <= 40, `${visibleLength(narrow)} → ${narrow}`);

	check('tiny: model survives alone', composeLine(snapshot, allSegments, {...base, maxWidth: 8}), 'deepseek-v4.1-flash');

	// 中文 session 名：宽度必须按显示列算，否则窄终端会算窄一半、该降级时不降级
	const cjkSnapshot = {...snapshot, title: '提交并推送这些改动'};
	const cjkLine = composeLine(cjkSnapshot, allSegments, {...base, maxWidth: 70});
	checkTrue(
		'CJK title: line fits display width',
		visibleLength(cjkLine) <= 70,
		`${visibleLength(cjkLine)} → ${cjkLine}`,
	);
	const cjkTight = composeLine(cjkSnapshot, allSegments, {...base, maxWidth: 30});
	checkTrue(
		'CJK title: tight width also fits',
		visibleLength(cjkTight) <= 30,
		`${visibleLength(cjkTight)} → ${cjkTight}`,
	);

	const onlyContext = {
		model: false,
		effort: false,
		context: true,
		bar: true,
		percent: true,
		cache: false,
		cost: false,
		speed: false,
		sub: false,
		name: false,
		git: false,
		cwd: false,
	};
	const ctx = width =>
		composeLine(snapshot, onlyContext, {color: false, rawModel: false, mode: 'ascii', barWidth: 12, maxWidth: width});
	check('context ladder: full', ctx(40), '#----------- 28k (2.8%)');
	check('context ladder: bar dropped', ctx(20), '28k (2.8%)');
	check('context ladder: fits exactly at 10', ctx(10), '28k (2.8%)');
	check('context ladder: tokens only', ctx(9), 'ctx 28k');
}

// ── runtime against a stub ModApi ───────────────────────────────────────────────────
// answers=null 复刻 headless：select/input → undefined、confirm → false
function makeStub({statusCapability = true, gitCode = 0, gitStdout = porcelain, env = {}, cwd = FIXTURE_CWD, answers = null} = {}) {
	const saved = {};
	for (const [key, value] of Object.entries(env)) {
		saved[key] = process.env[key];
		process.env[key] = value;
	}
	const queue = answers === null ? null : [...answers];
	const state = {
		statuses: [],
		execCalls: [],
		flags: new Map(),
		hooks: {},
		events: {},
		commands: {},
		modals: [],
		notices: [],
		restore: () => {
			for (const [key, value] of Object.entries(saved)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		},
	};
	const api = {
		name: 'statusline',
		cwd,
		addFlag: (name, def) => void state.flags.set(name, def.default),
		getFlag: name => state.flags.get(name),
		hooks: hooks => void (state.hooks = hooks),
		on: (event, handler) => void ((state.events[event] ??= []).push(handler)),
		addCommand: command => void (state.commands[command.name] = command.handler),
		exec: async options => {
			state.execCalls.push(options);
			if (options.command !== 'git') throw new Error(`unexpected exec: ${options.command}`);
			return {stdout: gitStdout, stderr: '', code: gitCode};
		},
		ui: {
			capabilities: {status: statusCapability},
			setStatus: text => void state.statuses.push(text),
			notify: (message, level) => void state.notices.push([message, level]),
			select: async options => {
				state.modals.push(['select', options]);
				return queue === null ? undefined : queue.shift();
			},
			input: async options => {
				state.modals.push(['input', options]);
				return queue === null ? undefined : queue.shift();
			},
			confirm: async options => {
				state.modals.push(['confirm', options]);
				return queue === null ? false : queue.shift();
			},
		},
	};
	return {api, state};
}

// 造一个假的 home；config 为 null 时只建目录、不写 statusline.json
const homeWith = (config, prefix = 'statusline-home-') => {
	const home = mkdtempSync(join(tmpdir(), prefix));
	mkdirSync(join(home, '.commandcode'), {recursive: true});
	if (config !== null) {
		writeFileSync(join(home, '.commandcode', 'statusline.json'), JSON.stringify(config));
	}
	return home;
};

const useBaselineUsage = async (state, model = 'deepseek/deepseek-v4.1-flash') => {
	state.events.model_request_start[0]({type: 'model_request_start', model});
	await settle();
	state.events.model_request_end[0]({
		type: 'model_request_end',
		model,
		effort: 'max',
		usage: {inputTokens: 31537, outputTokens: 167, cacheReadTokens: 7168, cacheWriteTokens: 0},
	});
};

const fakeHome = mkdtempSync(join(tmpdir(), 'statusline-home-'));
const slug = FIXTURE_CWD.replace(/^[/\\]+/, '').replace(/[/\\:]+/g, '-');
const seededSession = 'seeded-session-id';
const projectDir = join(fakeHome, '.commandcode', 'projects', slug);
mkdirSync(projectDir, {recursive: true});
writeFileSync(join(projectDir, `${seededSession}.meta.json`), JSON.stringify({title: 'Seeded Session Name'}));
writeFileSync(join(projectDir, 'broken-session-id.meta.json'), '{not json');

// 默认跑法：关掉定时器保证确定性
{
	const {api, state} = makeStub();
	ns.default(api);
	check('registers 17 flags', state.flags.size, 17);
	for (const event of ['run_start', 'session_titled', 'model_request_start', 'model_request_end', 'turn_end', 'config_setting_changed'])
		checkTrue(`registers ${event}`, Array.isArray(state.events[event]));
	checkTrue('registers /statusline', typeof state.commands.statusline === 'function');

	state.flags.set('refresh', '0');
	state.hooks.onSessionStart({source: 'startup', sessionId: 'fresh-session-id'});
	await settle();
	check('session start paints git + cwd only', strip(state.statuses.at(-1)), 'main ↑1↓2 │ +1 ~1 ?1 │ my-project');
	checkTrue('cwd on by default', strip(state.statuses.at(-1)).endsWith('my-project'), strip(state.statuses.at(-1)));

	state.events.session_titled[0]({type: 'session_titled', title: 'Auto Generated Title'});
	await settle();
	check('session_titled adds name', strip(state.statuses.at(-1)), 'Auto Generated Title │ main ↑1↓2 │ +1 ~1 ?1 │ my-project');

	await useBaselineUsage(state);
	await settle();
	const line = strip(state.statuses.at(-1));
	checkTrue('runtime line has model + effort', line.includes('deepseek-v4.1-flash │ max │'), line);
	checkTrue('runtime line has bar + ctx + %', line.includes('32k (3.2%)'), line);
	checkTrue('runtime line has session cost', line.includes('$0.0038'), line);
	checkTrue('runtime line has speed', /\d+ tok\/s/.test(line), line);
	checkTrue('runtime line keeps name + git', line.includes('Auto Generated Title') && line.includes('main ↑1↓2'), line);

	await useBaselineUsage(state);
	await settle();
	checkTrue('cost accumulates across requests', strip(state.statuses.at(-1)).includes('$0.0076'), strip(state.statuses.at(-1)));

	const message = await state.commands.statusline({args: '', cwd: api.cwd, exec: api.exec});
	checkTrue('/statusline reports window', message.message.includes('ctx=32k/1M'), message.message);
	checkTrue('/statusline reports cost', message.message.includes('cost=$0.0076'), message.message);
	checkTrue('/statusline reports render mode', message.message.includes('render='), message.message);

	state.hooks.onSessionEnd({reason: 'shutdown'});
	check('session end clears status', state.statuses.at(-1), null);
	state.restore();
}

// 模型无单价/窗口 → 花费段隐藏、只留 token
{
	const {api, state} = makeStub();
	ns.default(api);
	state.flags.set('refresh', '0');
	state.flags.set('git', false);
	await useBaselineUsage(state, 'unknown/model-x');
	await settle();
	const line = strip(state.statuses.at(-1));
	checkTrue('unknown price hides cost', !line.includes('$'), line);
	checkTrue('unknown window keeps tokens only', line.includes('ctx 32k') && !line.includes('('), line);
	state.restore();
}

// 恢复会话：session 名由 meta.json seed
{
	useHome(fakeHome);
	const {api, state} = makeStub();
	ns.default(api);
	state.flags.set('refresh', '0');
	state.hooks.onSessionStart({source: 'resume', sessionId: seededSession});
	await settle();
	check('resume seeds title from meta.json', strip(state.statuses.at(-1)), 'Seeded Session Name │ main ↑1↓2 │ +1 ~1 ?1 │ my-project');
	useHome(baseHome);
}

// 会话花费：恢复会话时从 transcript 求和，重启不清零
{
	useHome(fakeHome);
	const costSession = 'cost-session-id';
	writeFileSync(
		join(projectDir, `${costSession}.jsonl`),
		[
			JSON.stringify({type: 'message', message: {role: 'assistant', usage: {costUsd: 0.1, inputTokens: 1}}}),
			JSON.stringify({type: 'message', message: {role: 'user'}}),
			JSON.stringify({type: 'message', message: {role: 'assistant', usage: {costUsd: 0.25, inputTokens: 1}}}),
			'',
		].join('\n'),
	);
	checkClose('readSessionSeed sums transcript', (await readSessionSeed(costSession, FIXTURE_CWD)).costUsd, 0.35, 1e-9);
	check('readSessionSeed missing file', await readSessionSeed('no-such-session', FIXTURE_CWD), undefined);

	const {api, state} = makeStub();
	ns.default(api);
	state.flags.set('refresh', '0');
	state.flags.set('git', false);
	state.hooks.onSessionStart({source: 'resume', sessionId: costSession});
	await settle();
	checkTrue('resumed cost seeded from transcript', strip(state.statuses.at(-1)).includes('$0.35'), strip(state.statuses.at(-1)));

	await useBaselineUsage(state);
	await settle();
	checkTrue('seeded cost + new request', strip(state.statuses.at(-1)).includes('$0.354'), strip(state.statuses.at(-1)));
	const message = await state.commands.statusline({args: '', cwd: api.cwd, exec: api.exec});
	checkTrue('/statusline shows restored portion', message.message.includes('含恢复'), message.message);
	useHome(baseHome);
}

// 恢复会话：transcript 里最后一轮请求的 model/effort/上下文/缓存一并种入，底栏一开就画全
{
	useHome(fakeHome);
	const tailSession = 'tail-session-id';
	writeFileSync(
		join(projectDir, `${tailSession}.jsonl`),
		[
			JSON.stringify({type: 'message', id: 'a', message: {role: 'user', content: 'hi'}}),
			JSON.stringify({
				type: 'message',
				id: 'b',
				message: {role: 'assistant', content: [{type: 'text', text: '{"usage":{"inputTokens":1},"model":"bogus"}'}]},
				usage: {inputTokens: 31537, outputTokens: 167, cacheReadTokens: 7168, cacheWriteTokens: 0, costUsd: 0.003777054},
				model: 'deepseek/deepseek-v4.1-flash',
				effort: 'high',
			}),
			'',
		].join('\n'),
	);
	const seed = await readSessionSeed(tailSession, FIXTURE_CWD);
	checkClose('readSessionSeed reads cost', seed.costUsd, 0.003777054, 1e-12);
	check('readSessionSeed reads model', seed.model, 'deepseek/deepseek-v4.1-flash');
	check('readSessionSeed reads effort', seed.effort, 'high');
	check('readSessionSeed reads usage', seed.usage, {
		inputTokens: 31537,
		outputTokens: 167,
		cacheReadTokens: 7168,
		cacheWriteTokens: 0,
	});

	const {api, state} = makeStub();
	ns.default(api);
	state.flags.set('refresh', '0');
	state.flags.set('git', false);
	state.hooks.onSessionStart({source: 'resume', sessionId: tailSession});
	await settle();
	const line = strip(state.statuses.at(-1));
	checkTrue('resume seeds model + effort', line.startsWith('deepseek-v4.1-flash │ high │'), line);
	checkTrue(
		'resume seeds context + cache + cost',
		line.includes('32k (3.2%)') && line.includes('cache 22%') && line.includes('$0.0038'),
		line,
	);
	useHome(baseHome);
}

// 刚开 cmdc、一次请求都还没有：model/effort 从 ~/.commandcode/config.json 先画出来
{
	const seedHome = mkdtempSync(join(tmpdir(), 'statusline-seedhome-'));
	mkdirSync(join(seedHome, '.commandcode'), {recursive: true});
	writeFileSync(
		join(seedHome, '.commandcode', 'config.json'),
		JSON.stringify({
			model: 'deepseek/deepseek-v4.1-flash',
			reasoningEffort: {'deepseek/deepseek-v4.1-flash': 'high'},
		}),
	);
	useHome(seedHome);
	check(
		'readUserConfig reads model + effort',
		readUserConfig(),
		{model: 'deepseek/deepseek-v4.1-flash', reasoningEffort: {'deepseek/deepseek-v4.1-flash': 'high'}},
	);

	const {api, state} = makeStub();
	ns.default(api);
	state.flags.set('refresh', '0');
	state.hooks.onSessionStart({source: 'startup', sessionId: 'fresh-session-id'});
	await settle();
	check(
		'session start seeds model + effort from config',
		strip(state.statuses.at(-1)),
		'deepseek-v4.1-flash │ high │ main ↑1↓2 │ +1 ~1 ?1 │ my-project',
	);

	// 真实请求一到，配置里的推测值让位给事件报告的值
	await useBaselineUsage(state, 'moonshotai/Kimi-K3');
	await settle();
	checkTrue('request overrides the config seed', strip(state.statuses.at(-1)).startsWith('Kimi-K3 │ max │'), strip(state.statuses.at(-1)));
	useHome(baseHome);
}

// /effort 改完立刻重画（原来要等下一次 model_request_end）
{
	const {api, state} = makeStub();
	ns.default(api);
	state.flags.set('refresh', '0');
	state.flags.set('git', false);
	await useBaselineUsage(state);
	await settle();
	state.events.config_setting_changed[0]({setting: 'effort', value: 'low'});
	await settle();
	checkTrue('effort change repaints immediately', strip(state.statuses.at(-1)).includes('│ low │'), strip(state.statuses.at(-1)));

	// 换模型：effort 不能留着上一个模型的值（配置里没有新模型的条目 → 清空）
	state.events.config_setting_changed[0]({setting: 'model', value: 'moonshotai/Kimi-K3'});
	await settle();
	const line = strip(state.statuses.at(-1));
	checkTrue('model switch drops the stale effort', !line.includes('low'), line);
	state.restore();
}

// 损坏的 meta.json 不崩、不编名字
{
	useHome(fakeHome);
	const {api, state} = makeStub();
	ns.default(api);
	state.flags.set('refresh', '0');
	state.hooks.onSessionStart({source: 'resume', sessionId: 'broken-session-id'});
	await settle();
	check('corrupt meta.json is ignored', strip(state.statuses.at(-1)), 'main ↑1↓2 │ +1 ~1 ?1 │ my-project');
	useHome(baseHome);
}

// headless：无能力 → 不 spawn git、不调 setStatus
{
	const {api, state} = makeStub({statusCapability: false});
	ns.default(api);
	state.flags.set('refresh', '0');
	state.hooks.onSessionStart({source: 'startup'});
	await useBaselineUsage(state);
	await settle();
	check('headless: no setStatus', state.statuses.length, 0);
	check('headless: no git exec', state.execCalls.length, 0);
	const message = await state.commands.statusline({args: '', cwd: api.cwd, exec: api.exec});
	checkTrue('/statusline works headless', message.message.includes('footer=本运行不渲染（headless）'), message.message);
	state.restore();
}

// 非 git 仓库 + 关掉 cwd/model：没有任何段可画 → 清空状态行
{
	const {api, state} = makeStub({gitCode: 128, gitStdout: ''});
	ns.default(api);
	state.flags.set('refresh', '0');
	state.flags.set('model', false);
	state.flags.set('cwd', false);
	state.hooks.onSessionStart({source: 'startup'});
	await settle();
	check('non-repo paints empty → null', state.statuses.at(-1), null);
	state.restore();
}

// git 挂死保护：exec 必须拿到 AbortSignal；git 抛错/被中止时底栏照常绘制（不冻住）
{
	const {api, state} = makeStub();
	ns.default(api);
	state.flags.set('refresh', '0');
	state.hooks.onSessionStart({source: 'startup'});
	await settle();
	const call = state.execCalls.at(-1);
	checkTrue('git exec receives an abort signal', call?.signal instanceof AbortSignal, JSON.stringify(Object.keys(call ?? {})));
	state.restore();
}

{
	const {api, state} = makeStub();
	api.exec = async () => {
		throw new Error('aborted');
	};
	ns.default(api);
	state.flags.set('refresh', '0');
	await useBaselineUsage(state);
	await settle();
	const line = strip(state.statuses.at(-1));
	checkTrue('aborted git still paints the line', line.includes('deepseek-v4.1-flash'), line);
	checkTrue('aborted git hides the branch', !line.includes('main'), line);
	state.restore();
}

// ascii 开关：即便 COLORTERM=truecolor 也走纯 ASCII
{
	const {api, state} = makeStub({env: {COLORTERM: 'truecolor'}});
	ns.default(api);
	state.flags.set('refresh', '0');
	state.flags.set('git', false);
	state.flags.set('ascii', true);
	await useBaselineUsage(state);
	await settle();
	const line = state.statuses.at(-1);
	checkTrue('ascii flag → no escapes', !line.includes('\u001b['), JSON.stringify(line));
	checkTrue('ascii flag → ascii bar', line.includes('#---'), line);
	state.restore();
}

// COLORTERM=truecolor → 24-bit 渐变
{
	const {api, state} = makeStub({env: {COLORTERM: 'truecolor'}});
	ns.default(api);
	state.flags.set('refresh', '0');
	state.flags.set('git', false);
	await useBaselineUsage(state);
	await settle();
	checkTrue('truecolor env → 38;2 escapes', state.statuses.at(-1).includes('\u001b[38;2;'));
	state.restore();
}

// /model 切换 → config_setting_changed 重绘
{
	const {api, state} = makeStub();
	ns.default(api);
	state.flags.set('refresh', '0');
	state.flags.set('git', false);
	await useBaselineUsage(state);
	await settle();
	state.events.config_setting_changed[0]({setting: 'model', value: 'moonshotai/Kimi-K3'});
	await settle();
	const line = strip(state.statuses.at(-1));
	checkTrue('model switch repaints', line.startsWith('Kimi-K3 │'), line);
	state.restore();
}

// 配置文件：用户级 < 项目级 < 命令行（命令行仅当取值异于内置默认时才算显式覆盖）
{
	const cfgHome = mkdtempSync(join(tmpdir(), 'statusline-cfghome-'));
	const cfgProject = mkdtempSync(join(tmpdir(), 'statusline-cfgproj-'));
	mkdirSync(join(cfgHome, '.commandcode'), {recursive: true});
	mkdirSync(join(cfgProject, '.commandcode'), {recursive: true});
	writeFileSync(join(cfgHome, '.commandcode', 'statusline.json'), JSON.stringify({cwd: false, speed: false}));
	writeFileSync(join(cfgProject, '.commandcode', 'statusline.json'), JSON.stringify({cwd: true, cache: false}));
	const projectName = basename(cfgProject);

	useHome(cfgHome);
	const {api, state} = makeStub({cwd: cfgProject});
	ns.default(api);
	state.flags.set('refresh', '0');
	state.flags.set('git', false);
	await useBaselineUsage(state);
	await settle();
	const line = strip(state.statuses.at(-1));
	checkTrue('project config overrides user (cwd on)', line.endsWith(projectName), line);
	checkTrue('user config honored (speed off)', !line.includes('tok/s'), line);
	checkTrue('project config honored (cache off)', !line.includes('cache'), line);
	const message = await state.commands.statusline({args: '', cwd: cfgProject, exec: api.exec});
	checkTrue('/statusline lists config sources', message.message.includes('statusline.json'), message.message);
	state.restore();

	// 命令行与默认值不同 → 命令行赢过配置
	writeFileSync(join(cfgHome, '.commandcode', 'statusline.json'), JSON.stringify({speed: true}));
	const cli = makeStub({cwd: cfgProject});
	useHome(cfgHome);
	ns.default(cli.api);
	cli.state.flags.set('refresh', '0');
	cli.state.flags.set('git', false);
	cli.state.flags.set('speed', false);
	await useBaselineUsage(cli.state);
	await settle();
	checkTrue('cli flag beats config (speed off)', !strip(cli.state.statuses.at(-1)).includes('tok/s'), strip(cli.state.statuses.at(-1)));
	cli.state.restore();
	useHome(baseHome);
}

// 子代理用量：产品自身不计入 transcript，故只显示 token、不动精确花费
{
	const {api, state} = makeStub();
	ns.default(api);
	state.flags.set('refresh', '0');
	state.flags.set('git', false);
	await useBaselineUsage(state);
	await settle();
	const before = strip(state.statuses.at(-1));
	checkTrue('no sub segment before sub-agents', !before.includes('sub '), before);

	state.events.subagent_stop[0]({subagentType: 'explore', tokensUsed: 16477});
	await settle();
	const after = strip(state.statuses.at(-1));
	checkTrue('sub-agent tokens shown', after.includes('sub 16k'), after);
	checkTrue('sub-agent does not change cost', after.includes('$0.0038'), after);

	const message = await state.commands.statusline({args: '', cwd: api.cwd, exec: api.exec});
	checkTrue('/statusline reports sub tokens', message.message.includes('sub=16k'), message.message);
	checkTrue('/statusline notes sub not in cost', message.message.includes('未计入上面 cost'), message.message);
	state.restore();
}

// 预设：只决定段位开关；单个键覆盖预设；命令行（异于内置默认）压过配置
{
	useHome(homeWith({preset: 'minimal'}));
	const {api, state} = makeStub();
	ns.default(api);
	state.flags.set('refresh', '0');
	await useBaselineUsage(state);
	await settle();
	check(
		'preset minimal keeps only model/effort/context/git',
		strip(state.statuses.at(-1)),
		'deepseek-v4.1-flash │ max │ █░░░░░░░░░░░ 32k (3.2%) │ main ↑1↓2 │ +1 ~1 ?1',
	);
	useHome(baseHome);
}

{
	useHome(homeWith({preset: 'usage'}));
	const {api, state} = makeStub();
	ns.default(api);
	state.flags.set('refresh', '0');
	await useBaselineUsage(state);
	await settle();
	check(
		'preset usage keeps context/cache/cost',
		strip(state.statuses.at(-1)),
		'█░░░░░░░░░░░ 32k (3.2%) │ cache 22% │ $0.0038',
	);
	useHome(baseHome);
}

{
	useHome(homeWith({preset: 'minimal', cost: true}));
	const {api, state} = makeStub();
	ns.default(api);
	state.flags.set('refresh', '0');
	await useBaselineUsage(state);
	await settle();
	checkTrue(
		'a single key overrides the preset',
		strip(state.statuses.at(-1)).includes('│ $0.0038 │ main ↑1↓2'),
		strip(state.statuses.at(-1)),
	);
	useHome(baseHome);
}

{
	// 没有配置文件，预设只能从命令行来
	const {api, state} = makeStub();
	ns.default(api);
	state.flags.set('refresh', '0');
	state.flags.set('preset', 'minimal');
	await useBaselineUsage(state);
	await settle();
	checkTrue('cli preset beats the built-in default', !strip(state.statuses.at(-1)).includes('$'), strip(state.statuses.at(-1)));
	state.restore();
}

{
	// 预设名不认识 → 退回内置默认（= full），并在诊断里点名
	useHome(homeWith({preset: 'nope'}));
	const {api, state} = makeStub();
	ns.default(api);
	state.flags.set('refresh', '0');
	await useBaselineUsage(state);
	await settle();
	checkTrue('unknown preset falls back to full', strip(state.statuses.at(-1)).includes('$0.0038'), strip(state.statuses.at(-1)));
	useHome(baseHome);
}

// /statusline：键/默认/生效/来源 全表 + 未知键与坏值点名
{
	useHome(homeWith({speedd: false, cache: 'yes', preset: 'nope'}));
	const {api, state} = makeStub();
	ns.default(api);
	state.flags.set('refresh', '0');
	const message = (await state.commands.statusline({args: '', cwd: api.cwd, exec: api.exec})).message;
	checkTrue('report lists the key table', message.includes('配置（键 / 默认 / 生效 / 来源）'), message);
	checkTrue('report points at unknown key (typo)', message.includes('未知键 "speedd"（用户）'), message);
	checkTrue('report points at unusable value', message.includes('"cache" 的取值不可用：期望 true / false'), message);
	checkTrue('report points at unknown preset', message.includes('未知预设 "nope"（用户）'), message);
	checkTrue('report names the config file', message.includes('statusline.json'), message);
	checkTrue('report advertises the interactive path', message.includes('/statusline config'), message);
	// 坏值被拒后必须回退到默认，而不是把 "yes" 当成真值用
	checkTrue(
		'rejected value falls back to the default',
		/^cache\s+true\s+true\s+内置默认$/m.test(message),
		message,
	);
	// 数值键：规范化后再显示（不是把配置里的字符串原样抄一遍）
	checkTrue('numeric key shown normalised', /^bar-width\s+12\s+12\s+内置默认$/m.test(message), message);
	// 默认预设 full 与内置默认同值，不该到处标「预设 full」（那是零信息）
	checkTrue('default preset is not reported as a source', !message.includes('预设 full'), message);
	useHome(baseHome);
}

{
	// 段位是被预设关掉的 → 来源要写清是哪个预设，用户才知道该改哪里
	useHome(homeWith({preset: 'minimal'}));
	const {api, state} = makeStub();
	ns.default(api);
	state.flags.set('refresh', '0');
	const message = (await state.commands.statusline({args: '', cwd: api.cwd, exec: api.exec})).message;
	checkTrue('preset-disabled key reported as 预设 minimal', /^cache\s+true\s+false\s+预设 minimal$/m.test(message), message);
	checkTrue('preset-enabled key reported as 内置默认', /^model\s+true\s+true\s+内置默认$/m.test(message), message);
	useHome(baseHome);
}

// 对抗性回归：下面四条都是先写探针复现、再修掉的
{
	// 1) 数值键被 spec.max 截断 —— 报告必须写底栏实际用的那个数，而且列不能和来源栏黏住
	useHome(homeWith({'bar-width': 100}));
	const {api, state} = makeStub();
	ns.default(api);
	state.flags.set('refresh', '0');
	await useBaselineUsage(state);
	await settle();
	const cells = (strip(state.statuses.at(-1)).match(/[█░]/g) ?? []).length;
	check('over-long bar-width is clamped in the footer', cells, 40);
	const message = (await state.commands.statusline({args: '', cwd: api.cwd, exec: api.exec})).message;
	checkTrue('report shows the clamped value', /^bar-width\s+12\s+40\s+用户$/m.test(message), message);
	useHome(baseHome);
}

{
	// 2) preset 名大小写不敏感 —— 生效了就不能再报「未知预设」，表里也要归一化成小写
	useHome(homeWith({preset: 'Minimal'}));
	const {api, state} = makeStub();
	ns.default(api);
	state.flags.set('refresh', '0');
	await useBaselineUsage(state);
	await settle();
	checkTrue('preset case is ignored', !strip(state.statuses.at(-1)).includes('$'), strip(state.statuses.at(-1)));
	const message = (await state.commands.statusline({args: '', cwd: api.cwd, exec: api.exec})).message;
	checkTrue('case-insensitive preset is not reported as unknown', !message.includes('未知预设'), message);
	checkTrue('report normalises the preset name', /^preset\s+full\s+minimal\s+用户$/m.test(message), message);
	useHome(baseHome);
}

{
	// 3) 坏 JSON：要指名道姓，不能显示成「没有配置文件」；写入器必须拒绝而不是把文件整份抹掉
	const home = homeWith(null);
	const target = join(home, '.commandcode', 'statusline.json');
	writeFileSync(target, '{ "cache":');
	useHome(home);
	const {api, state} = makeStub();
	ns.default(api);
	state.flags.set('refresh', '0');
	check('loadConfig reports the broken file', ns.loadConfig(FIXTURE_CWD).broken.length, 1);
	const message = (await state.commands.statusline({args: '', cwd: api.cwd, exec: api.exec})).message;
	checkTrue('broken file marked as 读不动', message.includes('（读不动）'), message);
	checkTrue('broken file gets a warning', message.includes('读不动（JSON 非法或顶层不是对象）'), message);
	let refused = false;
	try {
		ns.writeConfigKey(target, 'cost', false);
	} catch {
		refused = true;
	}
	check('writeConfigKey refuses to clobber a broken file', refused, true);
	check('broken file left byte-for-byte intact', readFileSync(target, 'utf8'), '{ "cache":');
	useHome(baseHome);
}

{
	// 3b) 顶层不是对象也算读不动（数组 / null / 数字），不能被当成「读到了但没键」
	for (const raw of ['[]', 'null', '123']) {
		const home = homeWith(null);
		writeFileSync(join(home, '.commandcode', 'statusline.json'), raw);
		useHome(home);
		check(`top-level ${raw} is reported as broken`, ns.loadConfig(FIXTURE_CWD).broken.length, 1);
	}
	useHome(baseHome);
}

{
	// 4) __proto__ 污染：既不能真把段位关掉，也不能让报告把「文件里的值」谎报成「内置默认」。
	// 注意必须写原始字符串：JS 里 {__proto__: …} 设的是原型，JSON.stringify 出来会是 {}
	const home = homeWith(null);
	writeFileSync(
		join(home, '.commandcode', 'statusline.json'),
		'{"__proto__": {"cache": false, "speed": false}}',
	);
	useHome(home);
	const {api, state} = makeStub();
	ns.default(api);
	state.flags.set('refresh', '0');
	await useBaselineUsage(state);
	await settle();
	const line = strip(state.statuses.at(-1));
	checkTrue('__proto__ cannot switch a segment off', line.includes('cache 22%') && line.includes('tok/s'), line);
	const message = (await state.commands.statusline({args: '', cwd: api.cwd, exec: api.exec})).message;
	checkTrue('__proto__ is reported as an unknown key', message.includes('未知键 "__proto__"'), message);
	checkTrue('cache still reported as 内置默认', /^cache\s+true\s+true\s+内置默认$/m.test(message), message);
	useHome(baseHome);
}

{
	// 来源要精确到是哪一份文件：项目级覆盖用户级
	const userHome = homeWith({cwd: false, speed: false});
	const projectHome = mkdtempSync(join(tmpdir(), 'statusline-proj-'));
	mkdirSync(join(projectHome, '.commandcode'), {recursive: true});
	writeFileSync(join(projectHome, '.commandcode', 'statusline.json'), JSON.stringify({cwd: true}));
	useHome(userHome);
	const {api, state} = makeStub({cwd: projectHome});
	ns.default(api);
	state.flags.set('refresh', '0');
	const message = (await state.commands.statusline({args: '', cwd: projectHome, exec: api.exec})).message;
	checkTrue('project-level key reported as 项目', /^cwd\s+true\s+true\s+项目$/m.test(message), message);
	checkTrue('user-level key reported as 用户', /^speed\s+true\s+false\s+用户$/m.test(message), message);
	useHome(baseHome);
}

// /statusline config：交互式改配置 → 写入 + 立刻重绘
{
	const home = homeWith({});
	useHome(home);
	const {api, state} = makeStub({answers: ['用户级', 'speed', '关', true, '完成']});
	ns.default(api);
	state.flags.set('refresh', '0');
	await useBaselineUsage(state);
	await settle();
	checkTrue('speed on before the flow', strip(state.statuses.at(-1)).includes('tok/s'));

	const message = (await state.commands.statusline({args: 'config', cwd: api.cwd, exec: api.exec, ui: api.ui}))
		.message;
	checkTrue('flow reports what it wrote', message.includes('已写入') && message.includes('speed=false'), message);
	check('flow wrote the user config', readFileSync(join(home, '.commandcode', 'statusline.json'), 'utf8'), '{\n  "speed": false\n}\n');
	checkTrue('flow repaints right away', !strip(state.statuses.at(-1)).includes('tok/s'), strip(state.statuses.at(-1)));
	checkTrue('flow reprints the report', message.includes('配置（键 / 默认 / 生效 / 来源）'), message);
	// 每次弹窗都带标题，且 select 的选项 label 唯一（宿主按 label 回值，重复就废了）
	checkTrue('every modal carries a title', state.modals.every(([, options]) => typeof options.title === 'string' && options.title.length > 0));
	const selects = state.modals.filter(([kind]) => kind === 'select').map(([, options]) => options);
	checkTrue('the flow used select + input + confirm', new Set(state.modals.map(([kind]) => kind)).size >= 2);
	checkTrue(
		'option labels are unique per select',
		selects.every(options => new Set(options.options.map(o => o.label)).size === options.options.length),
	);
	useHome(baseHome);
}

{
	// 预设走的是 select 的字符串分支；项目级必须写进一个一次性的目录，
	// 往 FIXTURE_CWD 里写会跨运行留下文件、污染后面所有读同一 fixture 的用例
	const home = homeWith({});
	const uiProject = mkdtempSync(join(tmpdir(), 'statusline-ui-proj-'));
	useHome(home);
	const {api, state} = makeStub({cwd: uiProject, answers: ['项目级', 'preset', 'minimal', true, '完成']});
	ns.default(api);
	state.flags.set('refresh', '0');
	await useBaselineUsage(state);
	await settle();
	const message = (await state.commands.statusline({args: 'config', cwd: api.cwd, exec: api.exec, ui: api.ui}))
		.message;
	checkTrue('flow writes a preset', message.includes('preset="minimal"'), message);
	check(
		'preset written to project scope',
		JSON.parse(readFileSync(join(uiProject, '.commandcode', 'statusline.json'), 'utf8')).preset,
		'minimal',
	);
	checkTrue('preset applied without a reload', !strip(state.statuses.at(-1)).includes('$'), strip(state.statuses.at(-1)));
	useHome(baseHome);
}

{
	// 数值键走的是 input 分支
	const home = homeWith({});
	useHome(home);
	const {api, state} = makeStub({answers: ['用户级', 'bar-width', '8', true, '完成']});
	ns.default(api);
	state.flags.set('refresh', '0');
	await useBaselineUsage(state);
	await settle();
	const beforeWidth = visibleLength(strip(state.statuses.at(-1)));
	const message = (await state.commands.statusline({args: 'config', cwd: api.cwd, exec: api.exec, ui: api.ui}))
		.message;
	checkTrue('numeric key written through input', message.includes('bar-width=8'), message);
	check('numeric key persisted', JSON.parse(readFileSync(join(home, '.commandcode', 'statusline.json'), 'utf8'))['bar-width'], 8);
	checkTrue(
		'narrower bar after the write',
		visibleLength(strip(state.statuses.at(-1))) === beforeWidth - 4,
		`${beforeWidth} → ${visibleLength(strip(state.statuses.at(-1)))}`,
	);
	useHome(baseHome);
}

{
	// refresh 改完要重启定时器，不能只在下次 reload 生效（这里故意不把 refresh 设成 0，
	// 让 onSessionStart 真的起一个定时器，从而走到 stopTimer/startTimer 两行）
	const home = homeWith({});
	useHome(home);
	const {api, state} = makeStub({answers: ['用户级', 'refresh', '30', true, '完成']});
	ns.default(api);
	state.hooks.onSessionStart({source: 'startup', sessionId: 'timer-session'});
	await settle();
	const message = (await state.commands.statusline({args: 'config', cwd: api.cwd, exec: api.exec, ui: api.ui}))
		.message;
	checkTrue('refresh written through input', message.includes('refresh=30'), message);
	check('refresh persisted', JSON.parse(readFileSync(join(home, '.commandcode', 'statusline.json'), 'utf8')).refresh, 30);
	state.hooks.onSessionEnd({reason: 'shutdown'});
	useHome(baseHome);
}

{
	// 取消（confirm 拒绝）不得落盘
	const home = homeWith(null);
	useHome(home);
	const {api, state} = makeStub({answers: ['用户级', 'cwd', '关', false, '完成']});
	ns.default(api);
	state.flags.set('refresh', '0');
	const message = (await state.commands.statusline({args: 'config', cwd: api.cwd, exec: api.exec, ui: api.ui}))
		.message;
	checkTrue('declined write changes nothing', message.includes('没有改动'), message);
	check('declined write leaves no file', existsSync(join(home, '.commandcode', 'statusline.json')), false);
	useHome(baseHome);
}

{
	// 老宿主的 ModUi 可能没有 select/input/confirm：必须退化成提示，而不是抛出 mod_error
	const home = homeWith(null);
	useHome(home);
	const {api, state} = makeStub();
	delete api.ui.select;
	delete api.ui.input;
	delete api.ui.confirm;
	ns.default(api);
	state.flags.set('refresh', '0');
	let message;
	try {
		message = (await state.commands.statusline({args: 'config', cwd: api.cwd, exec: api.exec, ui: api.ui}))
			.message;
	} catch (error) {
		message = `THREW: ${error.message}`;
	}
	checkTrue('missing modal API does not throw', message.startsWith('交互式配置需要 TUI'), message);
	checkTrue('missing modal API still reports', message.includes('配置（键 / 默认 / 生效 / 来源）'), message);
	useHome(baseHome);
}

{
	// headless（没有交互桥）：不落盘，退回诊断表
	const home = homeWith(null);
	useHome(home);
	const {api, state} = makeStub();
	ns.default(api);
	state.flags.set('refresh', '0');
	const message = (await state.commands.statusline({args: 'config', cwd: api.cwd, exec: api.exec, ui: api.ui}))
		.message;
	checkTrue('headless flow refuses to write', message.includes('需要 TUI'), message);
	checkTrue('headless flow falls back to the report', message.includes('配置（键 / 默认 / 生效 / 来源）'), message);
	check('headless flow leaves no file', existsSync(join(home, '.commandcode', 'statusline.json')), false);
	useHome(baseHome);
}

// 版本闸门是硬闸门：宿主偏旧就整个停用 —— 不注册 flag、不注册命令、不画底栏、不 spawn git
// 边界是查出来的：1.9.0 的 ModUi 没有 cmd.ui.capabilities（<1.10.0 会直接抛），1.10.0 起才有
{
	const cliRoot = join(mkdtempSync(join(tmpdir(), 'statusline-cli-')), 'node_modules', 'command-code');
	mkdirSync(join(cliRoot, 'dist'), {recursive: true});
	writeFileSync(join(cliRoot, 'dist', 'index.mjs'), '');
	writeFileSync(join(cliRoot, 'package.json'), JSON.stringify({name: 'command-code', version: '1.9.0'}));

	// 测试进程的 argv[1] 是测试文件本身，名字对不上 → 必须返回 undefined 而不是乱猜
	check('hostVersion refuses a non-cmdc entry', ns.hostVersion(), undefined);

	const argv1 = process.argv[1];
	process.argv[1] = join(cliRoot, 'dist', 'index.mjs');
	check('hostVersion reads the CLI manifest', ns.hostVersion(), '1.9.0');
	check('the researched floor is 1.10.0', ns.MIN_HOST_VERSION, '1.10.0');
	check('versionAtLeast equal', ns.versionAtLeast('1.10.0', '1.10.0'), true);
	check('versionAtLeast older', ns.versionAtLeast('1.9.9', '1.10.0'), false);
	check('versionAtLeast newer', ns.versionAtLeast('1.60.0', '1.10.0'), true);
	check('versionAtLeast tolerates a prerelease suffix', ns.versionAtLeast('1.10.0-beta.1', '1.10.0'), true);
	check('versionAtLeast short form', ns.versionAtLeast('2.0', '1.10.0'), true);

	const {api, state} = makeStub();
	ns.default(api);
	check('outdated host: no flags registered', state.flags.size, 0);
	check('outdated host: no commands registered', Object.keys(state.commands).length, 0);
	check('outdated host: nothing painted', state.statuses.length, 0);
	check('outdated host: no hooks registered either', state.hooks.onSessionStart, undefined);
	check('outdated host: no listeners registered', Object.keys(state.events).length, 0);
	check('outdated host: no git spawned', state.execCalls.length, 0);
	check('outdated host: exactly one notice', state.notices.length, 1);
	checkTrue(
		'outdated host: the notice tells the user to upgrade',
		state.notices[0][0].includes('cmdc update') && state.notices[0][0].includes('1.9.0') && state.notices[0][0].includes('已停用'),
		JSON.stringify(state.notices),
	);
	check('outdated host: the notice is an error', state.notices[0][1], 'error');

	// 边界另一侧：1.10.0 是受支持的（低于它才停用），必须照常注册
	writeFileSync(join(cliRoot, 'package.json'), JSON.stringify({name: 'command-code', version: '1.10.0'}));
	const atFloor = makeStub();
	ns.default(atFloor.api);
	check('the floor version itself is supported', atFloor.state.flags.size, 17);
	check('the floor version gets no upgrade notice', atFloor.state.notices.length, 0);
	check('the floor version registers the command', typeof atFloor.state.commands.statusline, 'function');
	process.argv[1] = argv1;

	// 读不到版本就不猜：mod 照常工作，报告里标成未知
	const fresh = makeStub();
	ns.default(fresh.api);
	check('unknown host version produces no notice', fresh.state.notices.length, 0);
	checkTrue(
		'unknown host version still registers everything',
		fresh.state.flags.size === 17 && typeof fresh.state.commands.statusline === 'function',
	);
	checkTrue(
		'unknown host version is reported as 未知',
		(await fresh.state.commands.statusline({args: '', cwd: fresh.api.cwd, exec: fresh.api.exec})).message.includes(
			`cmdc=未知（本 mod 要求 ≥ ${ns.MIN_HOST_VERSION}）`,
		),
	);
}

{
	// 交互面板缺失（headless 之外的运行方式）：不能抛出去变成 mod_error，要退化成提示
	const {api, state} = makeStub();
	for (const method of ['select', 'input', 'confirm']) delete api.ui[method];
	ns.default(api);
	state.flags.set('refresh', '0');
	const message = (await state.commands.statusline({args: 'config', cwd: api.cwd, exec: api.exec, ui: api.ui}))
		.message;
	checkTrue('missing modal API does not throw', message.startsWith('交互式配置需要 TUI'), message);
	checkTrue('missing modal API names the requirement', message.includes(`需 cmdc ≥ ${ns.MIN_HOST_VERSION}`), message);
	checkTrue('missing modal API writes nothing', message.includes('没有写任何文件'), message);
	checkTrue('missing modal API still reports', message.includes('配置（键 / 默认 / 生效 / 来源）'), message);
}

// version 字段不是版本号时不能去比："" / "unknown" 会被解析成 0，把好端端的安装误杀停用
{
	const cliRoot = join(mkdtempSync(join(tmpdir(), 'statusline-badver-')), 'node_modules', 'command-code');
	mkdirSync(join(cliRoot, 'dist'), {recursive: true});
	writeFileSync(join(cliRoot, 'dist', 'index.mjs'), '');
	const argv1 = process.argv[1];
	process.argv[1] = join(cliRoot, 'dist', 'index.mjs');

	for (const version of ['', 'unknown', 'dev', 'v1.54.0']) {
		writeFileSync(join(cliRoot, 'package.json'), JSON.stringify({name: 'command-code', version}));
		check(`hostVersion treats ${JSON.stringify(version)} as unknown`, ns.hostVersion(), undefined);
	}

	writeFileSync(join(cliRoot, 'package.json'), JSON.stringify({name: 'command-code', version: ''}));
	const {api, state} = makeStub();
	ns.default(api);
	check('a blank version does not disable the mod', state.flags.size, 17);
	check('a blank version produces no upgrade notice', state.notices.length, 0);
	check('a blank version does not throw', typeof state.commands.statusline, 'function');
	process.argv[1] = argv1;
}

// 没有配置文件但有命令行/预设定值时，报告不能自称「全部走内置默认」
{
	const home = homeWith(null);
	useHome(home);
	const {api, state} = makeStub();
	ns.default(api);
	state.flags.set('refresh', '0');
	state.flags.set('preset', 'minimal');
	const message = (await state.commands.statusline({args: '', cwd: api.cwd, exec: api.exec})).message;
	checkTrue('no false "all built-in defaults" claim', !message.includes('全部走内置默认'), message);
	checkTrue('the note points at the source column instead', message.includes('逐行看「来源」列'), message);
	checkTrue('a cli preset is reported as 命令行', /^preset\s+full\s+minimal\s+命令行$/m.test(message), message);
	useHome(baseHome);
}

// 记事本存的 UTF-8 BOM：文件内容是对的，不能因为一个 BOM 就判成「读不动」整份忽略
{
	const home = homeWith({});
	writeFileSync(join(home, '.commandcode', 'statusline.json'), `\uFEFF${JSON.stringify({speed: false})}`);
	useHome(home);
	const loaded = ns.loadConfig(FIXTURE_CWD);
	check('BOM config parses', [loaded.sources.length, loaded.broken.length, loaded.config.speed], [1, 0, false]);

	// 带 BOM 的文件也必须能就地改写（否则用户被卡住：UI 拒绝写，手改又看不出问题）
	ns.writeConfigKey(join(home, '.commandcode', 'statusline.json'), 'cost', false);
	check('BOM file can be rewritten', JSON.parse(readFileSync(join(home, '.commandcode', 'statusline.json'), 'utf8')), {speed: false, cost: false});
	useHome(baseHome);
}

// preset 是字符串键：写成数字必须被判为不可用，而不是让诊断表照抄一个不会生效的值
{
	useHome(homeWith({preset: 123}));
	const {api, state} = makeStub();
	ns.default(api);
	state.flags.set('refresh', '0');
	const message = (await state.commands.statusline({args: '', cwd: api.cwd, exec: api.exec})).message;
	checkTrue('numeric preset is refused', message.includes('"preset" 的取值不可用：期望 字符串'), message);
	checkTrue('numeric preset falls back instead of being echoed', /^preset\s+full\s+full\s+内置默认$/m.test(message), message);
	useHome(baseHome);
}

// 未知预设的落点必须说实话：命令行压着配置时不能声称「已按 full 处理」
{
	useHome(homeWith({preset: 'nope'}));
	const {api, state} = makeStub();
	ns.default(api);
	state.flags.set('refresh', '0');
	state.flags.set('preset', 'minimal');
	const message = (await state.commands.statusline({args: '', cwd: api.cwd, exec: api.exec})).message;
	checkTrue('unknown preset names the one actually in effect', message.includes('当前生效的是 preset=minimal'), message);
	checkTrue('unknown preset does not claim a wrong fallback', !message.includes('已按 full 处理'), message);
	useHome(baseHome);
}

// 超范围的数值：报告、选择器、底栏必须是同一个数（100 会被 spec.max 截到 40）
{
	useHome(homeWith({'bar-width': 100}));
	const {api, state} = makeStub({answers: ['用户级', '完成']});
	ns.default(api);
	state.flags.set('refresh', '0');
	await useBaselineUsage(state);
	await settle();
	const message = (await state.commands.statusline({args: '', cwd: api.cwd, exec: api.exec})).message;
	checkTrue('report shows the clamped bar-width', /^bar-width\s+12\s+40\s+用户$/m.test(message), message);

	const flow = await state.commands.statusline({args: 'config', cwd: api.cwd, exec: api.exec, ui: api.ui});
	const picker = state.modals.find(([kind, options]) => kind === 'select' && options.title.includes('状态栏 ·'));
	const row = picker[1].options.find(option => option.label === 'bar-width');
	checkTrue('picker shows the clamped value too', row.description.startsWith('40 ·'), row.description);
	checkTrue('config flow still works', flow.message.includes('没有改动'), flow.message);
	useHome(baseHome);
}

// 写到用户级、却被项目级盖住：必须当面说清，否则「提示已写入但底栏没变」看起来就是坏了
{
	const userHome = homeWith({});
	const pinned = mkdtempSync(join(tmpdir(), 'statusline-pinned-'));
	mkdirSync(join(pinned, '.commandcode'), {recursive: true});
	writeFileSync(join(pinned, '.commandcode', 'statusline.json'), JSON.stringify({cost: true}));
	useHome(userHome);
	const {api, state} = makeStub({cwd: pinned, answers: ['用户级', 'cost', '关', true, '完成']});
	ns.default(api);
	state.flags.set('refresh', '0');
	const message = (await state.commands.statusline({args: 'config', cwd: api.cwd, exec: api.exec, ui: api.ui}))
		.message;
	check('shadowed write still lands in the user file', JSON.parse(readFileSync(join(userHome, '.commandcode', 'statusline.json'), 'utf8')), {cost: false});
	checkTrue('shadowed write is called out', message.includes('被更高优先级盖住了') && message.includes('来源：项目'), message);
	useHome(baseHome);
}

{
	// 没被盖住时不能瞎报
	const home = homeWith({});
	useHome(home);
	const {api, state} = makeStub({answers: ['用户级', 'cost', '关', true, '完成']});
	ns.default(api);
	state.flags.set('refresh', '0');
	const message = (await state.commands.statusline({args: 'config', cwd: api.cwd, exec: api.exec, ui: api.ui}))
		.message;
	checkTrue('a clean write is not reported as shadowed', !message.includes('盖住'), message);
	useHome(baseHome);
}

// 9 份 README 和 MIN_HOST_VERSION 不能各自漂：改了常量就必须同步文档（同 gen-model-tables 的思路）
{
	const root = fileURLToPath(new URL('..', import.meta.url));
	const names = [
		'README.md',
		'README.zh-CN.md',
		'README.zh-TW.md',
		'README.ja.md',
		'README.ko.md',
		'README.es.md',
		'README.fr.md',
		'README.de.md',
		'README.ru.md',
	];
	const stale = names.filter(
		name => !readFileSync(join(root, name), 'utf8').includes(`≥ ${ns.MIN_HOST_VERSION}`),
	);
	check('every README states the host floor', stale, []);
}

const total = passed + failures.length;
if (failures.length === 0) console.log(`✓ all ${total} checks passed`);
else {
	console.log(`✗ ${failures.length}/${total} checks failed\n`);
	for (const failure of failures) console.log(`  ✗ ${failure}`);
	process.exitCode = 1;
}
