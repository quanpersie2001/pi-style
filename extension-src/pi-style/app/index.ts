import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { PiStyleRuntimeController } from "./runtime.js";

export interface PiStyleApp {
	readonly runtime: PiStyleRuntimeController;
	sessionStart(ctx: Pick<ExtensionContext, "mode" | "hasUI">): void;
	sessionShutdown(): void;
}

export function createPiStyleApp(): PiStyleApp {
	const runtime = new PiStyleRuntimeController();

	return {
		runtime,
		sessionStart(ctx) {
			runtime.start(ctx);
		},
		sessionShutdown() {
			runtime.stop();
		},
	};
}
