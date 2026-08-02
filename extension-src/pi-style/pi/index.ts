import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPiStyleCommand } from "./commands.js";
import { type CompatibilityTestHooks, createPiStyleSessionCoordinator } from "./session-coordinator.js";

let compatibilityTestHooks: CompatibilityTestHooks = {};
export function __setCompatibilityTestHooks(hooks: CompatibilityTestHooks): () => void {
	const previous = compatibilityTestHooks;
	compatibilityTestHooks = hooks;
	return () => {
		compatibilityTestHooks = previous;
	};
}

/** Thin Pi adapter: register flags, commands, and forward lifecycle events. */
export default function piStyleExtension(pi: ExtensionAPI): void {
	for (const [name, description] of [
		["pi-style-core-patches", "Enable opt-in pi-style message/tool core patches"],
		["pi-style-message-user", "Enable pi-style user message prefix"],
		["pi-style-message-assistant", "Enable pi-style assistant message prefix"],
		["pi-style-tools", "Enable pi-style tool renderer decoration"],
		["pi-style-ascii", "Use ASCII pi-style markers"],
	] as const)
		pi.registerFlag(name, { type: "boolean", description });
	const coordinator = createPiStyleSessionCoordinator(pi, compatibilityTestHooks);
	registerPiStyleCommand(pi, coordinator.app);
	pi.on("session_start", async (event, ctx) => {
		await coordinator.start(event, ctx);
	});
	pi.on("agent_start", () => coordinator.app.runtime.current?.dismissStartup());
	pi.on("input", () => coordinator.app.runtime.current?.dismissStartup());
	pi.on("tool_execution_start", () => coordinator.app.runtime.current?.dismissStartup());
	pi.on("model_select", (event) => coordinator.app.update({ model: event.model.name || event.model.id }, "immediate"));
	pi.on("thinking_level_select", (event) => coordinator.app.update({ thinkingLevel: event.level }, "immediate"));
	pi.on("session_info_changed", (event) => coordinator.app.update({ sessionName: event.name }, "coalesced"));
	pi.on("message_update", () => coordinator.app.update({}, "coalesced"));
	pi.on("message_end", () => coordinator.app.update({}, "coalesced"));
	pi.on("turn_end", () => coordinator.app.update({}, "deferred"));
	pi.on("agent_settled", () => coordinator.app.update({}, "coalesced"));
	pi.on("session_tree", () => coordinator.app.update({}, "deferred"));
	pi.on("session_compact", () => coordinator.app.update({}, "deferred"));
	pi.on("tool_result", (event) => {
		if (["write", "edit", "bash"].includes(event.toolName)) {
			coordinator.app.runtime.current?.invalidateGit();
			coordinator.app.update({}, "delayed-retry");
		}
	});
	pi.on("user_bash", () => {
		coordinator.app.runtime.current?.invalidateGit();
		coordinator.app.update({}, "delayed-retry");
	});
	pi.on("session_shutdown", () => coordinator.shutdown());
}
