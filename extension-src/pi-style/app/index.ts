import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG, normalizeConfig } from "../domain/config-normalization.js";
import type { NormalizedPiStyleConfig } from "../domain/config-types.js";
import { PiStyleRuntimeController } from "./runtime.js";

export interface PiStyleApp {
	readonly runtime: PiStyleRuntimeController;
	readonly config: NormalizedPiStyleConfig;
	sessionStart(ctx: ExtensionContext): void;
	sessionShutdown(): void;
	update(
		values: import("../domain/status.js").StatusSnapshot,
		kind?: import("./render-scheduler.js").UpdateClass,
	): void;
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
			runtime.start({
				mode: ctx.mode,
				hasUI: ctx.hasUI,
				ui: ctx.ui,
				cwd: ctx.cwd,
				model: ctx.model,
				thinkingLevel: ctx.thinkingLevel,
				config,
				getContextUsage: () => ctx.getContextUsage(),
			});
		},
		sessionShutdown() {
			runtime.stop();
		},
		update(values, kind = "coalesced") {
			const active = runtime.current;
			if (!active) return;
			active.update(values);
			active.scheduler.schedule(kind);
		},
		reload(input) {
			config = normalizeConfig(input);
			runtime.current?.configure(config);
		},
	};
}
