// Boxed ls tool renderer.
//
// ls calls render as a boxless tree panel — a lone ls is a batch of one,
// consecutive ls calls group into one panel (see batch.ts). No boxed
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

const LIST_META: BatchToolMeta = Object.freeze({
	toolName: "ls",
	label: "List",
});

function displayPath(rawPath: string): string {
	const path = String(rawPath ?? ".");
	if (path === "." || path === "") return "current directory";
	return shortenPath(path);
}

export const lsTool: BoxedToolDefinition = {
	call(args, theme, context) {
		noteExecutionStart(context);
		const detail = displayPath(String(args?.path ?? "."));
		const { isLeader, batch } = registerBatchCall(LIST_META, detail, context);
		if (!isLeader) return EMPTY_BATCH_COMPONENT;
		return renderBatchAwareCall(theme, batch);
	},
	result(result, options, theme, context) {
		const output = stripAnsi(getTextOutput(result)).trimEnd();
		registerBatchResult(
			LIST_META,
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
