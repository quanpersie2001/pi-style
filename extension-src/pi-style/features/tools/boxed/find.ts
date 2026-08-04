// Boxed find tool renderer.
//
// find calls render as a boxless tree panel — a lone find is a batch of one,
// consecutive find calls group into one panel (see batch.ts). No boxed
// single-call special case.

import { stripAnsi } from "../../../shared/ansi.js";
import { getTextOutput, shortenPath } from "../../../shared/box.js";
import {
	type BatchToolMeta,
	EMPTY_BATCH_COMPONENT,
	emptyBatchResult,
	registerBatchCall,
	registerBatchResult,
	renderBatchAwareCall,
} from "./batch.js";
import { type BoxedToolDefinition, noteExecutionStart } from "./shared.js";

const FIND_META: BatchToolMeta = Object.freeze({
	toolName: "find",
	label: "Find",
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
		return renderBatchAwareCall(theme, batch);
	},
	result(result, options, theme, context) {
		const output = stripAnsi(getTextOutput(result)).trimEnd();
		registerBatchResult(
			FIND_META,
			{
				isPartial: Boolean(options.isPartial),
				isError: Boolean(context.isError),
				errorText: context.isError ? output || undefined : undefined,
			},
			context,
		);
		return emptyBatchResult();
	},
};
