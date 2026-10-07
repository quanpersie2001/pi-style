// Boxed message-block shell (skill/compaction/branch/custom/MCP blocks).
// Returns only border/content lines with foreground styling; the parent Box
// applies its background (customMessageBg by default, a neutral card surface
// for compaction).

import type { Component } from "@earendil-works/pi-tui";
import { truncateAnsi } from "../../shared/ansi.js";
import type { BoxTheme } from "../../shared/box.js";
import { boxBlankLine, boxBorder, boxInnerWidth, boxLabeledBorder, boxLine, boxWidth } from "../../shared/box.js";

export type MessageBlockOptions = {
	kind: string;
	title?: string;
	right?: string;
	body: (contentWidth: number) => string[];
	hasDivider?: boolean | "auto";
	icon?: string;
	cache?: boolean;
	/** Dense cards omit shell breathing rows, even when the body is empty. */
	compact?: boolean;
};

function formatMessageBlockTitle(theme: BoxTheme, kind: string, title?: string, icon = "➔"): string {
	const rawTitle = title ? `${icon} ${kind} · ${title}` : `${icon} ${kind}`;
	const coloredTitle = theme.fg("accent", rawTitle);
	return typeof theme?.bold === "function" ? theme.bold(coloredTitle) : coloredTitle;
}

/**
 * Render a boxed message block.
 *
 * The title is embedded in the rounded top border, the body sits between
 * blank padding rows (unless compact), and the expand hint (when present) is embedded at the
 * right end of the bottom border — no inset dividers.
 *
 * Returns only border/content lines with foreground styling. Background is
 * applied by the parent Box (customMessageBg or compaction's neutral surface),
 * so this helper must NOT apply background itself —
 * that would create a double-background conflict.
 */
export function renderBoxedMessageBlock(theme: BoxTheme, options: MessageBlockOptions): Component {
	const { kind, title, right, body, icon = "➔", cache: shouldCache = true, compact = false } = options;
	let cache: { width: number; lines: string[] } | null = null;

	return {
		invalidate() {
			cache = null;
		},
		render(width: number): string[] {
			if (compact && width <= 0) return [];
			if (shouldCache && cache?.width === width) return cache.lines;

			const renderedWidth = boxWidth(width);
			const contentWidth = boxInnerWidth(renderedWidth);
			const titleLine = formatMessageBlockTitle(theme, kind, title, icon);
			const bodyLines = body(contentWidth);

			const lines: string[] = [boxLabeledBorder(theme, "╭", "╮", titleLine, undefined, renderedWidth)];
			if (!compact) lines.push(boxBlankLine(theme, renderedWidth));
			lines.push(...bodyLines.map((line) => boxLine(theme, line, renderedWidth)));
			if (!compact && bodyLines.length > 0) lines.push(boxBlankLine(theme, renderedWidth));
			if (right) {
				const hint = compact ? truncateAnsi(right, renderedWidth - 5, "…") : right;
				lines.push(boxLabeledBorder(theme, "╰", "╯", "", theme.fg("dim", hint), renderedWidth));
			} else {
				lines.push(boxBorder(theme, "╰", "╯", renderedWidth));
			}

			const fitted = compact ? lines.map((line) => truncateAnsi(line, width, "")) : lines;
			if (shouldCache) cache = { width, lines: fitted };
			return fitted;
		},
	};
}
