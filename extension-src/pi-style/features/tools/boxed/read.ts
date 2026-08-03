// Boxed read tool renderer
// (renderCall/renderResult only; no tool re-registration).

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
import { getToolsRenderConfig } from "./session-config.js";
import {
	type BoxedToolDefinition,
	clearFooterState,
	compactCall,
	compactFooterWithState,
	noteExecutionStart,
	pathRangeDetail,
	resultFooterLines,
	truncationOutputLines,
} from "./shared.js";

const MAX_HIGHLIGHT_OUTPUT_CHARS = 12000;
const MAX_HIGHLIGHT_OUTPUT_LINES = 300;

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

export const readTool: BoxedToolDefinition = {
	call(args, theme, context) {
		noteExecutionStart(context);
		const rawPath = String(args?.path ?? args?.file_path ?? "");
		const detail = pathRangeDetail(rawPath, args?.offset, args?.limit, context);
		return compactCall(theme, "Read", `${theme.fg("dim", "Path: ")}${detail}`, {
			detailKey: detail,
			context,
		});
	},
	result(result, options, theme, context) {
		clearFooterState(context);
		const output = stripAnsi(getTextOutput(result)).trimEnd();
		const rawPath = String(context?.args?.path ?? context?.args?.file_path ?? "");
		const detail = pathRangeDetail(rawPath, context?.args?.offset, context?.args?.limit, context);
		const widthKey = boxedToolWidthKey("Read", detail);

		if (context.isError) {
			return renderBoxedToolResult(theme, () => [theme.fg("error", output || "Error")], {
				widthKey,
				footerLines: resultFooterLines(theme, result, context),
				isError: true,
			});
		}

		const imageCount = Array.isArray(result.content)
			? result.content.filter((contentBlock) => {
					if (!contentBlock || typeof contentBlock !== "object") return false;
					return (contentBlock as { type?: unknown }).type === "image";
				}).length
			: 0;
		if (imageCount > 0) {
			if (!options.expanded) return compactFooterWithState(theme, result, context);
			const summary = `↳ Read ${imageCount} ${imageCount === 1 ? "image" : "images"}.`;
			return renderBoxedToolResult(theme, () => [theme.fg("dim", summary)], {
				widthKey,
				footerLines: resultFooterLines(theme, result, context),
			});
		}

		const stripped = stripTrailingNotice(output);
		const parsed = parseReadOutput(stripped);
		const truncationNotice = extractTrailingNotice(output);
		const _linesRead = truncationOutputLines(result) ?? parsed.numberedLines?.length ?? countLines(parsed.body);

		if (!options.expanded) return compactFooterWithState(theme, result, context);

		const body = renderReadBody(theme, options, parsed, output, truncationNotice);
		return renderBoxedToolResult(theme, body, {
			widthKey,
			footerLines: resultFooterLines(theme, result, context),
		});
	},
};
