import {
	type ConfigSources,
	type NormalizedPiStyleConfig,
	PI_STYLE_SCHEMA_VERSION,
	type PiStyleConfig,
} from "./config-types.js";
import { normalizeStatusLayout } from "./status-presets.js";

export const DEFAULT_CONFIG: NormalizedPiStyleConfig = Object.freeze({
	schemaVersion: PI_STYLE_SCHEMA_VERSION,
	enabled: true,
	preset: "default",
	placement: "above",
	startup: Object.freeze({ mode: "compact", showResources: true, showModel: true }),
	statusLine: Object.freeze({
		enabled: true,
		separator: "powerline-thin",
		layout: Object.freeze({
			left: ["model", "thinking", "path", "git"],
			right: ["context_pct", "cost"],
			secondary: ["extension_statuses"],
		}),
		disabledSegments: [],
		customItems: [],
	}),
	editor: Object.freeze({ enabled: true, style: "compact", frame: "auto", showMetadata: true }),
	messages: Object.freeze({ enabled: true, userPrefix: true, assistantPrefix: true, specialBlocks: true }),
	tools: Object.freeze({ enabled: true, style: "compact-box", maxCollapsedLines: 10, showElapsed: true }),
	theme: Object.freeze({ nerdFonts: "auto", terminalBackgroundSync: "auto", colors: {}, glyphs: {} }),
	compatibility: Object.freeze({
		allowSafePatches: true,
		allowCorePatches: false,
		preferExistingEditor: true,
		preferExistingFooter: true,
	}),
	debug: false,
});

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function merge(base: Record<string, unknown>, source: unknown): Record<string, unknown> {
	if (!isRecord(source)) return base;
	const result: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(source))
		result[key] =
			isRecord(value) && isRecord(result[key]) ? merge(result[key] as Record<string, unknown>, value) : value;
	return result;
}
function bool(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}
function stringEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}
function strings(value: unknown, fallback: readonly string[]): readonly string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string") ? [...value] : fallback;
}
function stringMap(value: unknown): Readonly<Record<string, string>> {
	return isRecord(value)
		? Object.fromEntries(
				Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
			)
		: {};
}
function customItems(value: unknown): readonly import("./config-types.js").StatusCustomItemConfig[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is import("./config-types.js").StatusCustomItemConfig => {
		if (!isRecord(item) || typeof item.id !== "string" || typeof item.statusKey !== "string") return false;
		return item.placement === undefined || ["left", "right", "secondary"].includes(item.placement as string);
	});
}

export function normalizeConfig(
	input: unknown,
	defaults: NormalizedPiStyleConfig = DEFAULT_CONFIG,
): NormalizedPiStyleConfig {
	const value = merge(defaults as unknown as Record<string, unknown>, input);
	const inputRecord = isRecord(input) ? input : {};
	const inputStatus = isRecord(inputRecord.statusLine) ? inputRecord.statusLine : {};
	const inputLayout = isRecord(inputStatus.layout) ? inputStatus.layout : undefined;
	const startup = isRecord(value.startup) ? value.startup : {};
	const status = isRecord(value.statusLine) ? value.statusLine : {};
	const editor = isRecord(value.editor) ? value.editor : {};
	const messages = isRecord(value.messages) ? value.messages : {};
	const tools = isRecord(value.tools) ? value.tools : {};
	const theme = isRecord(value.theme) ? value.theme : {};
	const compatibility = isRecord(value.compatibility) ? value.compatibility : {};
	const max =
		typeof tools.maxCollapsedLines === "number" &&
		Number.isFinite(tools.maxCollapsedLines) &&
		tools.maxCollapsedLines >= 0
			? Math.floor(tools.maxCollapsedLines)
			: defaults.tools.maxCollapsedLines;
	return Object.freeze({
		schemaVersion: PI_STYLE_SCHEMA_VERSION,
		enabled: bool(value.enabled, defaults.enabled),
		preset: stringEnum(value.preset, ["default", "minimal", "compact", "full", "ascii", "native"], defaults.preset),
		placement: stringEnum(value.placement, ["above", "below"], defaults.placement),
		startup: Object.freeze({
			mode: stringEnum(startup.mode, ["off", "compact", "overlay"], defaults.startup.mode),
			showResources: bool(startup.showResources, defaults.startup.showResources),
			showModel: bool(startup.showModel, defaults.startup.showModel),
		}),
		statusLine: Object.freeze({
			enabled: bool(status.enabled, defaults.statusLine.enabled),
			separator: typeof status.separator === "string" ? status.separator : defaults.statusLine.separator,
			layout: normalizeStatusLayout(
				stringEnum(value.preset, ["default", "minimal", "compact", "full", "ascii", "native"], defaults.preset),
				inputLayout
					? {
							left:
								inputLayout.left === undefined ? undefined : strings(inputLayout.left, defaults.statusLine.layout.left),
							right:
								inputLayout.right === undefined
									? undefined
									: strings(inputLayout.right, defaults.statusLine.layout.right),
							secondary:
								inputLayout.secondary === undefined
									? undefined
									: strings(inputLayout.secondary, defaults.statusLine.layout.secondary),
						}
					: undefined,
			),
			disabledSegments: strings(status.disabledSegments, defaults.statusLine.disabledSegments),
			customItems: customItems(status.customItems),
		}),
		editor: Object.freeze({
			enabled: bool(editor.enabled, defaults.editor.enabled),
			style: stringEnum(editor.style, ["compact", "boxed", "dock", "native"], defaults.editor.style),
			frame: stringEnum(
				editor.frame,
				["auto", "halfblock", "line", "solid", "outline", "native"],
				defaults.editor.frame,
			),
			showMetadata: bool(editor.showMetadata, defaults.editor.showMetadata),
		}),
		messages: Object.freeze({
			enabled: bool(messages.enabled, defaults.messages.enabled),
			userPrefix: bool(messages.userPrefix, defaults.messages.userPrefix),
			assistantPrefix: bool(messages.assistantPrefix, defaults.messages.assistantPrefix),
			specialBlocks: bool(messages.specialBlocks, defaults.messages.specialBlocks),
		}),
		tools: Object.freeze({
			enabled: bool(tools.enabled, defaults.tools.enabled),
			style: typeof tools.style === "string" ? tools.style : defaults.tools.style,
			maxCollapsedLines: max,
			showElapsed: bool(tools.showElapsed, defaults.tools.showElapsed),
		}),
		theme: Object.freeze({
			nerdFonts: stringEnum(theme.nerdFonts, ["auto", "on", "off"], defaults.theme.nerdFonts),
			terminalBackgroundSync: stringEnum(
				theme.terminalBackgroundSync,
				["auto", "on", "off"],
				defaults.theme.terminalBackgroundSync,
			),
			colors: stringMap(theme.colors),
			glyphs: stringMap(theme.glyphs),
		}),
		compatibility: Object.freeze({
			allowSafePatches: bool(compatibility.allowSafePatches, defaults.compatibility.allowSafePatches),
			allowCorePatches: bool(compatibility.allowCorePatches, defaults.compatibility.allowCorePatches),
			preferExistingEditor: bool(compatibility.preferExistingEditor, defaults.compatibility.preferExistingEditor),
			preferExistingFooter: bool(compatibility.preferExistingFooter, defaults.compatibility.preferExistingFooter),
		}),
		debug: bool(value.debug, defaults.debug),
	});
}

export function resolveConfig(sources: ConfigSources): NormalizedPiStyleConfig {
	let merged: unknown = sources.defaults ?? DEFAULT_CONFIG;
	for (const source of [sources.global, sources.projectTrusted === false ? undefined : sources.project])
		merged = merge(isRecord(merged) ? merged : {}, source);
	const env = sources.environment ?? {};
	const envPatch: PiStyleConfig = {};
	if (env.PI_STYLE_DISABLED === "1") envPatch.enabled = false;
	if (env.PI_STYLE_NERD_FONTS === "1" || env.PI_STYLE_NERD_FONTS === "0")
		envPatch.theme = { nerdFonts: env.PI_STYLE_NERD_FONTS === "1" ? "on" : "off" };
	if (env.PI_STYLE_DEBUG === "1") envPatch.debug = true;
	if (env.PI_STYLE_STATUS === "above" || env.PI_STYLE_STATUS === "below") envPatch.placement = env.PI_STYLE_STATUS;
	if (env.PI_STYLE_STATUS === "off") envPatch.enabled = false;
	merged = merge(isRecord(merged) ? merged : {}, envPatch);
	merged = merge(isRecord(merged) ? merged : {}, sources.session);
	return normalizeConfig(merged);
}
