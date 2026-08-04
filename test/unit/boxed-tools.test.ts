import {
	BranchSummaryMessageComponent,
	CompactionSummaryMessageComponent,
	CustomMessageComponent,
	initTheme,
	parseSkillBlock,
	SkillInvocationMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setSpecialBlockTheme } from "../../extension-src/pi-style/features/messages/special-blocks.js";
import {
	renderBoxedToolCall as dispatchCall,
	renderBoxedToolResult as dispatchResult,
} from "../../extension-src/pi-style/features/tools/boxed/index.js";
import { setToolsRenderConfig } from "../../extension-src/pi-style/features/tools/boxed/session-config.js";
import type { BoxedToolContext } from "../../extension-src/pi-style/features/tools/boxed/shared.js";
import { createToolDecorationOwner } from "../../extension-src/pi-style/features/tools/index.js";
import {
	type CompatibilityProbeReport,
	disposePiCompatibilityProbe,
	probePiCompatibility,
} from "../../extension-src/pi-style/pi/compatibility-probe.js";
import { stripAnsi, visibleWidth } from "../../extension-src/pi-style/shared/ansi.js";
import {
	boxBorder,
	boxInnerWidth,
	boxLine,
	boxLineWithRight,
	boxWidth,
	formatBoxedFooterFromValues,
	formatToolName,
	renderBoxedToolCall,
	renderBoxedToolResult,
} from "../../extension-src/pi-style/shared/box.js";
import {
	annotateToolResultMetrics,
	formatElapsedMs,
	formatOutputChars,
	formatToolMetricsFromValues,
} from "../../extension-src/pi-style/shared/elapsed.js";
import {
	boxedResultRenderBudget,
	clampRenderLine,
	safeTruncateToWidth,
	safeVisibleWidth,
	safeWrapTextWithAnsi,
	truncateAtCodePointBoundary,
} from "../../extension-src/pi-style/shared/render-budget.js";
import { createFakeTheme } from "../helpers/fake-theme.js";

const theme = createFakeTheme();
const widths = [0, 1, 12, 20, 40, 60, 80, 120, 160];

function context(overrides: Partial<BoxedToolContext> = {}): BoxedToolContext {
	return {
		args: {},
		toolCallId: "fixture-call",
		invalidate: () => {},
		state: {},
		cwd: "/fake",
		executionStarted: true,
		argsComplete: true,
		isPartial: false,
		expanded: false,
		showImages: true,
		isError: false,
		lastComponent: undefined,
		...overrides,
	};
}

function assertFit(lines: readonly string[], width: number): void {
	for (const line of lines) {
		expect(visibleWidth(line), `line must fit ${width}: ${JSON.stringify(line)}`).toBeLessThanOrEqual(width);
	}
}

afterEach(() => {
	setSpecialBlockTheme(undefined);
	if (activeReport) {
		disposePiCompatibilityProbe(activeReport);
		activeReport = undefined;
	}
});

beforeEach(() => {
	initTheme("dark", false);
});

let activeReport: CompatibilityProbeReport | undefined;

/** Install the certified boxed adapters for the special message blocks. */
function installSpecialBlockAdapters(): void {
	activeReport = probePiCompatibility("0.83.0");
}

describe("box primitives", () => {
	it("sizes boxes and builds width-safe lines at every width", () => {
		for (const width of widths) {
			expect(boxWidth(width)).toBeGreaterThanOrEqual(12);
			expect(boxInnerWidth(width)).toBeGreaterThanOrEqual(1);
			const line = boxLine(theme, "a very long content string that must truncate cleanly", width);
			expect(visibleWidth(line)).toBeLessThanOrEqual(Math.max(12, width));
			const bordered = boxBorder(theme, "╭", "╮", width);
			assertFit([bordered], Math.max(12, width));
			const right = boxLineWithRight(theme, "left content", "right", width);
			assertFit([right], Math.max(12, width));
		}
	});

	it("formats tool names and footer metrics", () => {
		expect(formatToolName("quick_edit")).toBe("Quick Edit");
		expect(formatToolName("substitute-edit")).toBe("Substitute Edit");
		expect(formatToolName("target_edit")).toBe("Target Edit");
		expect(formatToolName("read")).toBe("Read");
		expect(formatElapsedMs(500)).toBe("500ms");
		expect(formatElapsedMs(2500)).toBe("2.5s");
		expect(formatElapsedMs(12000)).toBe("12s");
		expect(formatOutputChars(950)).toBe("950 chars");
		expect(formatOutputChars(2400)).toBe("2.4k chars");
		expect(formatToolMetricsFromValues(2500, 2400)).toBe("2.5s · 2.4k chars");
		const footer = formatBoxedFooterFromValues(theme, 1500, "some output text");
		expect(footer).toContain("1.50s");
		expect(footer).toContain("words");
		expect(footer).not.toContain("◷");
	});

	it("annotates metrics into result details only when absent", () => {
		const result: { content: unknown[]; details: Record<string, unknown> } = {
			content: [{ type: "text", text: "hello" }],
			details: {},
		};
		annotateToolResultMetrics(result, 123);
		expect(result.details.__elapsedMs).toBe(123);
		expect(result.details.__outputChars).toBe(5);
		annotateToolResultMetrics(result, 999);
		expect(result.details.__elapsedMs).toBe(123);
	});
});

describe("render budget", () => {
	it("measures widths and truncates ANSI strings safely", () => {
		const colored = theme.fg("toolOutput", "hello");
		expect(safeVisibleWidth(colored)).toBe(5);
		const truncated = safeTruncateToWidth(colored, 3, "…");
		expect(safeVisibleWidth(truncated)).toBe(3);
		expect(safeTruncateToWidth("abc", 0)).toBe("");
		const wrapped = safeWrapTextWithAnsi("one two three four", 7);
		expect(wrapped.every((line) => safeVisibleWidth(line) <= 7)).toBe(true);
	});

	it("clamps long lines without splitting surrogate pairs", () => {
		// Emoji (U+1F600) is a surrogate pair; a plain slice at an odd boundary
		// would produce a lone surrogate that renders as �.
		const emoji = "😀";
		const line = `${"a".repeat(1999)}${emoji}tail`;
		const clamped = clampRenderLine(line, 2000);
		expect(clamped).not.toContain("\uFFFD");
		expect(clamped).toContain("(truncated)");
		expect(clamped.length).toBeLessThanOrEqual(2000 + "… (truncated)".length);
		const cut = truncateAtCodePointBoundary(`${"x".repeat(2000)}${emoji}`, 2000);
		expect(cut).not.toContain("\uFFFD");
	});

	it("computes bounded head/tail budgets", () => {
		const budget = boxedResultRenderBudget(10);
		expect(budget.headLines).toBeGreaterThanOrEqual(1);
		expect(budget.tailLines).toBeGreaterThanOrEqual(1);
		expect(budget.maxRenderedLines).toBeGreaterThanOrEqual(budget.headLines + budget.tailLines);
	});
});

describe("boxed tool renderers", () => {
	beforeEach(() => {
		setToolsRenderConfig({ maxCollapsedLines: 10, maxExpandedLines: 50, dimOutput: false, showElapsed: true });
	});

	it("renders a read call as a boxless batch tree panel", () => {
		const ctx = context({ args: { path: "/fake/src/index.ts" } });
		const call = dispatchCall("read", { path: "/fake/src/index.ts" }, theme, ctx);
		for (const width of [40, 80, 120]) {
			const lines = call.render(width);
			expect(lines[0]).toContain("Read (1)");
			expect(lines.join("\n")).toContain("index.ts");
			expect(lines.join("\n")).not.toContain("╭");
			assertFit(lines, Math.max(12, width));
		}
		const result = dispatchResult(
			"read",
			{ content: [{ type: "text", text: "hello" }], details: {} },
			{ expanded: false, isPartial: false },
			theme,
			ctx,
		);
		// The batch panel lives in the call component; the result adds nothing.
		expect(result.render(80)).toEqual([]);
		const refreshedCall = dispatchCall("read", { path: "/fake/src/index.ts" }, theme, ctx).render(80);
		expect(refreshedCall.join("\n")).toContain("index.ts");
		assertFit(refreshedCall, 80);
	});

	it("renders an expanded bash result with output tail and truncation hint", () => {
		const output = Array.from({ length: 40 }, (_, i) => `line-${i}`).join("\n");
		const ctx = context({ args: { command: "printf 'x'", timeout: 30 } });
		const call = dispatchCall("bash", { command: "printf 'x'", timeout: 30 }, theme, ctx);
		const callLines = call.render(80);
		expect(callLines.join("\n")).toContain("Bash");
		assertFit(callLines, 80);
		const result = dispatchResult(
			"bash",
			{ content: [{ type: "text", text: output }], details: {} },
			{ expanded: false, isPartial: false },
			theme,
			ctx,
		);
		const lines = result.render(80);
		expect(lines.join("\n")).toContain("line-39");
		expect(lines.join("\n")).toContain("Ctrl+O for more");
		assertFit(lines, 80);
	});

	it("renders an expanded edit result with an adaptive diff and stats", () => {
		const diff = "- 1 old line\n+ 1 new line";
		const ctx = context({ args: { path: "/fake/src/a.ts" } });
		const result = dispatchResult(
			"edit",
			{ content: [], details: { diff, path: "/fake/src/a.ts" } },
			{ expanded: true, isPartial: false },
			theme,
			ctx,
		);
		const lines = result.render(120);
		// Short corresponding change at a wide width: split side-by-side layout.
		expect(stripAnsi(lines.join("\n"))).toContain("Diff · +1 -1");
		expect(stripAnsi(lines.join("\n"))).toContain("1 file · +1 -1");
		expect(stripAnsi(lines.join("\n"))).toContain("old"); // split column header
		assertFit(lines, 120);
	});

	it("renders additions-only edit diffs as unified and collapses unchanged context", () => {
		const diff = [
			" 1 # Changelog",
			" 2",
			" 3 ## 0.1.0 - Unreleased",
			" 4",
			"+ 5 - **Fixed: boxed tool/message surfaces now survive session switches",
			"+ 6 - **Fixed: single-line replies keep their `|` prefix**",
			" 7",
			" 8 - Added the boxed **tool presentation**",
			" 9",
			" 10",
			" 11",
			" 12",
			" 13",
			" 14",
			" 15",
			" 16",
		].join("\n");
		const ctx = context({ args: { path: "/fake/CHANGELOG.md" } });
		const result = dispatchResult(
			"edit",
			{ content: [], details: { diff, path: "/fake/CHANGELOG.md" } },
			{ expanded: false, isPartial: false },
			theme,
			ctx,
		);
		const lines = result.render(120);
		const text = stripAnsi(lines.join("\n"));
		// Additions-only: unified layout, stats in the divider, no progress meter.
		expect(text).toContain("Diff · +2 -0");
		expect(text).toContain("1 file · +2 -0");
		expect(text).not.toContain("━━");
		// Long trailing context is collapsed into a single row.
		expect(text).toContain("⋯ 8 unchanged lines hidden");
		expect(text).toContain("- **Fixed: boxed tool/message surfaces");
		assertFit(lines, 120);
	});

	it("forces unified diff on narrow terminals even for paired changes", () => {
		const diff = "- 14 const timeout = 300;\n+ 14 const timeout = 60;";
		const ctx = context({ args: { path: "/fake/src/config.ts" } });
		for (const width of [40, 80]) {
			const lines = dispatchResult(
				"edit",
				{ content: [], details: { diff, path: "/fake/src/config.ts" } },
				{ expanded: false, isPartial: false },
				theme,
				ctx,
			).render(width);
			const text = stripAnsi(lines.join("\n"));
			expect(text).toContain("Diff · +1 -1");
			expect(text).toContain("const timeout = 300;");
			expect(text).toContain("const timeout = 60;");
			assertFit(lines, Math.max(12, width));
		}
	});

	it("shows a Ctrl+O omission hint when a huge diff exceeds the row budget", () => {
		const pairs = Array.from({ length: 45 }, (_, i) => `- ${i + 1} line ${i + 1}\n+ ${i + 1} line ${i + 1} EDITED`);
		const diff = pairs.join("\n");
		const ctx = context({ args: { path: "/fake/huge.txt" } });
		const lines = dispatchResult(
			"edit",
			{ content: [], details: { diff, path: "/fake/huge.txt" } },
			{ expanded: false, isPartial: false },
			theme,
			ctx,
		).render(120);
		const text = stripAnsi(lines.join("\n"));
		expect(text).toContain("lines omitted · Ctrl+O to show full diff");
		expect(text).toContain("Ctrl+O more"); // divider-right expand hint
		expect(text).not.toContain("rendered output truncated");
		assertFit(lines, 120);
	});

	it("puts the edit path in the header instead of a body line", () => {
		const ctx = context({ args: { path: "/fake/src/a.ts" } });
		const lines = dispatchCall("edit", { path: "/fake/src/a.ts" }, theme, ctx).render(80);
		const text = stripAnsi(lines.join("\n"));
		expect(text).toContain("Edit ✓ · src/a.ts");
		expect(text).not.toContain("Path:");
		assertFit(lines, 80);
	});

	it("renders a quick-edit call with its label", () => {
		const ctx = context({ args: { path: "/fake/src/b.ts" } });
		const lines = dispatchCall("quick_edit", { path: "/fake/src/b.ts" }, theme, ctx).render(80);
		expect(lines.join("\n")).toContain("Quick Edit");
		assertFit(lines, 80);
	});

	it("renders a write call as a numbered content preview box", () => {
		// The renderer state is shared across updateDisplay passes (like Pi's
		// ToolExecutionComponent): the result renderer stores the metrics footer
		// into it, and the re-invoked call renderer closes the box with it.
		const state: Record<string, unknown> = {};
		const args = { path: "/tmp/pi-write-test.md", content: "a\nb\nc\n" };

		// Pending (args streaming / execution started, no result yet).
		const pending = dispatchCall("write", args, theme, context({ args, state, isPartial: true })).render(80);
		const pendingText = stripAnsi(pending.join("\n"));
		expect(pendingText).toContain("Write ✓ · Path: ../tmp/pi-write-test.md");
		expect(pendingText).toContain("1 a");
		expect(pendingText).toContain("2 b");
		expect(pendingText).toContain("3 c");
		expect(pendingText).toContain("4 "); // trailing empty line from the final newline
		expect(pendingText).toContain("Waiting for output");
		assertFit(pending, 80);

		// Settled: the result stores the footer into the shared state; the call
		// re-renders with the footer in the bottom border (elapsed · words).
		dispatchResult(
			"write",
			{ content: [{ type: "text", text: "Successfully wrote 6 bytes to /tmp/pi-write-test.md" }], details: {} },
			{ expanded: false, isPartial: false },
			theme,
			context({ args, state }),
		);
		const settled = dispatchCall("write", args, theme, context({ args, state })).render(80);
		const settledText = stripAnsi(settled.join("\n"));
		expect(settledText).toContain("1 a");
		expect(settledText).toContain("4 ");
		expect(settledText).toMatch(/\d+\.\d\ds · ~\d+ words/);
		expect(settledText).not.toContain("Waiting for output");
		assertFit(settled, 80);
	});

	it("shows a Ctrl+O for more hint when the write preview is truncated", () => {
		const content = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n");
		const ctx = context({ args: { path: "/tmp/big.md", content } });
		const call = dispatchCall("write", ctx.args, theme, ctx);
		dispatchResult(
			"write",
			{ content: [{ type: "text", text: "Successfully wrote 100 bytes to /tmp/big.md" }], details: {} },
			{ expanded: false, isPartial: false },
			theme,
			ctx,
		);
		const lines = call.render(80);
		const text = stripAnsi(lines.join("\n"));
		expect(text).toContain("10 line 10");
		expect(text).not.toContain("11 line 11");
		expect(text).toContain("… 2 more lines");
		expect(text).toContain("Ctrl+O for more");
		assertFit(lines, 80);
	});

	it("expands the write preview to the expanded line budget", () => {
		const content = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n");
		const ctx = context({ args: { path: "/tmp/big.md", content }, expanded: true });
		const call = dispatchCall("write", ctx.args, theme, ctx);
		dispatchResult(
			"write",
			{ content: [{ type: "text", text: "Successfully wrote 100 bytes to /tmp/big.md" }], details: {} },
			{ expanded: true, isPartial: false },
			theme,
			ctx,
		);
		const lines = call.render(80);
		const text = stripAnsi(lines.join("\n"));
		expect(text).toContain("12 line 12");
		expect(text).not.toContain("Ctrl+O for more");
		expect(text).not.toContain("more lines");
		assertFit(lines, 80);
	});

	it("keeps a blank body for empty write content", () => {
		const ctx = context({ args: { path: "/tmp/empty.md", content: "" } });
		const lines = dispatchCall("write", ctx.args, theme, ctx).render(80);
		const text = stripAnsi(lines.join("\n"));
		expect(text).not.toMatch(/^\s*\d+ /m); // no numbered rows
		assertFit(lines, 80);
	});

	it("renders write errors in the boxed error result without a preview body", () => {
		const ctx = context({ args: { path: "/tmp/x.md", content: "a" }, isError: true });
		const call = dispatchCall("write", ctx.args, theme, ctx).render(80);
		expect(stripAnsi(call.join("\n"))).toContain("Write ✗");
		expect(stripAnsi(call.join("\n"))).not.toContain("1 a");
		assertFit(call, 80);
		const result = dispatchResult(
			"write",
			{ content: [{ type: "text", text: "EACCES: permission denied" }], details: {} },
			{ expanded: false, isPartial: false },
			theme,
			ctx,
		).render(80);
		expect(stripAnsi(result.join("\n"))).toContain("EACCES: permission denied");
		assertFit(result, 80);
	});

	it.each(["TaskCreate", "TaskUpdate", "TaskList", "TaskDelete", "custom_tool_xyz", "run_tests", "submit_patch"])(
		"boxes every non-registered tool through the generic fallback: %s",
		(toolName) => {
			const ctx = context({ args: { key: "value" } });
			const call = dispatchCall(toolName, { key: "value" }, theme, ctx).render(80);
			expect(call.join("\n")).toContain("╭");
			expect(call.join("\n")).toContain("➔");
			assertFit(call, 80);
			const result = dispatchResult(
				toolName,
				{ content: [{ type: "text", text: "generic output" }], details: {} },
				{ expanded: false, isPartial: false },
				theme,
				ctx,
			).render(80);
			expect(result.join("\n")).toContain("generic output");
			assertFit(result, 80);
		},
	);

	it("falls back to a boxed generic renderer for unknown tools", () => {
		const ctx = context({ args: { value: "x" } });
		const call = dispatchCall("some_custom_tool", { value: "x" }, theme, ctx).render(80);
		expect(call.join("\n")).toContain("Some Custom Tool");
		assertFit(call, 80);
		const result = dispatchResult(
			"some_custom_tool",
			{ content: [{ type: "text", text: "custom output line" }], details: {} },
			{ expanded: false, isPartial: false },
			theme,
			ctx,
		).render(80);
		expect(result.join("\n")).toContain("custom output line");
		assertFit(result, 80);
	});

	it("keeps every renderer width-safe from narrow to wide", () => {
		for (const width of widths) {
			if (width === 0) continue;
			const ctx = context({ args: { path: "/fake/src/index.ts", command: "npm test" } });
			for (const [name, args] of [
				["read", { path: "/fake/src/index.ts" }],
				["write", { path: "/fake/src/out.ts", content: "x" }],
				["edit", { path: "/fake/src/edit.ts" }],
				["ls", { path: "/fake" }],
				["find", { pattern: "*.ts", path: "/fake" }],
				["grep", { pattern: "test", path: "/fake" }],
				["bash", { command: "echo hi", timeout: 30 }],
				["unknown", { anything: "x" }],
			] as const) {
				const callLines = dispatchCall(name, args as Record<string, unknown>, theme, ctx).render(width);
				assertFit(callLines, Math.max(12, width));
				const resultLines = dispatchResult(
					name,
					{ content: [{ type: "text", text: "some output" }], details: {} },
					{ expanded: true, isPartial: false },
					theme,
					ctx,
				).render(width);
				assertFit(resultLines, Math.max(12, width));
			}
		}
	});
});

describe("boxed tool decoration owner", () => {
	it("provides a boxed fallback renderer when the tool has no native renderer", () => {
		const owner = createToolDecorationOwner({ style: "compact-box" });
		// Extension tools (e.g. TaskUpdate) register no renderCall/renderResult:
		// getCallRenderer returns undefined and updateDisplay would fall back to a
		// plain Text. The decoration owner must substitute a boxed fallback renderer.
		const native = () => undefined;
		const instance = { toolName: "TaskUpdate" };
		const callRenderer = owner.decorateToolRendererSelection("tool-call-renderer", native, instance, []);
		expect(typeof callRenderer).toBe("function");
		const ctx = context({ args: { taskId: "2" } });
		const callLines = (callRenderer as (a: unknown, t: unknown, c: unknown) => { render(w: number): string[] })(
			{ taskId: "2" },
			theme,
			ctx,
		).render(80);
		expect(callLines.join("\n")).toContain("Task Update");
		assertFit(callLines, 80);

		const resultRenderer = owner.decorateToolRendererSelection("tool-result-renderer", native, instance, []);
		expect(typeof resultRenderer).toBe("function");
		const resultLines = (
			resultRenderer as (r: unknown, o: unknown, t: unknown, c: unknown) => { render(w: number): string[] }
		)(
			{ content: [{ type: "text", text: "Updated task #2 status" }], details: {} },
			{ expanded: false, isPartial: false },
			theme,
			ctx,
		).render(80);
		expect(resultLines.join("\n")).toContain("Updated task #2 status");
		assertFit(resultLines, 80);
	});

	it("dispatches compact-box renderers with boxed borders", () => {
		const owner = createToolDecorationOwner({ style: "compact-box" });
		const native = () => (args: Record<string, unknown>) => ({
			invalidate() {},
			render() {
				return [`native ${args.path ?? ""}`];
			},
		});
		const instance = { toolName: "read" };
		const wrapped = owner.decorateToolRendererSelection("tool-call-renderer", native, instance, []);
		expect(typeof wrapped).toBe("function");
		const component = (wrapped as (args: unknown, theme: unknown, context: unknown) => { render(w: number): string[] })(
			{ path: "/fake/a.ts" },
			theme,
			context(),
		);
		const lines = component.render(80);
		expect(lines[0]).toContain("Read (1)");
		expect(lines.join("\n")).toContain("a.ts");
		expect(lines.join("\n")).not.toContain("╭");
		assertFit(lines, 80);
	});
});

describe("special message blocks", () => {
	it("renders skill, compaction, branch, and custom blocks boxed with a theme", () => {
		installSpecialBlockAdapters();
		setSpecialBlockTheme(theme);
		const skillBlock = parseSkillBlock('<skill name="fixture" location="/fake">\ncontent **rich**\n</skill>');
		if (!skillBlock) throw new Error("skill fixture failed to parse");
		const components = [
			new CompactionSummaryMessageComponent({
				role: "compactionSummary",
				summary: "summary **rich**",
				tokensBefore: 1234,
				timestamp: 1,
			}),
			new BranchSummaryMessageComponent({
				role: "branchSummary",
				summary: "branch **rich**",
				fromId: "id",
				timestamp: 1,
			}),
			new SkillInvocationMessageComponent(skillBlock),
			new CustomMessageComponent(
				{ role: "custom", customType: "mcp_tool", content: "custom **rich**", display: true, timestamp: 1 },
				undefined,
			),
		];
		const expectations = ["Compaction", "Branch", "Skill", "mcp_tool"];
		for (const [index, component] of components.entries()) {
			const lines = component.render(80);
			expect(lines.join("\n")).toContain("╭");
			expect(lines.join("\n")).toContain(expectations[index] ?? "");
			assertFit(lines, 80);
		}
	});

	it("falls back to native layout without a session theme", () => {
		installSpecialBlockAdapters();
		const skillBlock = parseSkillBlock('<skill name="fixture" location="/fake">\ncontent\n</skill>');
		if (!skillBlock) throw new Error("skill fixture failed to parse");
		const component = new SkillInvocationMessageComponent(skillBlock);
		const native = component.render(80);
		expect(native.join("\n")).not.toContain("╭");
	});

	it("keeps a custom renderer when provided", () => {
		installSpecialBlockAdapters();
		setSpecialBlockTheme(theme);
		const component = new CustomMessageComponent(
			{ role: "custom", customType: "mcp_tool", content: "ignored", display: true, timestamp: 1 },
			(message: { content?: unknown }) =>
				({ render: () => [`renderer:${String(message.content)}`], invalidate() {} }) as never,
		);
		const lines = component.render(80);
		expect(lines.join("\n")).toContain("╭");
		expect(lines.join("\n")).toContain("renderer:ignored");
		assertFit(lines, 80);
	});
});

describe("renderBoxedToolCall/renderBoxedToolResult direct primitives", () => {
	it("colors the whole tool title with the error color on failure", () => {
		const rich = createFakeTheme({
			colors: { border: "#888888", error: "#ff4444", success: "#22dd44", bashMode: "#ffcc66" },
		});
		const ok = renderBoxedToolCall(rich, "Tool", ["detail"], {}).render(40)[0];
		const err = renderBoxedToolCall(rich, "Tool", ["detail"], { isError: true }).render(40)[0];
		// Success: the tool keeps its identity color and only the ✓ is success-colored.
		expect(ok ?? "").toContain("\x1b[38;2;255;204;102m➔ Tool");
		expect(ok ?? "").toContain("\x1b[38;2;34;221;68m✓");
		expect(ok ?? "").not.toContain("\x1b[38;2;255;68;68m");
		// Error: the whole "➔ Tool ✗" span is wrapped in the error color.
		expect(err ?? "").toContain("\x1b[38;2;255;68;68m➔ Tool ✗");
	});

	it("keeps every border glyph in the border color around embedded labels", () => {
		// Embedded labels (title/divider/footer) wrap their text in foreground
		// escapes that end with \x1b[39m (reset to the terminal default). The border
		// must re-apply its color per segment, otherwise every dash after a label
		// renders in the default foreground and the box looks faint/bold in parts.
		const rich = createFakeTheme({ colors: { border: "#888888" } });
		const borderAnsi = "\x1b[38;2;136;136;136m";
		const call = renderBoxedToolCall(rich, "Tool", ["detail"], {}).render(40);
		expect(call[0] ?? "").toContain(`${borderAnsi}╭`);
		expect(call[0] ?? "").toContain(`${borderAnsi}╮`);
		const result = renderBoxedToolResult(rich, () => ["out"], { footerLines: ["0.00s · ~2 words"] }).render(40);
		expect(result[0] ?? "").toContain(`${borderAnsi}├`);
		expect(result[0] ?? "").toContain(`${borderAnsi}┤`);
		const bottom = result[result.length - 1] ?? "";
		expect(bottom).toContain(`${borderAnsi}╰`);
		expect(bottom).toContain(`${borderAnsi}╯`);
	});

	it("renders pending and error states", () => {
		const pending = renderBoxedToolCall(theme, "Tool", ["detail"], { isPending: true }).render(80);
		expect(pending.join("\n")).toContain("Waiting for output");
		const error = renderBoxedToolResult(theme, () => ["boom"], { isError: true }).render(80);
		expect(error.join("\n")).toContain("✗ Error");
		assertFit(pending, 80);
		assertFit(error, 80);
	});
});
