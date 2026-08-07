import type { PiStyleConfig, PresetName } from "./config-types.js";

/** Code-defined coordinated defaults. Explicit fields are merged after these values. */
export const CONFIG_PRESETS: Readonly<Record<PresetName, Readonly<PiStyleConfig>>> = Object.freeze({
	default: Object.freeze({
		startup: { mode: "compact" },
	}),
	minimal: Object.freeze({
		statusLine: { layout: { left: ["path", "git"], right: ["context_pct"], secondary: [] } },
		editor: { style: "native", frame: "native", showMetadata: false },
		startup: { mode: "off" },
		messages: { enabled: false },
		tools: { enabled: false, collapseAfterTurn: false },
		theme: { terminalBackgroundSync: "off" },
	}),
	compact: Object.freeze({
		statusLine: {
			layout: { left: ["model", "thinking", "git"], right: ["context_pct"], secondary: ["extension_statuses"] },
		},
		editor: { style: "compact", frame: "auto", showMetadata: false },
		startup: { mode: "compact" },
	}),
	full: Object.freeze({
		statusLine: {
			layout: {
				left: ["hostname", "model", "thinking", "path", "git", "session"],
				right: ["token_in", "token_out", "cache_read", "cost", "context_pct", "time_spent", "time"],
				secondary: ["extension_statuses"],
			},
		},
		editor: { style: "boxed", frame: "outline", showMetadata: true },
		startup: { mode: "overlay", showResources: true },
	}),
	ascii: Object.freeze({
		editor: { style: "compact", frame: "auto" },
		startup: { mode: "compact" },
		theme: { nerdFonts: "off", terminalBackgroundSync: "off" },
	}),
	native: Object.freeze({
		statusLine: { layout: { left: ["model", "path"], right: ["context_pct"], secondary: [] } },
		editor: { style: "native", frame: "native", showMetadata: false },
		startup: { mode: "off" },
		messages: { enabled: false },
		tools: { enabled: false, collapseAfterTurn: false },
		theme: { terminalBackgroundSync: "off", autoApply: "off" },
	}),
});

export function presetConfig(name: unknown): Readonly<PiStyleConfig> {
	return CONFIG_PRESETS[(typeof name === "string" && name in CONFIG_PRESETS ? name : "default") as PresetName];
}
