export const PI_STYLE_SCHEMA_VERSION = 1 as const;

export type Placement = "above" | "below";
export type NerdFontsMode = "auto" | "on" | "off";
export type ToggleMode = "auto" | "on" | "off";
export type PresetName = "default" | "minimal" | "compact" | "full" | "ascii" | "native";
export type EditorStyle = "compact" | "boxed" | "dock" | "native";
export type EditorFrame = "auto" | "halfblock" | "line" | "solid" | "outline" | "rounded" | "native";

export interface StatusCustomItemConfig {
	id: string;
	statusKey: string;
	label?: string;
	priority?: number;
	placement?: "left" | "right" | "secondary";
}

export interface PiStyleConfig {
	enabled?: boolean;
	preset?: string;
	placement?: string;
	startup?: { mode?: string; showResources?: boolean; alwaysExpanded?: boolean };
	statusLine?: {
		enabled?: boolean;
		separator?: string;
		layout?: { left?: string[]; right?: string[]; secondary?: string[] };
		disabledSegments?: string[];
		customItems?: StatusCustomItemConfig[];
		/** Blank rows reserved below the primary status row (0 disables). */
		bottomMargin?: number;
		/** Context progress-bar cell count (default 10). */
		contextBarWidth?: number;
	};
	editor?: { enabled?: boolean; style?: string; frame?: string; showMetadata?: boolean; hint?: string };
	messages?: { enabled?: boolean; assistantPrefix?: boolean; specialBlocks?: boolean; hideThinkingLabel?: boolean };
	tools?: {
		enabled?: boolean;
		style?: string;
		maxCollapsedLines?: number;
		maxExpandedLines?: number;
		dimOutput?: boolean;
		showElapsed?: boolean;
	};
	theme?: {
		nerdFonts?: string;
		terminalBackgroundSync?: string;
		/** Pi theme name auto-applied at TUI session start ("off" disables; default "titanium"). */
		autoApply?: string;
		colors?: Record<string, unknown>;
		glyphs?: Record<string, unknown>;
	};
	compatibility?: {
		allowSafePatches?: boolean;
		allowCorePatches?: boolean;
		preferExistingEditor?: boolean;
		preferExistingFooter?: boolean;
	};
	debug?: boolean;
	schemaVersion?: number;
}

export interface NormalizedPiStyleConfig {
	readonly schemaVersion: typeof PI_STYLE_SCHEMA_VERSION;
	readonly enabled: boolean;
	readonly preset: PresetName;
	readonly placement: Placement;
	readonly startup: {
		mode: "off" | "compact" | "overlay";
		showResources: boolean;
		alwaysExpanded: boolean;
	};
	readonly statusLine: {
		enabled: boolean;
		separator: string;
		layout: { left: readonly string[]; right: readonly string[]; secondary: readonly string[] };
		disabledSegments: readonly string[];
		customItems: readonly StatusCustomItemConfig[];
		/** Blank rows reserved below the primary status row (0 disables). */
		bottomMargin: number;
		/** Context progress-bar cell count. */
		contextBarWidth: number;
	};
	readonly editor: { enabled: boolean; style: EditorStyle; frame: EditorFrame; showMetadata: boolean; hint: string };
	readonly messages: { enabled: boolean; assistantPrefix: boolean; specialBlocks: boolean; hideThinkingLabel: boolean };
	readonly tools: {
		enabled: boolean;
		style: string;
		maxCollapsedLines: number;
		maxExpandedLines: number;
		dimOutput: boolean;
		showElapsed: boolean;
	};
	readonly theme: {
		nerdFonts: NerdFontsMode;
		terminalBackgroundSync: ToggleMode;
		/** Pi theme name auto-applied at TUI session start; "off" disables the surface. */
		autoApply: string;
		colors: Readonly<Record<string, string>>;
		glyphs: Readonly<Record<string, string>>;
	};
	readonly compatibility: {
		allowSafePatches: boolean;
		allowCorePatches: boolean;
		preferExistingEditor: boolean;
		preferExistingFooter: boolean;
	};
	/** Internal provenance marker; never serialized or accepted as a command field. */
	readonly productCorePatchesExplicit?: boolean;
	readonly debug: boolean;
}

export interface ConfigSources {
	defaults?: unknown;
	global?: unknown;
	project?: unknown;
	environment?: Record<string, string | undefined>;
	session?: unknown;
	projectTrusted?: boolean;
}
