import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG } from "../domain/config-normalization.js";
import type { StatusSnapshot } from "../domain/status.js";
import { normalizeThinkingLevel } from "../domain/status.js";
import { installStatusLine } from "../features/status-line/index.js";
import { DisposableStore } from "../shared/disposable-store.js";
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
	dispose(): void;
}

export interface RuntimeHost {
	readonly mode: ExtensionContext["mode"];
	readonly hasUI: boolean;
	readonly ui?: ExtensionUIContext;
	readonly cwd?: string;
	readonly model?: { id?: string; name?: string } | undefined;
	readonly thinkingLevel?: string | undefined;
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
	const disposables = new DisposableStore();
	const scheduler = new RenderScheduler({ requestRender }, generation, () => !disposed);
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
	if (host.hasUI && host.mode !== "json" && host.mode !== "print" && host.ui) {
		statusLine = installStatusLine({
			host: host.ui,
			config: DEFAULT_CONFIG,
			generation,
			initialSnapshot: currentSnapshot,
			isCurrent: () => !disposed,
		});
		disposables.add(statusLine);
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
			currentSnapshot = replaceSnapshot(currentSnapshot, generation, { ...currentSnapshot, ...values });
			statusLine?.update(currentSnapshot);
		},
		get disposed() {
			return disposed;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			scheduler.cancel();
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
