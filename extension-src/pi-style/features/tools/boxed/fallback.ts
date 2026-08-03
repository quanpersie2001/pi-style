// Boxed fallback for tools without a dedicated renderer.
// (component side only; no ToolExecutionComponent prototype patching).

import type { Component } from "@earendil-works/pi-tui";
import type { BoxTheme, MetricResultLike } from "../../../shared/box.js";
import {
	formatBoxedFooter,
	formatToolName,
	formatToolParamLines,
	getTextOutput,
	renderBoxedToolCall,
	renderBoxedToolResult,
	renderLines,
} from "../../../shared/box.js";
import { getStateElapsedMs, getToolsRenderConfig } from "./session-config.js";
import { type BoxedToolContext, noteExecutionStart } from "./shared.js";

const MAX_FALLBACK_PREVIEW_LINES = 10;

export function renderFallbackCall(
	toolName: unknown,
	args: Record<string, unknown>,
	theme: BoxTheme,
	context: BoxedToolContext,
): Component {
	noteExecutionStart(context);
	return renderBoxedToolCall(theme, formatToolName(String(toolName ?? "Tool")), formatToolParamLines(args, theme), {
		isError: Boolean(context.isError),
		isPartial: Boolean(context.isPartial),
		isPending: Boolean(context.isPartial),
	});
}

export function renderFallbackResult(
	_toolName: unknown,
	result: MetricResultLike,
	options: { expanded: boolean; isPartial: boolean },
	theme: BoxTheme,
	context: BoxedToolContext,
): Component {
	const isError = Boolean(context.isError);
	const expanded = Boolean(options.expanded);
	const maxLines = expanded ? getToolsRenderConfig().maxExpandedLines : MAX_FALLBACK_PREVIEW_LINES;
	const output = getTextOutput(result);
	const elapsedMs = getStateElapsedMs(context.state);

	return renderBoxedToolResult(
		theme,
		(contentWidth) => {
			const body = renderLines(theme, output, options, {
				maxLines,
				color: isError ? "error" : "toolOutput",
				width: contentWidth,
			});
			return body ? body.split("\n") : [];
		},
		{
			footerLines: [formatBoxedFooter(theme, result, [], elapsedMs)],
			renderLineBudget: maxLines,
			isError,
			isPartial: Boolean(options.isPartial),
		},
	);
}

// Re-exported for callers that need the tool-name label normalization.
export { formatToolName };
