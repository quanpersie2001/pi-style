// Boxed write tool renderer
// (renderCall/renderResult only).

import { stripAnsi } from "../../../shared/ansi.js";
import { boxedToolWidthKey, getTextOutput, renderBoxedToolResult, stripTrailingNotice } from "../../../shared/box.js";
import {
	type BoxedToolDefinition,
	clearFooterState,
	compactCall,
	compactFooterWithState,
	displayPath,
	noteExecutionStart,
	resultFooterLines,
} from "./shared.js";

function parseWriteSummary(output: string): string | undefined {
	const normalized = stripTrailingNotice(stripAnsi(output ?? "")).trim();
	if (!normalized) return undefined;

	const byteMatch = normalized.match(/\bwrote\s+(\d+)\s+bytes?\b/i);
	if (byteMatch) {
		const bytes = Number(byteMatch[1]);
		if (Number.isFinite(bytes)) {
			return `↳ Wrote ${bytes} ${bytes === 1 ? "byte" : "bytes"}.`;
		}
	}

	const lineMatch = normalized.match(/\bwrote\s+(\d+)\s+lines?\b/i);
	if (lineMatch) {
		const count = Number(lineMatch[1]);
		if (Number.isFinite(count)) {
			return `↳ Wrote ${count} ${count === 1 ? "line" : "lines"}.`;
		}
	}

	return undefined;
}

export const writeTool: BoxedToolDefinition = {
	call(args, theme, context) {
		noteExecutionStart(context);
		const detail = displayPath(String(args?.path ?? args?.file_path ?? ""), context);
		return compactCall(theme, "Write", `${theme.fg("dim", "Path: ")}${detail}`, {
			detailKey: detail,
			context,
		});
	},
	result(result, options, theme, context) {
		clearFooterState(context);
		const output = getTextOutput(result);
		const detail = displayPath(String(context?.args?.path ?? context?.args?.file_path ?? ""), context);
		const widthKey = boxedToolWidthKey("Write", detail);

		if (context.isError) {
			return renderBoxedToolResult(theme, () => [theme.fg("error", stripAnsi(output).trim() || "Error")], {
				widthKey,
				footerLines: resultFooterLines(theme, result, context),
				isError: true,
			});
		}

		if (!options.expanded) return compactFooterWithState(theme, result, context);

		const content = String(context?.args?.content ?? "");
		const lineCount = content ? content.split("\n").length : 0;
		if (lineCount > 0) {
			const summary = `↳ Wrote ${lineCount} ${lineCount === 1 ? "line" : "lines"}.`;
			return renderBoxedToolResult(theme, () => [theme.fg("dim", summary)], {
				widthKey,
				footerLines: resultFooterLines(theme, result, context),
			});
		}

		const summary = parseWriteSummary(output);
		if (summary) {
			return renderBoxedToolResult(theme, () => [theme.fg("dim", summary)], {
				widthKey,
				footerLines: resultFooterLines(theme, result, context),
			});
		}

		const normalized = stripTrailingNotice(stripAnsi(output)).trim();
		const fallback = normalized ? `↳ ${normalized}` : "↳ Wrote file.";
		return renderBoxedToolResult(theme, () => [theme.fg("dim", fallback)], {
			widthKey,
			footerLines: resultFooterLines(theme, result, context),
		});
	},
};
