import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiStyleApp } from "../app/index.js";
import { resolveConfig } from "../domain/config-normalization.js";
import {
	type CompatibilityCleanupResult,
	type CompatibilityProbeReport,
	detectPiVersion,
	disposePiCompatibilityProbe,
	probePiCompatibility,
} from "./compatibility-probe.js";

type CompatibilityTestHooks = {
	dispose?: (report: CompatibilityProbeReport) => CompatibilityCleanupResult;
};
let compatibilityTestHooks: CompatibilityTestHooks = {};
export function __setCompatibilityTestHooks(hooks: CompatibilityTestHooks): () => void {
	const previous = compatibilityTestHooks;
	compatibilityTestHooks = hooks;
	return () => {
		compatibilityTestHooks = previous;
	};
}
function disposeCompatibilityProbe(report: CompatibilityProbeReport): CompatibilityCleanupResult {
	return compatibilityTestHooks.dispose?.(report) ?? disposePiCompatibilityProbe(report);
}

/**
 * Thin Pi adapter: register lifecycle hooks and delegate session state to app/.
 */
function sessionFlagOverrides(pi: ExtensionAPI): Record<string, unknown> {
	const session: Record<string, unknown> = {};
	const core = pi.getFlag("pi-style-core-patches") === true;
	const user = pi.getFlag("pi-style-message-user") === true;
	const assistant = pi.getFlag("pi-style-message-assistant") === true;
	const tools = pi.getFlag("pi-style-tools") === true;
	// Tier C is default-deny: each private surface needs both the core gate and
	// its own explicit flag. Ordinary product defaults never authorize patches.
	session.compatibility = { allowCorePatches: core };
	session.messages = {
		enabled: core && (user || assistant),
		userPrefix: core && user,
		assistantPrefix: core && assistant,
	};
	session.tools = { enabled: core && tools };
	if (pi.getFlag("pi-style-ascii") === true) session.preset = "ascii";
	return session;
}

export default function piStyleExtension(pi: ExtensionAPI): void {
	const app = createPiStyleApp();
	for (const [name, description] of [
		["pi-style-core-patches", "Enable opt-in pi-style message/tool core patches"],
		["pi-style-message-user", "Enable pi-style user message prefix"],
		["pi-style-message-assistant", "Enable pi-style assistant message prefix"],
		["pi-style-tools", "Enable pi-style tool renderer decoration"],
		["pi-style-ascii", "Use ASCII pi-style markers"],
	] as const)
		pi.registerFlag(name, { type: "boolean", description });
	let compatibilityProbe: CompatibilityProbeReport | undefined;

	pi.on("session_start", (event, ctx) => {
		let cleanedPreviousProbe = false;
		if (compatibilityProbe) {
			const cleanup = disposeCompatibilityProbe(compatibilityProbe);
			if (!cleanup.complete) return;
			compatibilityProbe = undefined;
			cleanedPreviousProbe = true;
		}
		const sessionConfig = resolveConfig({
			defaults: app.config,
			projectTrusted: ctx.isProjectTrusted(),
			session: sessionFlagOverrides(pi),
		});
		app.reload(sessionConfig);
		// Tier C is explicitly opt-in and only active in interactive TUI sessions.
		if (!cleanedPreviousProbe && ctx.mode === "tui" && sessionConfig.compatibility.allowCorePatches) {
			const detected = detectPiVersion();
			compatibilityProbe = probePiCompatibility(detected.version, {
				config: sessionConfig,
				messageSnapshot: {
					userPrefix: sessionConfig.preset === "ascii" ? "[user] " : "❯ ",
					assistantPrefix: sessionConfig.preset === "ascii" ? "[assistant] " : "│ ",
					userEnabled: sessionConfig.messages.userPrefix,
					assistantEnabled: sessionConfig.messages.assistantPrefix,
				},
				toolSnapshot: {
					callMarker: app.config.preset === "ascii" ? "[tool] " : "[tool] ",
					resultMarker: app.config.preset === "ascii" ? "[result] " : "[tool:result] ",
				},
			});
		}
		app.sessionStart(ctx, event.reason);
	});
	pi.on("agent_start", () => {
		app.runtime.current?.dismissStartup();
	});
	pi.on("input", () => {
		app.runtime.current?.dismissStartup();
	});
	pi.on("tool_execution_start", () => {
		app.runtime.current?.dismissStartup();
	});
	pi.on("model_select", (event) => {
		app.update({ model: event.model.name || event.model.id }, "immediate");
	});
	pi.on("thinking_level_select", (event) => {
		app.update({ thinkingLevel: event.level }, "immediate");
	});
	pi.on("session_info_changed", (event) => {
		app.update({ sessionName: event.name }, "coalesced");
	});
	pi.on("message_update", (_event) => app.update({}, "coalesced"));
	pi.on("message_end", (_event) => app.update({}, "coalesced"));
	pi.on("turn_end", (_event) => app.update({}, "deferred"));
	pi.on("agent_settled", (_event) => app.update({}, "coalesced"));
	pi.on("session_tree", (_event) => app.update({}, "deferred"));
	pi.on("session_compact", (_event) => app.update({}, "deferred"));
	pi.on("tool_result", (event) => {
		if (["write", "edit", "bash"].includes(event.toolName)) {
			app.runtime.current?.invalidateGit();
			app.update({}, "delayed-retry");
		}
	});
	pi.on("user_bash", () => {
		app.runtime.current?.invalidateGit();
		app.update({}, "delayed-retry");
	});
	pi.on("session_shutdown", () => {
		app.sessionShutdown();
		if (compatibilityProbe) {
			const cleanup = disposeCompatibilityProbe(compatibilityProbe);
			if (cleanup.complete) compatibilityProbe = undefined;
		}
	});
}
