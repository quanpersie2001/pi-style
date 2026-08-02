import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { NormalizedPiStyleConfig } from "../domain/config-types.js";
import type { StatusSnapshot } from "../domain/status.js";
import { normalizeThinkingLevel } from "../domain/status.js";
import { installEditor } from "../features/editor/index.js";
import { installStatusLine } from "../features/status-line/index.js";
import { DisposableStore } from "../shared/disposable-store.js";
import { CachedGitProvider, InMemoryContextProvider, InMemoryUsageProvider } from "./providers.js";
import { RenderScheduler } from "./render-scheduler.js";
import { createSnapshot, replaceSnapshot, type UiSnapshot } from "./snapshot.js";

export interface PiStyleRuntime {
	generation: number;
	mode: ExtensionContext["mode"];
	hasUI: boolean;
	disposed: boolean;
	snapshot: UiSnapshot;
	disposables: DisposableStore;
	scheduler: RenderScheduler;
	update(values: StatusSnapshot): void;
	invalidateGit(): void;
	configure(config: NormalizedPiStyleConfig): void;
	dispose(): void;
}

export interface RuntimeHost {
	readonly mode: ExtensionContext["mode"];
	readonly hasUI: boolean;
	readonly ui?: ExtensionUIContext;
	readonly cwd?: string;
	readonly model?: { id?: string; name?: string } | undefined;
	readonly thinkingLevel?: string | undefined;
	readonly config: NormalizedPiStyleConfig;
	getContextUsage?:
		| (() => { tokens: number | null; contextWindow: number; percent: number | null } | undefined)
		| undefined;
}

export function createPiStyleRuntime(
	host: RuntimeHost,
	generation: number,
	requestRender: () => void = () => {},
): PiStyleRuntime {
	let disposed = false;
	let currentConfig = host.config;
	const disposables = new DisposableStore();
	const scheduler = new RenderScheduler({ requestRender }, generation, () => !disposed);
	const git = new CachedGitProvider();
	const contextProvider = new InMemoryContextProvider();
	const usageProvider = new InMemoryUsageProvider();
	const usage = host.getContextUsage?.();
	const initialValues = {
		...(host.model?.name || host.model?.id ? { model: host.model.name ?? host.model.id } : {}),
		...(host.thinkingLevel ? { thinkingLevel: normalizeThinkingLevel(host.thinkingLevel) } : {}),
		...(host.cwd ? { cwd: host.cwd } : {}),
		...(usage
			? {
					context: {
						...(usage.tokens !== null ? { currentTokens: usage.tokens } : {}),
						windowTokens: usage.contextWindow,
						...(usage.percent !== null ? { percent: usage.percent } : {}),
					},
				}
			: {}),
	};
	let currentSnapshot = createSnapshot(generation, 0, initialValues);
	let statusLine: ReturnType<typeof installStatusLine> | undefined;
	let editor: ReturnType<typeof installEditor> | undefined;
	if (host.hasUI && host.mode === "tui" && host.ui) {
		statusLine = installStatusLine({
			host: host.ui,
			config: currentConfig,
			generation,
			initialSnapshot: currentSnapshot,
			isCurrent: () => !disposed,
		});
		disposables.add(statusLine);
		if (currentConfig.enabled && currentConfig.editor.enabled) {
			editor = installEditor({
				host: host.ui,
				config: currentConfig,
				generation,
				initialSnapshot: currentSnapshot,
				isCurrent: () => !disposed,
			});
			if (editor) disposables.add(editor);
		}
	}
	if (host.cwd && currentConfig.enabled && currentConfig.statusLine.enabled) {
		void git.get(host.cwd).then((value) => {
			if (disposed) return;
			currentSnapshot = replaceSnapshot(currentSnapshot, generation, { ...currentSnapshot, git: value });
			statusLine?.update(currentSnapshot);
			editor?.update(currentSnapshot);
			requestRender();
		});
	}
	if (usage) {
		contextProvider.set("active", {
			...(usage.tokens !== null ? { currentTokens: usage.tokens } : {}),
			windowTokens: usage.contextWindow,
			...(usage.percent !== null ? { percent: usage.percent } : {}),
		});
	}
	return {
		generation,
		mode: host.mode,
		hasUI: host.hasUI,
		snapshot: currentSnapshot,
		disposables,
		scheduler,
		update(values) {
			if (disposed) return;
			const liveUsage = host.getContextUsage?.();
			const context = liveUsage
				? {
						...(liveUsage.tokens !== null ? { currentTokens: liveUsage.tokens } : {}),
						windowTokens: liveUsage.contextWindow,
						...(liveUsage.percent !== null ? { percent: liveUsage.percent } : {}),
					}
				: undefined;
			currentSnapshot = replaceSnapshot(currentSnapshot, generation, {
				...currentSnapshot,
				...values,
				...(context ? { context } : {}),
			});
			statusLine?.update(currentSnapshot);
			editor?.update(currentSnapshot);
		},
		configure(nextConfig) {
			if (disposed) return;
			currentConfig = nextConfig;
			statusLine?.configure(nextConfig);
			editor?.configure(nextConfig);
		},
		invalidateGit() {
			if (disposed || !host.cwd || !currentConfig.enabled || !currentConfig.statusLine.enabled) return;
			git.invalidate(host.cwd);
			void git.get(host.cwd).then((value) => {
				if (disposed) return;
				currentSnapshot = replaceSnapshot(currentSnapshot, generation, { ...currentSnapshot, git: value });
				statusLine?.update(currentSnapshot);
				editor?.update(currentSnapshot);
				requestRender();
			});
		},
		get disposed() {
			return disposed;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			scheduler.cancel();
			git.dispose();
			contextProvider.clear();
			usageProvider.reset();
			void disposables.dispose();
		},
	};
}

export class PiStyleRuntimeController {
	private activeRuntime: PiStyleRuntime | undefined;
	private nextGeneration = 0;

	start(ctx: RuntimeHost): PiStyleRuntime {
		this.stop();
		this.activeRuntime = createPiStyleRuntime(ctx, ++this.nextGeneration);
		return this.activeRuntime;
	}

	stop(): void {
		this.activeRuntime?.dispose();
		this.activeRuntime = undefined;
	}

	get current(): PiStyleRuntime | undefined {
		return this.activeRuntime;
	}
}
