import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG, normalizeConfig } from "../domain/config-normalization.js";
import type { NormalizedPiStyleConfig } from "../domain/config-types.js";
import type { StartupReason } from "../features/startup/index.js";
import { PiStyleRuntimeController } from "./runtime.js";

export interface StartupResourceDiscovery {
	readonly skillPaths?: readonly string[];
	readonly promptPaths?: readonly string[];
	readonly themePaths?: readonly string[];
}

function toStartupResources(resources: StartupResourceDiscovery) {
	return {
		...(resources.promptPaths ? { contextFiles: resources.promptPaths.length } : {}),
		...(resources.themePaths ? { extensions: resources.themePaths.length } : {}),
		...(resources.skillPaths ? { skills: resources.skillPaths.length } : {}),
	};
}

export interface PiStyleApp {
	readonly runtime: PiStyleRuntimeController;
	readonly config: NormalizedPiStyleConfig;
	sessionStart(ctx: ExtensionContext, reason?: StartupReason, resources?: StartupResourceDiscovery): void;
	setResources(resources: StartupResourceDiscovery): void;
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
	let resources: StartupResourceDiscovery | undefined;
	return {
		runtime,
		get config() {
			return config;
		},
		sessionStart(ctx, reason = "startup", discoveredResources) {
			resources = discoveredResources;
			runtime.start({
				mode: ctx.mode,
				hasUI: ctx.hasUI,
				ui: ctx.ui,
				cwd: ctx.cwd,
				model: ctx.model,
				thinkingLevel: ctx.thinkingLevel,
				config,
				startupReason: reason,
				...(resources ? { resources: toStartupResources(resources) } : {}),
				getContextUsage: () => ctx.getContextUsage(),
			});
		},
		setResources(next) {
			resources = next;
			runtime.current?.updateStartupResources(toStartupResources(next));
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
