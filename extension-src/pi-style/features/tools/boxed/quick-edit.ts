// Boxed quick-edit / substitute-edit / target-edit renderer.

import { getLanguageFromPath } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { stripAnsi } from "../../../shared/ansi.js";
import type { BoxTheme } from "../../../shared/box.js";
import {
	formatBoxedFooterFromValues,
	getTextOutput,
	renderBoxedToolCall,
	renderBoxedToolResult,
} from "../../../shared/box.js";
import { buildSplitRows, countDiffStats, renderDiffMeter, SplitDiffComponent } from "../../../shared/split-diff.js";
import { getStateElapsedMs } from "./session-config.js";
import { type BoxedToolContext, type BoxedToolDefinition, displayPath, noteExecutionStart } from "./shared.js";

const MAX_HIGHLIGHT_DIFF_CHARS = 12000;
const MAX_HIGHLIGHT_DIFF_ROWS = 120;

interface QuickEditToolConfig {
	toolLabel: string;
	applyingLabel: string;
	fallbackLabel: string;
}

const QUICK_EDIT_TOOLS: Readonly<Record<string, QuickEditToolConfig>> = {
	quick_edit: {
		toolLabel: "Quick Edit",
		applyingLabel: "quick-edit",
		fallbackLabel: "Quick edit applied",
	},
	substitute_edit: {
		toolLabel: "Substitute Edit",
		applyingLabel: "substitute-edit",
		fallbackLabel: "Substitute edit applied",
	},
	target_edit: {
		toolLabel: "Target Edit",
		applyingLabel: "target-edit",
		fallbackLabel: "Target edit applied",
	},
};

export function getQuickEditToolConfig(toolName: unknown): QuickEditToolConfig | undefined {
	return typeof toolName === "string" ? QUICK_EDIT_TOOLS[toolName] : undefined;
}

function extractQuickEditDiff(text: string): string | undefined {
	const lines = stripAnsi(text).replace(/\r/g, "").split("\n");
	const start = lines.indexOf("── diff ──");
	if (start < 0) return undefined;

	const diffLines: string[] = [];
	let cumulativeDelta = 0;
	let oldLine: number | undefined;
	let newLine: number | undefined;
	let chunkAdditions = 0;
	let chunkRemovals = 0;

	const finishChunk = () => {
		cumulativeDelta += chunkAdditions - chunkRemovals;
		oldLine = undefined;
		newLine = undefined;
		chunkAdditions = 0;
		chunkRemovals = 0;
	};

	for (const line of lines.slice(start + 1)) {
		if (line === "") {
			finishChunk();
			continue;
		}

		const headerMatch = line.match(/^:(\d+)(?:-\d+)?$/);
		if (headerMatch) {
			finishChunk();
			const startLine = Number.parseInt(headerMatch[1] ?? "", 10);
			oldLine = startLine;
			newLine = startLine + cumulativeDelta;
			continue;
		}

		const match = line.match(/^([+-]) (.*)$/);
		if (match) {
			const [, sign, content = ""] = match;
			let gutter = "";
			if (sign === "-" && oldLine !== undefined) gutter = String(oldLine++);
			if (sign === "+" && newLine !== undefined) gutter = String(newLine++);
			if (!gutter) continue;
			if (sign === "-") chunkRemovals++;
			if (sign === "+") chunkAdditions++;
			diffLines.push(`${sign} ${gutter} ${content}`);
			continue;
		}

		if (line === "---") break;
	}

	return diffLines.length > 0 ? diffLines.join("\n") : undefined;
}

function quickEditFooter(theme: BoxTheme, context: BoxedToolContext, output = ""): string {
	return formatBoxedFooterFromValues(theme, getStateElapsedMs(context.state), output);
}

function renderQuickEditResult(
	_toolName: string,
	result: { content?: readonly unknown[]; details?: unknown },
	options: { expanded: boolean; isPartial: boolean },
	theme: BoxTheme,
	context: BoxedToolContext,
	config: QuickEditToolConfig,
) {
	if (options.isPartial) {
		return renderBoxedToolResult(
			theme,
			() => [`${theme.fg("dim", "↳")} ${theme.fg("muted", `Applying ${config.applyingLabel}...`)}`],
			{ isPartial: true },
		);
	}

	const output = getTextOutput(result);
	if (context.isError) {
		return renderBoxedToolResult(theme, () => [theme.fg("error", stripAnsi(output).trim() || "Error")], {
			footerLines: [quickEditFooter(theme, context, output)],
			isError: true,
		});
	}

	const diff = extractQuickEditDiff(output);
	if (!diff) {
		const fallback = stripAnsi(output).trim() || config.fallbackLabel;
		return renderBoxedToolResult(theme, () => [`${theme.fg("dim", "↳")} ${theme.fg("muted", fallback)}`], {
			footerLines: [quickEditFooter(theme, context, output)],
		});
	}

	const rows = buildSplitRows(diff);
	const expanded = options.expanded;
	const argPath = String(context?.args?.path ?? "");
	const language = argPath ? getLanguageFromPath(argPath) : undefined;
	const shouldHighlight =
		Boolean(language) && diff.length <= MAX_HIGHLIGHT_DIFF_CHARS && rows.length <= MAX_HIGHLIGHT_DIFF_ROWS;

	const { additions, removals } = countDiffStats(diff);
	const meter = renderDiffMeter(theme, additions, removals);
	const summary =
		`${theme.fg("dim", "↳")} ${theme.fg("muted", "diff")}` +
		` ${theme.fg("toolDiffAdded", `+${additions}`)}` +
		` ${theme.fg("toolDiffRemoved", `-${removals}`)}` +
		` ${theme.fg("muted", "split")}` +
		(meter ? ` ${meter}` : "");

	const maxRows = expanded ? 160 : 36;
	const split = new SplitDiffComponent(theme, rows, maxRows, shouldHighlight ? language : undefined);

	return renderBoxedToolResult(
		theme,
		{
			render(width: number): string[] {
				const safeWidth = Math.max(20, width);
				const headerLines = new Text(summary, 0, 0).render(safeWidth);
				return [...headerLines, ...split.render(safeWidth)];
			},
			invalidate(): void {
				split.invalidate();
			},
		},
		{
			footerLines: [quickEditFooter(theme, context, output)],
		},
	);
}

export function quickEditTool(config: QuickEditToolConfig): BoxedToolDefinition {
	return {
		call(args, theme, context) {
			noteExecutionStart(context);
			const detail = displayPath(String(args?.path ?? ""), context);
			return renderBoxedToolCall(theme, config.toolLabel, [`${theme.fg("dim", "Path: ")}${detail}`], {
				isError: Boolean(context.isError),
				isPartial: Boolean(context.isPartial),
				isPending: Boolean(context.isPartial),
			});
		},
		result(result, options, theme, context) {
			return renderQuickEditResult(config.toolLabel, result, options, theme, context, config);
		},
	};
}
