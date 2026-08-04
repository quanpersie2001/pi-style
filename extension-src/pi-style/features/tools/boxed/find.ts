// Boxed find tool renderer.
//
// Consecutive find calls in one assistant turn group into a single batch panel
// (see batch.ts); a lone find renders exactly like the pre-batch boxed UI.

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
	type BatchToolMeta,
	EMPTY_BATCH_COMPONENT,
	registerBatchCall,
	registerBatchResult,
	renderBatchAwareCall,
	renderBatchAwareResult,
} from "./batch.js";
import {
	type BoxedToolDefinition,
	clearFooterState,
	compactCall,
	compactFooterWithState,
	noteExecutionStart,
	resultFooterLines,
	truncationOutputLines,
} from "./shared.js";

const FIND_META: BatchToolMeta = Object.freeze({
	toolName: "find",
	label: "Find",
	summaryKind: "files",
});

function queryDetail(pattern: string, rawPath: string): string {
	const displayPath = String(rawPath ?? ".");
	const path = displayPath === "." || displayPath === "" ? "current directory" : shortenPath(displayPath);
	return pattern ? `${pattern} in ${path}` : path;
}

export const findTool: BoxedToolDefinition = {
	call(args, theme, context) {
		noteExecutionStart(context);
		const detail = queryDetail(String(args?.pattern ?? ""), String(args?.path ?? "."));
		const { isLeader, batch } = registerBatchCall(FIND_META, detail, context);
		if (!isLeader) return EMPTY_BATCH_COMPONENT;
		const single = compactCall(theme, "Find", `${theme.fg("dim", "Query: ")}${detail}`, {
			detailKey: detail,
			context,
		});
		return renderBatchAwareCall(theme, batch, single);
	},
	result(result, options, theme, context) {
		const output = stripAnsi(getTextOutput(result)).trimEnd();
		const detail = queryDetail(String(context?.args?.pattern ?? ""), String(context?.args?.path ?? "."));
		let fileCount = 0;
		if (output && output !== "No files found matching pattern") {
			const stripped = stripTrailingNotice(output);
			fileCount = truncationOutputLines(result) ?? countLines(stripped);
		}
		const { isLeader, batch } = registerBatchResult(
			FIND_META,
			{
				isPartial: Boolean(options.isPartial),
				isError: Boolean(context.isError),
				errorText: context.isError ? output || undefined : undefined,
			},
			context,
		);
		if (!isLeader || !batch) return EMPTY_BATCH_COMPONENT;
		clearFooterState(context);
		const widthKey = boxedToolWidthKey("Find", detail);

		let single: ReturnType<typeof renderBoxedToolResult> | ReturnType<typeof compactFooterWithState>;
		if (context.isError) {
			single = renderBoxedToolResult(theme, () => [theme.fg("error", output || "Error")], {
				widthKey,
				footerLines: resultFooterLines(theme, result, context),
				isError: true,
			});
		} else if (!options.expanded) {
			single = compactFooterWithState(theme, result, context);
		} else {
			const summary = `↳ Found ${fileCount} ${fileCount === 1 ? "file" : "files"}.`;
			single = renderBoxedToolResult(theme, () => [theme.fg("dim", summary)], {
				widthKey,
				footerLines: resultFooterLines(theme, result, context),
			});
		}
		return renderBatchAwareResult(batch, single);
	},
};
