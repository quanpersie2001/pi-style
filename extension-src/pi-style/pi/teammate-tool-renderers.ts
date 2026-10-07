import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { renderBoxedToolCall, renderBoxedToolResult } from "../features/tools/boxed/index.js";
import type { BoxedToolContext, BoxedToolResult } from "../features/tools/boxed/shared.js";
import { TEAM_TOOL_NAMES } from "../features/tools/boxed/teams.js";
import type { BoxTheme } from "../shared/box.js";

// Pi 0.85 (the package's local development peer) does not expose this API;
// Pi 1.0.4 (pi-teams' minimum) does. Keep it an optional structural port.
type TeamRenderers = {
	renderShell: "self";
	renderCall: (args: Record<string, unknown>, theme: BoxTheme, context: BoxedToolContext) => Component;
	renderResult: (
		result: BoxedToolResult,
		options: { expanded: boolean; isPartial: boolean },
		theme: BoxTheme,
		context: BoxedToolContext,
	) => Component;
};
type PublicToolRendererHost = {
	registerToolRenderer?: (
		resolver: (name: string, next: () => TeamRenderers | undefined) => TeamRenderers | undefined,
	) => void;
};

/** Public renderer selection works even when a new Pi release fails the
 * fingerprint-gated compatibility patch. The native self shell suppresses
 * zero-line batch members. Never register or replace pi-teams' execution. */
export function registerTeammateToolRenderers(pi: ExtensionAPI): void {
	(pi as ExtensionAPI & PublicToolRendererHost).registerToolRenderer?.((name, next) => {
		if (!TEAM_TOOL_NAMES.has(name)) return next();
		return {
			renderShell: "self",
			renderCall: (args, theme, context) => renderBoxedToolCall(name, args, theme, context),
			renderResult: (result, options, theme, context) => renderBoxedToolResult(name, result, options, theme, context),
		};
	});
}
