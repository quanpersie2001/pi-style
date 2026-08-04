// Adaptive diff renderer unit tests: layout-mode selection, unified/split
// rendering, context collapse, and render-budget omission.

import { describe, expect, it } from "vitest";
import { stripAnsi } from "../../extension-src/pi-style/shared/ansi.js";
import {
	AdaptiveDiffComponent,
	buildSplitRows,
	countDiffStats,
	pickDiffMode,
} from "../../extension-src/pi-style/shared/split-diff.js";
import { createFakeTheme } from "../helpers/fake-theme.js";

const theme = createFakeTheme();

function render(diff: string, width: number, maxRows = 36): string[] {
	const rows = buildSplitRows(diff);
	const component = new AdaptiveDiffComponent(theme, rows, maxRows);
	return component.render(width);
}

function textOf(lines: string[]): string {
	return stripAnsi(lines.join("\n"));
}

describe("pickDiffMode", () => {
	it("uses unified for additions-only and removals-only diffs", () => {
		const addedRows = buildSplitRows("+ 5 foo\n+ 6 bar");
		expect(pickDiffMode({ additions: 2, removals: 0 }, addedRows, 120)).toBe("unified");

		const removedRows = buildSplitRows("- 5 foo\n- 6 bar");
		expect(pickDiffMode({ additions: 0, removals: 2 }, removedRows, 120)).toBe("unified");
	});

	it("uses unified on narrow widths even for paired changes", () => {
		const rows = buildSplitRows("- 14 const timeout = 300;\n+ 14 const timeout = 60;");
		expect(pickDiffMode({ additions: 1, removals: 1 }, rows, 80)).toBe("unified");
	});

	it("uses split for short paired changes at wide widths", () => {
		const rows = buildSplitRows("- 14 const timeout = 300;\n+ 14 const timeout = 60;");
		expect(pickDiffMode({ additions: 1, removals: 1 }, rows, 120)).toBe("split");
	});

	it("uses unified when a changed line would wrap badly in a half pane", () => {
		const long = "y".repeat(70);
		const rows = buildSplitRows(`- 1 ${long}\n+ 1 ${long}2`);
		expect(pickDiffMode({ additions: 1, removals: 1 }, rows, 120)).toBe("unified");
	});
});

describe("AdaptiveDiffComponent unified mode", () => {
	it("renders additions as + lines with content and no split header", () => {
		const lines = render(" 1 # Changelog\n 2\n+ 3 - added line\n 4\n+ 5 - another line", 100);
		const text = textOf(lines);
		expect(text).toMatch(/\+ +\d+ {2}- added line/);
		expect(text).toMatch(/\+ +\d+ {2}- another line/);
		expect(text).toContain("1  # Changelog"); // context gutter + content
		expect(text).not.toContain("│ new"); // no two-pane header
		expect(text).not.toContain("⋯"); // no collapse needed
	});

	it("expands a changed pair into removed-then-added unified lines", () => {
		const lines = render("- 14 const timeout = 300;\n+ 14 const timeout = 60;", 80);
		const text = textOf(lines);
		expect(text).toMatch(/- +\d+ {2}const timeout = 300;/);
		expect(text).toMatch(/\+ +\d+ {2}const timeout = 60;/);
	});

	it("collapses leading and trailing unchanged context into gap rows", () => {
		const diff = [
			" 1 a",
			" 2 b",
			" 3 c",
			" 4 d",
			" 5 e",
			"+ 6 NEW",
			" 7 f",
			" 8 g",
			" 9 h",
			" 10 i",
			" 11 j",
			" 12 k",
		].join("\n");
		const lines = render(diff, 100);
		const text = textOf(lines);
		// Leading run (1..5) keeps the 2 lines adjacent to the change (4, 5).
		expect(text).toContain("⋯ 3 unchanged lines hidden");
		expect(text).toContain("4  d");
		expect(text).toContain("5  e");
		// Trailing run (7..12) keeps the first 2 lines then collapses the rest.
		expect(text).toContain("⋯ 4 unchanged lines hidden");
		expect(text).toContain("7  f");
		expect(text).toContain("8  g");
		expect(text).toMatch(/\+ +\d+ {2}NEW/);
		expect(text).not.toContain("9  h");
	});
});

describe("AdaptiveDiffComponent split mode", () => {
	it("renders the old | new panes and inline emphasis", () => {
		const lines = render("- 6 before\n+ 6 after", 120);
		const text = textOf(lines);
		expect(text).toContain("old");
		expect(text).toContain("new");
		expect(text).toContain("before");
		expect(text).toContain("after");
	});

	it("collapses unchanged context in split mode too", () => {
		const diff = [
			" 1 a",
			" 2 b",
			" 3 c",
			" 4 d",
			" 5 e",
			"- 6 before",
			"+ 6 after",
			" 7 f",
			" 8 g",
			" 9 h",
			" 10 i",
			" 11 j",
			" 12 k",
		].join("\n");
		const lines = render(diff, 120);
		const text = textOf(lines);
		expect(text).toContain("⋯ 3 unchanged lines hidden");
		expect(text).toContain("⋯ 4 unchanged lines hidden");
		expect(text).toContain("before");
		expect(text).toContain("after");
	});
});

describe("AdaptiveDiffComponent budget", () => {
	it("trims the head and appends an omission marker when still over budget", () => {
		const pairs = Array.from({ length: 45 }, (_, i) => `- ${i + 1} line ${i + 1}\n+ ${i + 1} line ${i + 1} EDITED`);
		const lines = render(pairs.join("\n"), 120, 36);
		const text = textOf(lines);
		expect(text).toContain("⋯ 10 lines omitted · Ctrl+O to show full diff");
	});

	it("keeps the full diff when it fits the budget", () => {
		const pairs = Array.from({ length: 10 }, (_, i) => `- ${i + 1} line ${i + 1}\n+ ${i + 1} line ${i + 1} EDITED`);
		const lines = render(pairs.join("\n"), 120, 36);
		const text = textOf(lines);
		expect(text).not.toContain("omitted");
		expect(text).toContain("line 10 EDITED");
	});
});

describe("countDiffStats", () => {
	it("counts added and removed lines, skipping +++/--- headers", () => {
		expect(countDiffStats("--- a/x\n+++ b/x\n- 1 old\n+ 1 new")).toEqual({ additions: 1, removals: 1 });
	});
});
