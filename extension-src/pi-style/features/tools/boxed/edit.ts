// Boxed edit tool renderer
// (renderCall/renderResult only; no edit-core re-registration).

import { getLanguageFromPath } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { stripAnsi } from "../../../shared/ansi.js";
import { getTextOutput, renderBoxedToolCall, renderBoxedToolResult } from "../../../shared/box.js";
import {
	buildSplitRows,
	countDiffStats,
	extractEditedPath,
	firstText,
	renderDiffMeter,
	SplitDiffComponent,
} from "../../../shared/split-diff.js";
import {
	type BoxedToolContext,
	type BoxedToolDefinition,
	displayPath,
	noteExecutionStart,
	resultFooterLines,
} from "./shared.js";

const MAX_HIGHLIGHT_DIFF_CHARS = 12000;
const MAX_HIGHLIGHT_DIFF_ROWS = 120;

type EditResultDetails = { diff?: string; path?: string } | undefined;

export const editTool: BoxedToolDefinition = {
	call(args, theme, context) {
		noteExecutionStart(context);
		const detail = displayPath(String(args?.path ?? args?.file_path ?? ""), context);
		return renderBoxedToolCall(theme, "Edit", [`${theme.fg("dim", "Path: ")}${detail}`], {
			isError: Boolean(context.isError),
			isPartial: Boolean(context.isPartial),
			isPending: Boolean(context.isPartial),
		});
	},
	result(result, options, theme, context) {
		// Handle partial/streaming state
		if (options.isPartial) {
			return renderBoxedToolResult(theme, () => [`${theme.fg("dim", "↳")} ${theme.fg("muted", "Applying edit...")}`], {
				isPartial: true,
			});
		}

		// Handle errors
		if (context.isError) {
			const output = getTextOutput(result);
			return renderBoxedToolResult(theme, () => [theme.fg("error", stripAnsi(output).trim() || "Error")], {
				footerLines: resultFooterLines(theme, result, context),
				isError: true,
			});
		}

		// Extract diff from result details
		const details = result.details as EditResultDetails;
		const diff = details?.diff as string | undefined;

		if (!diff) {
			const output = stripAnsi(getTextOutput(result)).trim();
			const fallback = `↳ ${output || "Edit applied"}`;
			return renderBoxedToolResult(theme, () => [theme.fg("dim", fallback)], {
				footerLines: resultFooterLines(theme, result, context),
			});
		}

		// Resolve language for syntax highlighting
		const message = firstText(result.content as Array<{ type: string; text?: string }>);
		const argPath = String(context?.args?.path ?? context?.args?.file_path ?? "");
		const sourcePath = details?.path ?? (argPath || extractEditedPath(message));
		const language = sourcePath ? getLanguageFromPath(sourcePath) : undefined;

		// Build split-diff rows
		const rows = buildSplitRows(diff);
		const expanded = options.expanded;
		const shouldHighlight =
			Boolean(language) && diff.length <= MAX_HIGHLIGHT_DIFF_CHARS && rows.length <= MAX_HIGHLIGHT_DIFF_ROWS;

		// Build summary header with diff stats and meter
		const { additions, removals } = countDiffStats(diff);
		const meter = renderDiffMeter(theme, additions, removals);
		const summary =
			`${theme.fg("dim", "↳")} ${theme.fg("muted", "diff")}` +
			` ${theme.fg("toolDiffAdded", `+${additions}`)}` +
			` ${theme.fg("toolDiffRemoved", `-${removals}`)}` +
			` ${theme.fg("muted", "split")}` +
			(meter ? ` ${meter}` : "");

		// Render split-diff with syntax colors for small outputs.
		const maxRows = expanded ? 160 : 36;
		const split = new SplitDiffComponent(theme, rows, maxRows, shouldHighlight ? language : undefined);

		return renderBoxedToolResult(
			theme,
			{
				render(width: number): string[] {
					const safeWidth = Math.max(20, width);
					const headerLines = new Text(summary, 0, 0).render(safeWidth);
					return [...headerLines, ...split.render(safeWidth)];
				},
				invalidate(): void {
					split.invalidate();
				},
			},
			{
				footerLines: resultFooterLines(theme, result, context),
			},
		);
	},
};

export type { BoxedToolContext };
