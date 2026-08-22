import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { diffConfig } from "../domain/config-diff.js";
import type { NormalizedPiStyleConfig } from "../domain/config-types.js";
import type { GitCommandRunner } from "../domain/providers.js";
import type { ContextSnapshot, StatusSnapshot } from "../domain/status.js";
import { normalizeThinkingLevel } from "../domain/status.js";
import { installEditor } from "../features/editor/index.js";
import { createClipboardImagePasteSurface } from "../features/messages/image-input.js";
import {
	installStartup,
	type StartupHost,
	type StartupReason,
	type StartupResources,
	type StartupSnapshot,
} from "../features/startup/index.js";
import { installStatusLine } from "../features/status-line/index.js";
import { DisposableStore } from "../shared/disposable-store.js";
import { CachedGitProvider, InMemoryContextProvider, InMemoryUsageProvider } from "./providers.js";
import { RenderScheduler } from "./render-scheduler.js";
import { createSnapshot, replaceSnapshot, type UiSnapshot } from "./snapshot.js";

/** Debounce window for coalescing git refresh spawns after invalidateGit(). */
const GIT_INVALIDATE_DEBOUNCE_MS = 250;

export interface RuntimeInstallationState {
	readonly status: "installed" | "disabled" | "failed";
	readonly editor: "installed" | "preserved" | "disabled" | "failed";
	readonly startup: "installed" | "disabled" | "failed";
}

export interface RuntimeUpdateOptions {
	readonly refreshContextUsage?: boolean;
	readonly refreshExtensionStatuses?: boolean;
}

export interface PiStyleRuntime {
	generation: number;
	readonly providerIdentity: { git: object; context: object; usage: object };
	readonly installationState: RuntimeInstallationState;
	mode: ExtensionContext["mode"];
	hasUI: boolean;
	disposed: boolean;
	snapshot: UiSnapshot;
	disposables: DisposableStore;
	scheduler: RenderScheduler;
	update(values: StatusSnapshot, options?: RuntimeUpdateOptions): boolean;
	updateStartupResources(resources: StartupResources): boolean;
	dismissStartup(): void;
	invalidateGit(): void;
	configure(config: NormalizedPiStyleConfig): void;
	dispose(): void;
}

export interface RuntimeHost {
	readonly mode: ExtensionContext["mode"];
	readonly hasUI: boolean;
	readonly ui?: ExtensionUIContext;
	readonly cwd?: string;
	readonly model?: { id?: string; name?: string; provider?: string; reasoning?: boolean } | undefined;
	readonly thinkingLevel?: string | undefined;
	readonly config: NormalizedPiStyleConfig;
	readonly startupReason?: StartupReason;
	readonly provider?: string;
	readonly requestRender?: () => void;
	readonly resources?: StartupResources;
	readonly extensionStatusProvider?: () => readonly import("../domain/status.js").ExtensionStatus[] | undefined;
	readonly gitRunner?: GitCommandRunner;
	getContextUsage?:
		| (() => { tokens: number | null; contextWindow: number; percent: number | null } | undefined)
		| undefined;
}

export function createPiStyleRuntime(
	host: RuntimeHost,
	generation: number,
	requestRender: () => void = host.requestRender ?? (() => {}),
): PiStyleRuntime {
	let disposed = false;
	const extensionStatuses = (): readonly import("../domain/status.js").ExtensionStatus[] | undefined => {
		if (!host.extensionStatusProvider) return undefined;
		try {
			return host.extensionStatusProvider();
		} catch {
			host.ui?.notify?.("pi-style extension statuses unavailable; provider recovery required", "warning");
			return [];
		}
	};
	const contextSnapshot = (): ContextSnapshot | undefined => {
		const usage = host.getContextUsage?.();
		if (!usage) return undefined;
		return {
			...(usage.tokens !== null ? { currentTokens: usage.tokens } : {}),
			windowTokens: usage.contextWindow,
			...(usage.percent !== null ? { percent: usage.percent } : {}),
		};
	};
	let currentConfig = host.config;
	const disposables = new DisposableStore();
	const scheduler = new RenderScheduler({ requestRender }, generation, () => !disposed);
	const git = new CachedGitProvider(host.gitRunner);
	// Debounced git refresh (invalidateGit): tool-result bursts fire one
	// invalidateGit per write/edit/bash, each of which would otherwise spawn a
	// `git status` process. Only one refresh may be pending at a time; the
	// handle is unreffed so it can never keep the process alive.
	let pendingGitRefresh: ReturnType<typeof setTimeout> | undefined;
	const contextProvider = new InMemoryContextProvider();
	const usageProvider = new InMemoryUsageProvider();
	const initialContext = contextSnapshot();
	const initialStatuses = extensionStatuses();
	const initialValues = {
		...(initialStatuses ? { extensionStatuses: initialStatuses } : {}),
		...(host.model?.name || host.model?.id ? { model: host.model.name ?? host.model.id } : {}),
		...(host.model?.provider ? { provider: host.model.provider } : {}),
		...(host.model?.reasoning !== undefined ? { reasoning: host.model.reasoning } : {}),
		...(host.thinkingLevel ? { thinkingLevel: normalizeThinkingLevel(host.thinkingLevel) } : {}),
		...(host.cwd ? { cwd: host.cwd } : {}),
		...(initialContext ? { context: initialContext } : {}),
	};
	let currentSnapshot = createSnapshot(generation, 0, initialValues);
	let statusLine: ReturnType<typeof installStatusLine> | undefined;
	let editor: ReturnType<typeof installEditor> | undefined;
	let startup: ReturnType<typeof installStartup> | undefined;
	let installationState: RuntimeInstallationState = {
		status: "disabled",
		editor: "disabled",
		startup: "disabled",
	};
	const snapshotValues = (snapshot: UiSnapshot): StatusSnapshot => {
		const { generation: _generation, revision: _revision, ...values } = snapshot;
		return values;
	};
	const withSnapshotPatch = (
		patch: Partial<Record<keyof StatusSnapshot, StatusSnapshot[keyof StatusSnapshot] | undefined>>,
	): StatusSnapshot => {
		const next = { ...snapshotValues(currentSnapshot) } as Record<string, unknown>;
		for (const [key, value] of Object.entries(patch)) {
			if (value === undefined) delete next[key];
			else next[key] = value;
		}
		return next as StatusSnapshot;
	};
	const createStartupSnapshot = (
		config: NormalizedPiStyleConfig,
		resources: StartupResources | undefined = host.resources,
	): StartupSnapshot => ({
		...currentSnapshot,
		reason: host.startupReason ?? "startup",
		...(host.provider ? { startupProvider: host.provider } : {}),
		...(host.cwd ? { project: host.cwd.split(/[\\/]/).filter(Boolean).at(-1) } : {}),
		preset: config.preset,
		...(resources ? { resources } : {}),
	});
	const applySnapshot = (nextSnapshot: UiSnapshot): boolean => {
		if (nextSnapshot === currentSnapshot) return false;
		currentSnapshot = nextSnapshot;
		statusLine?.update(currentSnapshot);
		editor?.update(currentSnapshot);
		startup?.update(createStartupSnapshot(currentConfig));
		return true;
	};
	const updateSnapshot = (values: StatusSnapshot): boolean =>
		applySnapshot(replaceSnapshot(currentSnapshot, generation, values));
	const installStatus = () => {
		if (!host.hasUI || host.mode !== "tui" || !host.ui || !currentConfig.enabled || !currentConfig.statusLine.enabled) {
			installationState = { ...installationState, status: "disabled" };
			return;
		}
		try {
			statusLine = installStatusLine({
				host: host.ui,
				config: currentConfig,
				generation,
				initialSnapshot: currentSnapshot,
				isCurrent: () => !disposed,
				clearOnStartup: host.startupReason === "startup",
			});
			if (statusLine) {
				disposables.add(statusLine);
				installationState = { ...installationState, status: "installed" };
			} else installationState = { ...installationState, status: "failed" };
		} catch (error) {
			host.ui.notify?.(
				`pi-style status unavailable: ${error instanceof Error ? error.message : "installation failed"}`,
				"warning",
			);
			statusLine = undefined;
			installationState = { ...installationState, status: "failed" };
		}
	};
	const installEditorFeature = () => {
		if (!host.hasUI || host.mode !== "tui" || !host.ui || !currentConfig.enabled || !currentConfig.editor.enabled) {
			installationState = { ...installationState, editor: "disabled" };
			return;
		}
		try {
			editor = installEditor({
				host: host.ui,
				config: currentConfig,
				generation,
				initialSnapshot: currentSnapshot,
				isCurrent: () => !disposed,
				// Clipboard image paste surface (ADR 0009): instant `[Image #N] `
				// markers at keystroke time, artifact fallback, atomic backspace.
				clipboardImagePaste: createClipboardImagePasteSurface(),
			});
			if (editor) {
				disposables.add(editor);
				installationState = { ...installationState, editor: editor.preservedPrevious ? "preserved" : "installed" };
			} else installationState = { ...installationState, editor: "failed" };
		} catch (error) {
			host.ui.notify?.(
				`pi-style editor unavailable: ${error instanceof Error ? error.message : "installation failed"}`,
				"warning",
			);
			editor = undefined;
			installationState = { ...installationState, editor: "failed" };
		}
	};
	const installStartupFeature = () => {
		if (
			!host.hasUI ||
			host.mode !== "tui" ||
			!host.ui ||
			!currentConfig.enabled ||
			currentConfig.startup.mode === "off"
		) {
			installationState = { ...installationState, startup: "disabled" };
			return;
		}
		try {
			startup = installStartup({
				host: { ...(host.ui as unknown as StartupHost), mode: host.mode, hasUI: host.hasUI },
				config: currentConfig,
				snapshot: createStartupSnapshot(currentConfig),
				generation,
				requestRender,
				timeoutMs: 3000,
				isCurrent: () => !disposed,
			});
			if (startup) {
				disposables.add(startup);
				installationState = { ...installationState, startup: "installed" };
			} else installationState = { ...installationState, startup: "failed" };
		} catch (error) {
			host.ui.notify?.(
				`pi-style startup unavailable: ${error instanceof Error ? error.message : "installation failed"}`,
				"warning",
			);
			startup = undefined;
			installationState = { ...installationState, startup: "failed" };
		}
	};
	const disposeFeature = (label: string, dispose: (() => void) | undefined): void => {
		if (!dispose) return;
		try {
			dispose();
		} catch (error) {
			host.ui?.notify?.(`pi-style ${label} cleanup failed; preserving the current owner`, "warning");
			void error;
		}
	};
	const disposeStatus = () => {
		disposeFeature("status", statusLine?.dispose);
		statusLine = undefined;
		installationState = { ...installationState, status: "disabled" };
	};
	const disposeEditor = () => {
		disposeFeature("editor", editor?.dispose);
		editor = undefined;
		installationState = { ...installationState, editor: "disabled" };
	};
	const disposeStartup = () => {
		disposeFeature("startup", startup?.dispose);
		startup = undefined;
		installationState = { ...installationState, startup: "disabled" };
	};
	installStatus();
	installEditorFeature();
	installStartupFeature();
	if (host.cwd && currentConfig.enabled && currentConfig.statusLine.enabled) {
		void git.get(host.cwd).then((value) => {
			if (disposed) return;
			if (updateSnapshot(withSnapshotPatch({ git: value }))) requestRender();
		});
	}
	if (initialContext) contextProvider.set("active", initialContext);
	return {
		generation,
		providerIdentity: { git, context: contextProvider, usage: usageProvider },
		get installationState() {
			return installationState;
		},
		mode: host.mode,
		hasUI: host.hasUI,
		get snapshot() {
			return currentSnapshot;
		},
		disposables,
		scheduler,
		updateStartupResources(resources) {
			if (disposed || !startup) return false;
			startup.update(createStartupSnapshot(currentConfig, resources));
			requestRender();
			return true;
		},
		dismissStartup() {
			startup?.dismiss();
		},
		update(values, options = {}) {
			if (disposed) return false;
			const patch: Partial<Record<keyof StatusSnapshot, StatusSnapshot[keyof StatusSnapshot] | undefined>> = {
				...(values as Partial<Record<keyof StatusSnapshot, StatusSnapshot[keyof StatusSnapshot] | undefined>>),
			};
			if (options.refreshContextUsage) {
				const context = contextSnapshot();
				patch.context = context;
				if (context) contextProvider.set("active", context);
				else contextProvider.clear();
			}
			if (options.refreshExtensionStatuses) patch.extensionStatuses = extensionStatuses();
			return updateSnapshot(withSnapshotPatch(patch));
		},
		configure(nextConfig) {
			if (disposed) return;
			const previous = currentConfig;
			const impactPlan = diffConfig(previous, nextConfig);
			if (impactPlan.impacts.length === 0) return;
			currentConfig = nextConfig;
			const statusChanged =
				JSON.stringify(previous.statusLine) !== JSON.stringify(nextConfig.statusLine) ||
				previous.placement !== nextConfig.placement ||
				previous.enabled !== nextConfig.enabled;
			const editorChanged =
				JSON.stringify(previous.editor) !== JSON.stringify(nextConfig.editor) ||
				previous.enabled !== nextConfig.enabled;
			const startupChanged =
				JSON.stringify(previous.startup) !== JSON.stringify(nextConfig.startup) ||
				previous.enabled !== nextConfig.enabled;
			if (statusChanged) {
				disposeStatus();
				currentConfig = nextConfig;
				installStatus();
			}
			if (editorChanged) {
				disposeEditor();
				currentConfig = nextConfig;
				installEditorFeature();
			}
			if (startupChanged) {
				disposeStartup();
				currentConfig = nextConfig;
				installStartupFeature();
			}
			statusLine?.configure(nextConfig);
			editor?.configure(nextConfig);
			startup?.configure(nextConfig);
		},
		invalidateGit() {
			if (disposed || !host.cwd || !currentConfig.enabled || !currentConfig.statusLine.enabled) return;
			const cwd = host.cwd;
			// Mark the cache stale immediately (cheap, no spawn); the actual
			// `git status` process spawn is coalesced behind a short debounce so
			// bursts of tool results trigger ONE refresh, not one per event.
			// CachedGitProvider serializes concurrent gets via entry.promise and
			// honors invalidate-during-flight (needsRefresh re-runs the fetch),
			// so this debounce only reduces spawn count and never loses a signal.
			git.invalidate(cwd);
			if (pendingGitRefresh !== undefined) return;
			pendingGitRefresh = setTimeout(() => {
				pendingGitRefresh = undefined;
				if (disposed) return;
				void git.get(cwd).then((value) => {
					if (disposed) return;
					if (updateSnapshot(withSnapshotPatch({ git: value }))) requestRender();
				});
			}, GIT_INVALIDATE_DEBOUNCE_MS);
			pendingGitRefresh.unref?.();
		},
		get disposed() {
			return disposed;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			if (pendingGitRefresh !== undefined) {
				clearTimeout(pendingGitRefresh);
				pendingGitRefresh = undefined;
			}
			scheduler.cancel();
			// UI surfaces are restored synchronously so teardown is deterministic;
			// the store then disposes the (already disposed) feature instances idempotently.
			disposeStatus();
			disposeEditor();
			disposeStartup();
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
