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

	pi.on("session_shutdown", () => {
		app.sessionShutdown();
	});
}
