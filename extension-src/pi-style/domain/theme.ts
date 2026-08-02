import type { NormalizedPiStyleConfig } from "./config-types.js";

export type GlyphMode = "nerd" | "unicode" | "ascii";
export type SemanticToken =
	| "surface"
	| "surfaceRaised"
	| "surfaceMuted"
	| "text"
	| "muted"
	| "dim"
	| "accent"
	| "accentStrong"
	| "border"
	| "borderMuted"
	| "borderActive"
	| "success"
	| "warning"
	| "error"
	| "model"
	| "thinking"
	| "path"
	| "gitClean"
	| "gitDirty"
	| "contextLow"
	| "contextMedium"
	| "contextHigh"
	| "contextCritical"
	| "tokens"
	| "cache"
	| "cost"
	| "time"
	| "separator";
export interface ActiveTheme {
	fg?: (token: string) => string;
	colors?: Record<string, string>;
}
export interface ResolvedTheme {
	readonly color: (token: SemanticToken) => string;
	readonly glyph: (name: keyof typeof GLYPHS.unicode) => string;
	readonly mode: GlyphMode;
	readonly noColor: boolean;
}
const FALLBACK: Record<SemanticToken, string> = {
	surface: "",
	surfaceRaised: "",
	surfaceMuted: "",
	text: "",
	muted: "",
	dim: "",
	accent: "",
	accentStrong: "",
	border: "",
	borderMuted: "",
	borderActive: "",
	success: "",
	warning: "",
	error: "",
	model: "",
	thinking: "",
	path: "",
	gitClean: "",
	gitDirty: "",
	contextLow: "",
	contextMedium: "",
	contextHigh: "",
	contextCritical: "",
	tokens: "",
	cache: "",
	cost: "",
	time: "",
	separator: "",
};
const GLYPHS = {
	nerd: { pi: "π", git: "", path: "", context: "󰍛", separator: "" },
	unicode: { pi: "π", git: "⎇", path: "⌂", context: "◫", separator: "│" },
	ascii: { pi: "pi", git: "git", path: "path", context: "ctx", separator: "|" },
} as const;
export function detectGlyphMode(
	config: NormalizedPiStyleConfig,
	env: Record<string, string | undefined> = {},
): GlyphMode {
	if (env.PI_STYLE_NERD_FONTS === "1") return "nerd";
	if (env.PI_STYLE_NERD_FONTS === "0") return "unicode";
	if (config.theme.nerdFonts === "on") return "nerd";
	if (config.theme.nerdFonts === "off") return "unicode";
	if (env.GHOSTTY_RESOURCES_DIR) return "nerd";
	return config.preset === "ascii" ? "ascii" : "unicode";
}
export function resolveTheme(
	active: ActiveTheme | undefined,
	config: NormalizedPiStyleConfig,
	env: Record<string, string | undefined> = {},
): ResolvedTheme {
	const noColor = Object.hasOwn(env, "NO_COLOR") && env.NO_COLOR !== "" && config.theme.colors.colorOverride !== "on";
	const mode = config.preset === "ascii" ? "ascii" : detectGlyphMode(config, env);
	return {
		mode,
		noColor,
		color: (token) =>
			noColor ? "" : (config.theme.colors[token] ?? active?.fg?.(token) ?? active?.colors?.[token] ?? FALLBACK[token]),
		glyph: (name) => config.theme.glyphs[name] ?? GLYPHS[mode][name],
	};
}
export { GLYPHS };
