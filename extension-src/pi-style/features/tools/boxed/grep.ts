// Boxed grep/search tool renderer.

import { stripAnsi } from "../../../shared/ansi.js";
import {
	boxedToolWidthKey,
	countLines,
	getTextOutput,
	renderBoxedToolResult,
	renderLines,
	shortenPath,
	stripTrailingNotice,
} from "../../../shared/box.js";
import { getToolsRenderConfig } from "./session-config.js";
import {
	type BoxedToolDefinition,
	clearFooterState,
	compactCall,
	compactFooterWithState,
	matchLimitReached,
	noteExecutionStart,
	resultFooterLines,
} from "./shared.js";

const MAX_GREP_PREVIEW_LINES = 10;

function queryDetail(pattern: string, rawPath: string): string {
	const displayPath = String(rawPath ?? ".");
	const path = displayPath === "." || displayPath === "" ? "current directory" : shortenPath(displayPath);
	return pattern ? `/${pattern}/ in ${path}` : path;
}

export const grepTool: BoxedToolDefinition = {
	call(args, theme, context) {
		noteExecutionStart(context);
		const detail = queryDetail(String(args?.pattern ?? ""), String(args?.path ?? "."));
		return compactCall(theme, "Search", `${theme.fg("dim", "Query: ")}${detail}`, {
			detailKey: detail,
			context,
		});
	},
	result(result, options, theme, context) {
		clearFooterState(context);
		const output = stripAnsi(getTextOutput(result)).trimEnd();
		const stripped = stripTrailingNotice(output);
		const detail = queryDetail(String(context?.args?.pattern ?? ""), String(context?.args?.path ?? "."));
		const widthKey = boxedToolWidthKey("Search", detail);
		const cfg = getToolsRenderConfig();

		if (context.isError) {
			return renderBoxedToolResult(
				theme,
				(width) => {
					const body = renderLines(theme, stripped || output || "Error", options, {
						maxLines: MAX_GREP_PREVIEW_LINES,
						color: "error",
						width,
					});
					return body ? body.split("\n") : [];
				},
				{
					widthKey,
					footerLines: resultFooterLines(theme, result, context),
					isError: true,
				},
			);
		}

		if (!options.expanded) return compactFooterWithState(theme, result, context);

		let matchCount = 0;
		if (stripped && stripped !== "No matches found") {
			const lines = stripped.split("\n");
			matchCount = lines.filter((line) => /:\d+:/.test(line)).length;

			if (matchCount === 0) {
				matchCount = countLines(stripped);
			}

			if (matchLimitReached(result) !== undefined) {
				matchCount = Math.max(matchCount, matchLimitReached(result) as number);
			}
		}

		const summary = theme.fg("dim", `↳ Found ${matchCount} ${matchCount === 1 ? "match" : "matches"}.`);
		if (!stripped || stripped === "No matches found") {
			return renderBoxedToolResult(theme, () => [summary], {
				widthKey,
				footerLines: resultFooterLines(theme, result, context),
			});
		}

		return renderBoxedToolResult(
			theme,
			(width) => {
				const body = renderLines(theme, stripped, options, {
					maxLines: options.expanded ? cfg.maxExpandedLines : MAX_GREP_PREVIEW_LINES,
					color: "toolOutput",
					width,
				});
				return [summary, ...(body ? body.split("\n") : [])];
			},
			{
				widthKey,
				footerLines: resultFooterLines(theme, result, context),
			},
		);
	},
};
