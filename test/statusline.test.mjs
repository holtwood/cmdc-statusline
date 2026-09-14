import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

// 直接吃 TypeScript：Node 22.18+/24 原生类型擦除，无需构建或 jiti。
// 想测另一份副本（例如已部署的 ~/.commandcode/mods/statusline.ts）：STATUSLINE_MOD=/path/to/file.ts
const MOD_PATH =
	process.env.STATUSLINE_MOD ?? fileURLToPath(new URL('../index.ts', import.meta.url));

const FIXTURE_CWD = '/tmp/statusline-fixture/my-project';

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
	readSessionCost,
	cacheHitRate,
	formatRate,
	visibleLength,
	loadConfig,
} = ns;

// ── pure helpers ────────────────────────────────────────────────────────────────────
check('formatTokens 999', formatTokens(999), '999');
check('formatTokens 5120', formatTokens(5120), '5.1k');
check('formatTokens 28421', formatTokens(28421), '28k');
check('shortModel strips vendor', shortModel('deepseek/deepseek-v4.1-flash'), 'deepseek-v4.1-flash');
check('shortModel keeps bare id', shortModel('gpt-5.6'), 'gpt-5.6');
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
function makeStub({statusCapability = true, gitCode = 0, gitStdout = porcelain, env = {}, cwd = FIXTURE_CWD} = {}) {
	const saved = {};
	for (const [key, value] of Object.entries(env)) {
		saved[key] = process.env[key];
		process.env[key] = value;
	}
	const state = {
		statuses: [],
		execCalls: [],
		flags: new Map(),
		hooks: {},
		events: {},
		commands: {},
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
			notify: () => {},
		},
	};
	return {api, state};
}

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

const realHome = process.env.HOME;
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
	check('registers 16 flags', state.flags.size, 16);
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
	process.env.HOME = fakeHome;
	const {api, state} = makeStub();
	ns.default(api);
	state.flags.set('refresh', '0');
	state.hooks.onSessionStart({source: 'resume', sessionId: seededSession});
	await settle();
	check('resume seeds title from meta.json', strip(state.statuses.at(-1)), 'Seeded Session Name │ main ↑1↓2 │ +1 ~1 ?1 │ my-project');
	process.env.HOME = realHome;
}

// 会话花费：恢复会话时从 transcript 求和，重启不清零
{
	process.env.HOME = fakeHome;
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
	checkClose('readSessionCost sums transcript', await readSessionCost(costSession, FIXTURE_CWD), 0.35, 1e-9);
	check('readSessionCost missing file', await readSessionCost('no-such-session', FIXTURE_CWD), undefined);

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
	process.env.HOME = realHome;
}

// 损坏的 meta.json 不崩、不编名字
{
	process.env.HOME = fakeHome;
	const {api, state} = makeStub();
	ns.default(api);
	state.flags.set('refresh', '0');
	state.hooks.onSessionStart({source: 'resume', sessionId: 'broken-session-id'});
	await settle();
	check('corrupt meta.json is ignored', strip(state.statuses.at(-1)), 'main ↑1↓2 │ +1 ~1 ?1 │ my-project');
	process.env.HOME = realHome;
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
	const projectName = cfgProject.split('/').pop();

	const savedHome = process.env.HOME;
	process.env.HOME = cfgHome;
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
	process.env.HOME = cfgHome;
	ns.default(cli.api);
	cli.state.flags.set('refresh', '0');
	cli.state.flags.set('git', false);
	cli.state.flags.set('speed', false);
	await useBaselineUsage(cli.state);
	await settle();
	checkTrue('cli flag beats config (speed off)', !strip(cli.state.statuses.at(-1)).includes('tok/s'), strip(cli.state.statuses.at(-1)));
	cli.state.restore();
	process.env.HOME = savedHome;
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

const total = passed + failures.length;
if (failures.length === 0) console.log(`✓ all ${total} checks passed`);
else {
	console.log(`✗ ${failures.length}/${total} checks failed\n`);
	for (const failure of failures) console.log(`  ✗ ${failure}`);
	process.exitCode = 1;
}
