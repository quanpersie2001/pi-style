import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { CommandApp } from "../app/command-service.js";
import { runCommand } from "../app/commands.js";
import type { PiStyleApp } from "../app/index.js";
import { createPiConfigFilePort, defaultStoragePaths } from "./config-host.js";
import { EDITOR_COLOR_ENTRY_TYPE, parseEditorColor, savedEditorColor } from "./editor-color.js";

export function registerPiStyleCommand(pi: ExtensionAPI, app: CommandApp & Pick<PiStyleApp, "update">): void {
	pi.registerCommand("pi-style", {
		description: "Configure pi-style for this session",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const cwd = ctx.cwd ?? process.cwd();
			await runCommand(args, { ui: ctx.ui, cwd, isProjectTrusted: ctx.isProjectTrusted }, app, {
				port: createPiConfigFilePort(),
				paths: defaultStoragePaths(cwd),
			});
		},
	});
	pi.registerCommand("color", {
		description: "Set this session's editor border color (#RGB, #RRGGBB, or off)",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const value = args.trim();
			const entries =
				typeof ctx.sessionManager.getBranch === "function"
					? ctx.sessionManager.getBranch()
					: ctx.sessionManager.getEntries();
			const saved = savedEditorColor(entries);
			const current = saved === undefined ? parseEditorColor(String(pi.getFlag("color") ?? "")) : saved;
			if (!value) {
				ctx.ui.notify(`Editor border color: ${current ?? "theme default"}`, "info");
				return;
			}
			const color = value.toLowerCase() === "off" ? null : parseEditorColor(value);
			if (color === undefined) {
				ctx.ui.notify("Use /color #RGB, /color #RRGGBB, or /color off", "warning");
				return;
			}
			pi.appendEntry(EDITOR_COLOR_ENTRY_TYPE, { color });
			app.update({ editorBorderColor: color ?? undefined }, "immediate");
			ctx.ui.notify(`Editor border color: ${color ?? "theme default"}`, "info");
		},
	});
}
