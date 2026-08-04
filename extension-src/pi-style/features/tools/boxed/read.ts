// Boxed read tool renderer
// (renderCall/renderResult only; no tool re-registration).
//
// Read calls render as a boxless tree panel — a lone read is a batch of one,
// consecutive reads group into one panel (see batch.ts). There is no boxed
// single-call special case.

import { stripAnsi } from "../../../shared/ansi.js";
import { getTextOutput } from "../../../shared/box.js";
import {
	type BatchToolMeta,
	EMPTY_BATCH_COMPONENT,
	emptyBatchResult,
	registerBatchCall,
	registerBatchResult,
	renderBatchAwareCall,
} from "./batch.js";
import { type BoxedToolDefinition, noteExecutionStart, pathRangeDetail } from "./shared.js";

const READ_META: BatchToolMeta = Object.freeze({
	toolName: "read",
	label: "Read",
});

export const readTool: BoxedToolDefinition = {
	call(args, theme, context) {
		noteExecutionStart(context);
		const rawPath = String(args?.path ?? args?.file_path ?? "");
		const detail = pathRangeDetail(rawPath, args?.offset, args?.limit, context);
		const { isLeader, batch } = registerBatchCall(READ_META, detail, context);
		if (!isLeader) return EMPTY_BATCH_COMPONENT;
		return renderBatchAwareCall(theme, batch);
	},
	result(result, options, _theme, context) {
		const output = stripAnsi(getTextOutput(result)).trimEnd();
		registerBatchResult(
			READ_META,
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
