export const PI_STYLE_SCHEMA_VERSION = 1 as const;

export type Placement = "above" | "below";
export type NerdFontsMode = "auto" | "on" | "off";
export type ToggleMode = "auto" | "on" | "off";
export type PresetName = "default" | "minimal" | "compact" | "full" | "ascii" | "native";

export interface PiStyleConfig {
	enabled?: boolean;
	preset?: string;
	placement?: string;
	startup?: { mode?: string; showResources?: boolean; showModel?: boolean };
	statusLine?: {
		enabled?: boolean;
		separator?: string;
		layout?: { left?: string[]; right?: string[]; secondary?: string[] };
		disabledSegments?: string[];
		customItems?: unknown[];
	};
	editor?: { enabled?: boolean; style?: string; frame?: string; showMetadata?: boolean };
	messages?: { enabled?: boolean; userPrefix?: boolean; assistantPrefix?: boolean; specialBlocks?: boolean };
	tools?: { enabled?: boolean; style?: string; maxCollapsedLines?: number; showElapsed?: boolean };
	theme?: {
		nerdFonts?: string;
		terminalBackgroundSync?: string;
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
	readonly startup: { mode: "off" | "compact" | "overlay"; showResources: boolean; showModel: boolean };
	readonly statusLine: {
		enabled: boolean;
		separator: string;
		layout: { left: readonly string[]; right: readonly string[]; secondary: readonly string[] };
		disabledSegments: readonly string[];
		customItems: readonly unknown[];
	};
	readonly editor: { enabled: boolean; style: string; frame: string; showMetadata: boolean };
	readonly messages: { enabled: boolean; userPrefix: boolean; assistantPrefix: boolean; specialBlocks: boolean };
	readonly tools: { enabled: boolean; style: string; maxCollapsedLines: number; showElapsed: boolean };
	readonly theme: {
		nerdFonts: NerdFontsMode;
		terminalBackgroundSync: ToggleMode;
		colors: Readonly<Record<string, string>>;
		glyphs: Readonly<Record<string, string>>;
	};
	readonly compatibility: {
		allowSafePatches: boolean;
		allowCorePatches: boolean;
		preferExistingEditor: boolean;
		preferExistingFooter: boolean;
	};
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
