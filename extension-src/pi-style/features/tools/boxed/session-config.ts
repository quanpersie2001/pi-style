// Per-session render configuration for boxed tool presentation.
//
// Set once per session by the compatibility coordinator; read inside renderers.
// Kept out of the render path (no filesystem/config reads during render).

export interface ToolsRenderConfig {
	maxCollapsedLines: number;
	maxExpandedLines: number;
	dimOutput: boolean;
	showElapsed: boolean;
	/** Open-tree glyph for the done batch header (nerd `\u{F111}` / unicode `●`). */
	batchOpenGlyph: string;
}

let sessionToolsConfig: ToolsRenderConfig = {
	maxCollapsedLines: 10,
	maxExpandedLines: 50,
	dimOutput: false,
	showElapsed: true,
	batchOpenGlyph: "●",
};

export function setToolsRenderConfig(config: Partial<ToolsRenderConfig>): void {
	sessionToolsConfig = { ...sessionToolsConfig, ...config };
}

export function getToolsRenderConfig(): ToolsRenderConfig {
	return sessionToolsConfig;
}

// Wall-clock elapsed tracking through the renderer context state (no tool
// re-registration, so result.details has no execution timing).

const STARTED_AT_KEY = "__piStyleStartedAt";
const ELAPSED_MS_KEY = "__piStyleElapsedMs";

export function recordExecutionStarted(state: Record<string, unknown> | undefined, executionStarted: boolean): void {
	if (!executionStarted || !state || typeof state !== "object") return;
	if (typeof state[STARTED_AT_KEY] !== "number") state[STARTED_AT_KEY] = performance.now();
}

export function getStateElapsedMs(state: Record<string, unknown> | undefined): number | undefined {
	if (!state || typeof state !== "object") return undefined;
	if (typeof state[ELAPSED_MS_KEY] !== "number" && typeof state[STARTED_AT_KEY] === "number") {
		state[ELAPSED_MS_KEY] = performance.now() - state[STARTED_AT_KEY];
	}
	return typeof state[ELAPSED_MS_KEY] === "number" ? state[ELAPSED_MS_KEY] : undefined;
}
