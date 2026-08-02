import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DisposableStore } from "../shared/disposable-store.js";
import { RenderScheduler } from "./render-scheduler.js";
import { createSnapshot, type UiSnapshot } from "./snapshot.js";

export interface PiStyleRuntime {
	generation: number;
	mode: ExtensionContext["mode"];
	hasUI: boolean;
	disposed: boolean;
	snapshot: UiSnapshot;
	disposables: DisposableStore;
	scheduler: RenderScheduler;
	dispose(): void;
}

export interface RuntimeHost {
	readonly mode: ExtensionContext["mode"];
	readonly hasUI: boolean;
}

export function createPiStyleRuntime(
	host: RuntimeHost,
	generation: number,
	requestRender: () => void = () => {},
): PiStyleRuntime {
	let disposed = false;
	const disposables = new DisposableStore();
	const scheduler = new RenderScheduler({ requestRender }, generation, () => !disposed);
	return {
		generation,
		mode: host.mode,
		hasUI: host.hasUI,
		snapshot: createSnapshot(generation),
		disposables,
		scheduler,
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

	start(ctx: Pick<ExtensionContext, "mode" | "hasUI">): PiStyleRuntime {
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
