// Boxed read tool renderer
// (renderCall/renderResult only; no tool re-registration).
//
// Consecutive read calls in one assistant turn group into a single collapsible
// batch panel (see batch.ts): the first read is the batch leader and renders
// the whole panel; later reads render zero lines. A lone read renders exactly
// like the pre-batch boxed UI.

import { getLanguageFromPath, highlightCode } from "@earendil-works/pi-coding-agent";
import { stripAnsi } from "../../../shared/ansi.js";
import type { BoxTheme } from "../../../shared/box.js";
import {
	boxedToolWidthKey,
	countLines,
	extractTrailingNotice,
	getTextOutput,
	renderBoxedToolResult,
	stripTrailingNotice,
} from "../../../shared/box.js";
import { safeTruncateToWidth } from "../../../shared/render-budget.js";
import {
	type BatchToolMeta,
	EMPTY_BATCH_COMPONENT,
	registerBatchCall,
	registerBatchResult,
	renderBatchAwareCall,
	renderBatchAwareResult,
} from "./batch.js";
import { getToolsRenderConfig } from "./session-config.js";
import {
	type BoxedToolContext,
	type BoxedToolDefinition,
	clearFooterState,
	compactCall,
	compactFooterWithState,
	noteExecutionStart,
	pathRangeDetail,
	resultFooterLines,
} from "./shared.js";

const MAX_HIGHLIGHT_OUTPUT_CHARS = 12000;
const MAX_HIGHLIGHT_OUTPUT_LINES = 300;

const READ_META: BatchToolMeta = Object.freeze({
	toolName: "read",
	label: "Read",
	summaryKind: "words",
});

type NumberedReadLine = {
	lineNumber: string;
	content: string;
};

type ParsedReadOutput = {
	fileHash: string | undefined;
	numberedLines?: NumberedReadLine[];
	body: string;
};

function parseReadOutput(text: string): ParsedReadOutput {
	const fileHashMatch = text.match(/^fileHash: ([^\n]+)\n\n/);
	const body = fileHashMatch ? text.slice(fileHashMatch[0].length) : text;
	const rawLines = body ? body.split("\n") : [];
	const numberedLines = rawLines.map((line) => line.match(/^\s*(\d+)\| ?(.*)$/));

	if (numberedLines.length > 0 && numberedLines.every(Boolean)) {
		return {
			fileHash: fileHashMatch?.[1],
			body: numberedLines.map((match) => match?.[2] ?? "").join("\n"),
			numberedLines: numberedLines.map((match) => ({
				lineNumber: match?.[1] ?? "",
				content: match?.[2] ?? "",
			})),
		};
	}

	return { fileHash: fileHashMatch?.[1], body };
}

function renderReadBody(
	theme: BoxTheme,
	options: { expanded: boolean },
	parsed: ParsedReadOutput,
	output: string,
	truncationNotice: string | null,
): { render(width: number): string[]; invalidate(): void } {
	let cacheKey = "";
	let cacheLines: string[] | null = null;
	return {
		invalidate() {
			cacheKey = "";
			cacheLines = null;
		},
		render(width: number): string[] {
			const renderWidth = Math.max(1, width);
			const cfg = getToolsRenderConfig();
			const maxLines = cfg.maxExpandedLines;
			const expanded = Boolean(options.expanded);
			const cacheId = `${renderWidth}|${expanded ? 1 : 0}|${maxLines}|${cfg.dimOutput ? 1 : 0}`;
			if (cacheLines && cacheKey === cacheId) return cacheLines;

			const linesRead = parsed.numberedLines?.length ?? countLines(parsed.body);
			const summary = theme.fg("dim", `↳ Read ${linesRead} ${linesRead === 1 ? "line" : "lines"}.`);
			const footer: string[] = [];
			if (truncationNotice) footer.push(theme.fg("warning", truncationNotice));
			footer.push("", summary);
			const budget = maxLines > 0 ? maxLines - footer.length : 0;
			const renderPlain = (text: string): string[] => {
				const out: string[] = [];
				for (const line of text.split("\n")) {
					out.push(safeTruncateToWidth(theme.fg("toolOutput", line), renderWidth, "…"));
				}
				return out;
			};
			const lineCount = parsed.numberedLines?.length ?? countLines(parsed.body);
			const shouldHighlight =
				expanded &&
				Boolean(getLanguageFromPath(output)) &&
				parsed.body.length <= MAX_HIGHLIGHT_OUTPUT_CHARS &&
				lineCount <= MAX_HIGHLIGHT_OUTPUT_LINES;

			const renderBody = (): string[] => {
				if (!parsed.numberedLines)
					return renderPlain(parsed.fileHash ? `fileHash: ${parsed.fileHash}\n\n${parsed.body}` : parsed.body);

				let bodyLines = parsed.body.split("\n").map((line) => theme.fg("toolOutput", line));
				const lang = getLanguageFromPath(output);
				if (shouldHighlight && lang) {
					try {
						bodyLines = highlightCode(parsed.body, lang);
					} catch {
						bodyLines = parsed.body.split("\n").map((line) => theme.fg("toolOutput", line));
					}
				}

				const out: string[] = [];
				if (parsed.fileHash) out.push(theme.fg("muted", `fileHash: ${parsed.fileHash}`), "");

				const numberWidth = Math.max(...parsed.numberedLines.map((line) => line.lineNumber.length));
				const gutterWidth = numberWidth + 3;
				const contentWidth = Math.max(1, renderWidth - gutterWidth);
				for (let i = 0; i < parsed.numberedLines.length; i++) {
					const numberedLine = parsed.numberedLines[i] ?? { lineNumber: "", content: "" };
					const bodyLine = safeTruncateToWidth(bodyLines[i] ?? "", contentWidth, "…");
					const gutter = theme.fg("dim", `${numberedLine.lineNumber.padStart(numberWidth)} │ `);
					out.push(`${gutter}${bodyLine}`);
				}
				return out;
			};

			const highlighted = renderBody();
			if (maxLines > 0 && highlighted.length > budget) {
				const truncated = highlighted.slice(0, budget);
				const remaining = highlighted.length - budget;
				truncated.push(theme.fg("dim", `… ${remaining} more lines`));
				truncated.push(...footer);
				cacheKey = cacheId;
				cacheLines = truncated;
				return cacheLines;
			}
			highlighted.push(...footer);
			cacheKey = cacheId;
			cacheLines = highlighted;
			return cacheLines;
		},
	};
}

function readResultDetail(context: BoxedToolContext): string {
	const rawPath = String(context?.args?.path ?? context?.args?.file_path ?? "");
	return pathRangeDetail(rawPath, context?.args?.offset, context?.args?.limit, context);
}

export const readTool: BoxedToolDefinition = {
	call(args, theme, context) {
		noteExecutionStart(context);
		const rawPath = String(args?.path ?? args?.file_path ?? "");
		const detail = pathRangeDetail(rawPath, args?.offset, args?.limit, context);
		const { isLeader, batch } = registerBatchCall(READ_META, detail, context);
		if (!isLeader) return EMPTY_BATCH_COMPONENT;
		const single = compactCall(theme, "Read", `${theme.fg("dim", "Path: ")}${detail}`, {
			detailKey: detail,
			context,
		});
		return renderBatchAwareCall(theme, batch, single);
	},
	result(result, options, theme, context) {
		const output = stripAnsi(getTextOutput(result)).trimEnd();
		const detail = readResultDetail(context);
		const { isLeader, batch } = registerBatchResult(
			READ_META,
			{
				isPartial: Boolean(options.isPartial),
				isError: Boolean(context.isError),
				errorText: context.isError ? output || undefined : undefined,
			},
			context,
		);
		if (!isLeader || !batch) return EMPTY_BATCH_COMPONENT;
		clearFooterState(context);
		const widthKey = boxedToolWidthKey("Read", detail);

		let single: ReturnType<typeof renderBoxedToolResult> | ReturnType<typeof compactFooterWithState>;
		if (context.isError) {
			single = renderBoxedToolResult(theme, () => [theme.fg("error", output || "Error")], {
				widthKey,
				footerLines: resultFooterLines(theme, result, context),
				isError: true,
			});
		} else {
			const imageCount = Array.isArray(result.content)
				? result.content.filter((contentBlock) => {
						if (!contentBlock || typeof contentBlock !== "object") return false;
						return (contentBlock as { type?: unknown }).type === "image";
					}).length
				: 0;
			if (imageCount > 0) {
				if (!options.expanded) {
					single = compactFooterWithState(theme, result, context);
				} else {
					const summary = `↳ Read ${imageCount} ${imageCount === 1 ? "image" : "images"}.`;
					single = renderBoxedToolResult(theme, () => [theme.fg("dim", summary)], {
						widthKey,
						footerLines: resultFooterLines(theme, result, context),
					});
				}
			} else if (!options.expanded) {
				single = compactFooterWithState(theme, result, context);
			} else {
				const stripped = stripTrailingNotice(output);
				const parsed = parseReadOutput(stripped);
				const truncationNotice = extractTrailingNotice(output);
				const body = renderReadBody(theme, options, parsed, output, truncationNotice);
				single = renderBoxedToolResult(theme, body, {
					widthKey,
					footerLines: resultFooterLines(theme, result, context),
				});
			}
		}
		return renderBatchAwareResult(batch, single);
	},
};
