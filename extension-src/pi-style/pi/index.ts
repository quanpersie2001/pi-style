import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiStyleApp } from "../app/index.js";

/**
 * Thin Pi adapter: register lifecycle hooks and delegate session state to app/.
 */
export default function piStyleExtension(pi: ExtensionAPI): void {
	const app = createPiStyleApp();

	pi.on("session_start", (_event, ctx) => {
		app.sessionStart(ctx);
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
	});
}
