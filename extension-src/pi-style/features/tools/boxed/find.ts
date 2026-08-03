// Boxed find tool renderer.

import { stripAnsi } from "../../../shared/ansi.js";
import {
	boxedToolWidthKey,
	countLines,
	getTextOutput,
	renderBoxedToolResult,
	shortenPath,
	stripTrailingNotice,
} from "../../../shared/box.js";
import {
	type BoxedToolDefinition,
	clearFooterState,
	compactCall,
	compactFooterWithState,
	noteExecutionStart,
	resultFooterLines,
	truncationOutputLines,
} from "./shared.js";

function queryDetail(pattern: string, rawPath: string): string {
	const displayPath = String(rawPath ?? ".");
	const path = displayPath === "." || displayPath === "" ? "current directory" : shortenPath(displayPath);
	return pattern ? `${pattern} in ${path}` : path;
}

export const findTool: BoxedToolDefinition = {
	call(args, theme, context) {
		noteExecutionStart(context);
		const detail = queryDetail(String(args?.pattern ?? ""), String(args?.path ?? "."));
		return compactCall(theme, "Find", `${theme.fg("dim", "Query: ")}${detail}`, {
			detailKey: detail,
			context,
		});
	},
	result(result, options, theme, context) {
		clearFooterState(context);
		const output = stripAnsi(getTextOutput(result)).trimEnd();
		const detail = queryDetail(String(context?.args?.pattern ?? ""), String(context?.args?.path ?? "."));
		const widthKey = boxedToolWidthKey("Find", detail);

		if (context.isError) {
			return renderBoxedToolResult(theme, () => [theme.fg("error", output || "Error")], {
				widthKey,
				footerLines: resultFooterLines(theme, result, context),
				isError: true,
			});
		}

		if (!options.expanded) return compactFooterWithState(theme, result, context);

		let fileCount = 0;
		if (output && output !== "No files found matching pattern") {
			const stripped = stripTrailingNotice(output);
			fileCount = truncationOutputLines(result) ?? countLines(stripped);
		}

		const summary = `↳ Found ${fileCount} ${fileCount === 1 ? "file" : "files"}.`;
		return renderBoxedToolResult(theme, () => [theme.fg("dim", summary)], {
			widthKey,
			footerLines: resultFooterLines(theme, result, context),
		});
	},
};
