// Boxed ls tool renderer.
//
// Consecutive ls calls in one assistant turn group into a single batch panel
// (see batch.ts); a lone ls renders exactly like the pre-batch boxed UI.

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

const LIST_META: BatchToolMeta = Object.freeze({
	toolName: "ls",
	label: "List",
	summaryKind: "items",
});

function displayPath(rawPath: string): string {
	const path = String(rawPath ?? ".");
	if (path === "." || path === "") return "current directory";
	return shortenPath(path);
}

function lsDetail(context: { args?: Record<string, unknown> }): string {
	return displayPath(String(context?.args?.path ?? "."));
}

export const lsTool: BoxedToolDefinition = {
	call(args, theme, context) {
		noteExecutionStart(context);
		const detail = displayPath(String(args?.path ?? "."));
		const { isLeader, batch } = registerBatchCall(LIST_META, detail, context);
		if (!isLeader) return EMPTY_BATCH_COMPONENT;
		const single = compactCall(theme, "List", `${theme.fg("dim", "Path: ")}${detail}`, {
			detailKey: detail,
			context,
		});
		return renderBatchAwareCall(theme, batch, single);
	},
	result(result, options, theme, context) {
		const output = stripAnsi(getTextOutput(result)).trimEnd();
		const detail = lsDetail(context);
		let itemCount = 0;
		if (output && output !== "(empty directory)") {
			const stripped = stripTrailingNotice(output);
			itemCount = truncationOutputLines(result) ?? countLines(stripped);
		}
		const { isLeader, batch } = registerBatchResult(
			LIST_META,
			{
				isPartial: Boolean(options.isPartial),
				isError: Boolean(context.isError),
				errorText: context.isError ? output || undefined : undefined,
			},
			context,
		);
		if (!isLeader || !batch) return EMPTY_BATCH_COMPONENT;
		clearFooterState(context);
		const widthKey = boxedToolWidthKey("List", detail);

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
			const summary = `↳ Listed ${itemCount} ${itemCount === 1 ? "item" : "items"}.`;
			single = renderBoxedToolResult(theme, () => [theme.fg("dim", summary)], {
				widthKey,
				footerLines: resultFooterLines(theme, result, context),
			});
		}
		return renderBatchAwareResult(batch, single);
	},
};
