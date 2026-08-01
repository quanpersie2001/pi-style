import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface PiStyleRuntime {
	generation: number;
	mode: ExtensionContext["mode"];
	hasUI: boolean;
	disposed: boolean;
	dispose(): void;
}

export interface RuntimeHost {
	readonly mode: ExtensionContext["mode"];
	readonly hasUI: boolean;
}

export function createPiStyleRuntime(host: RuntimeHost, generation: number): PiStyleRuntime {
	let disposed = false;

	return {
		generation,
		mode: host.mode,
		hasUI: host.hasUI,
		get disposed() {
			return disposed;
		},
		dispose() {
			disposed = true;
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
