// Command Code mod API 的本地类型声明。
// 为什么不是依赖：ModApi 的类型不在任何已发布的包里 —— `@commandcode/harness` 未发布，
// `command-code` 包内也没有 .d.ts（dist 只有打包产物与文档）。这份声明按产品文档
// dist/bundled/mod-builder/reference/{api,ui,hooks-and-events}.md 的表面手写，
// 仅供 `tsc --noEmit` 校验本 mod；宿主 API 变更时以文档为准同步这里。
// 运行时不参与：`import type` 会被 Node 类型擦除整个抹掉，不解析这个文件。

export interface Disposable {
	dispose(): void;
}

export interface ModUiSelectOption {
	label: string;
	description?: string;
}

// 文档契约（ui.md）：TUI 里 select/input/confirm 是真弹窗；headless 下
// confirm → false、select/input → undefined，绝不自动批准。
export interface ModUi {
	// 可选是如实的，不是保守：1.9.0 的 ModUi 上确实没有这个属性（那一版的 setStatus 还是个
	// 空操作），1.10.0 起才有 —— 它正是 MIN_HOST_VERSION 要守的那个依赖，也是把版本下限
	// 定在 1.10.0 的原因。声明成必选会让调用点写出一个在旧宿主上必抛的取属性。
	capabilities?: {status: boolean};
	setStatus(text: string | null): Disposable;
	notify(message: string, level?: 'info' | 'warning' | 'error' | string): void;
	confirm(options: {title: string; message?: string}): Promise<boolean>;
	select(options: {
		title: string;
		options: readonly ModUiSelectOption[];
	}): Promise<string | undefined>;
	input(options: {title: string; placeholder?: string}): Promise<string | undefined>;
}

// onSessionStart 收 {source: 'startup' | 'resume', ...}，onSessionEnd 收
// {reason: 'shutdown' | 'replaced'}（api.md）：'replaced' 意味着宿主会在同进程换会话。
export interface ModHooks {
	onSessionStart?: (info: {source?: string; sessionId?: string}) => void;
	onSessionEnd?: (info: {reason?: string}) => void;
	[key: string]: unknown;
}

export interface ModCommandContext {
	args?: unknown;
	ui?: ModUi;
	cwd?: string;
	exec?: ModApi['exec'];
}

export interface ModCommand {
	name: string;
	description?: string;
	argumentHint?: string;
	handler: (context: ModCommandContext) => unknown;
}

export interface ModExecResult {
	stdout: string;
	stderr: string;
	code: number;
}

export interface ModApi {
	name: string;
	cwd: string;
	ui: ModUi;
	hooks(hooks: ModHooks): Disposable;
	addFlag(
		name: string,
		spec: {type: 'boolean' | 'string'; default?: boolean | string; description?: string},
	): Disposable;
	getFlag(name: string): boolean | string | undefined;
	on(event: string, handler: (event: unknown) => void): Disposable;
	addCommand(command: ModCommand): Disposable;
	exec(options: {
		command: string;
		args?: string[];
		cwd?: string;
		signal?: AbortSignal;
	}): Promise<ModExecResult>;
}
