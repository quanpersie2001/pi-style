import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG, normalizeConfig } from "../domain/config-normalization.js";
import type { NormalizedPiStyleConfig } from "../domain/config-types.js";
import { PiStyleRuntimeController } from "./runtime.js";

export interface PiStyleApp {
	readonly runtime: PiStyleRuntimeController;
	readonly config: NormalizedPiStyleConfig;
	sessionStart(ctx: Pick<ExtensionContext, "mode" | "hasUI">): void;
	sessionShutdown(): void;
	reload(input?: unknown): void;
}

export function createPiStyleApp(): PiStyleApp {
	const runtime = new PiStyleRuntimeController();
	let config = DEFAULT_CONFIG;
	return {
		runtime,
		get config() {
			return config;
		},
		sessionStart(ctx) {
			runtime.start(ctx);
		},
		sessionShutdown() {
			runtime.stop();
		},
		reload(input) {
			config = normalizeConfig(input);
		},
	};
}
