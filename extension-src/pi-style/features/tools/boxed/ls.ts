// Boxed ls tool renderer.

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

function displayPath(rawPath: string): string {
	const path = String(rawPath ?? ".");
	if (path === "." || path === "") return "current directory";
	return shortenPath(path);
}

export const lsTool: BoxedToolDefinition = {
	call(args, theme, context) {
		noteExecutionStart(context);
		const detail = displayPath(String(args?.path ?? "."));
		return compactCall(theme, "List", `${theme.fg("dim", "Path: ")}${detail}`, {
			detailKey: detail,
			context,
		});
	},
	result(result, options, theme, context) {
		clearFooterState(context);
		const output = stripAnsi(getTextOutput(result)).trimEnd();
		const detail = displayPath(String(context?.args?.path ?? "."));
		const widthKey = boxedToolWidthKey("List", detail);

		if (context.isError) {
			return renderBoxedToolResult(theme, () => [theme.fg("error", output || "Error")], {
				widthKey,
				footerLines: resultFooterLines(theme, result, context),
				isError: true,
			});
		}

		if (!options.expanded) return compactFooterWithState(theme, result, context);

		let itemCount = 0;
		if (output && output !== "(empty directory)") {
			const stripped = stripTrailingNotice(output);
			itemCount = truncationOutputLines(result) ?? countLines(stripped);
		}

		const summary = `↳ Listed ${itemCount} ${itemCount === 1 ? "item" : "items"}.`;
		return renderBoxedToolResult(theme, () => [theme.fg("dim", summary)], {
			widthKey,
			footerLines: resultFooterLines(theme, result, context),
		});
	},
};
