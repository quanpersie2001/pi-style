import { afterEach, describe, expect, it } from "vitest";
import { closeActiveBatch, resetBatchRegistry } from "../../extension-src/pi-style/features/tools/boxed/batch.js";
import {
	renderBoxedToolCall as dispatchCall,
	renderBoxedToolResult as dispatchResult,
} from "../../extension-src/pi-style/features/tools/boxed/index.js";
import type { BoxedToolContext } from "../../extension-src/pi-style/features/tools/boxed/shared.js";
import { stripAnsi } from "../../extension-src/pi-style/shared/ansi.js";
import { createFakeTheme } from "../helpers/fake-theme.js";
import { expectLinesFit } from "../helpers/render-assertions.js";

const theme = createFakeTheme();

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

function textResult(text: string) {
	return { content: [{ type: "text", text }], details: {} };
}

function readCall(path: string, id: string, extra: Partial<BoxedToolContext> = {}) {
	const ctx = context({ toolCallId: id, args: { path }, cwd: "/fake", ...extra });
	return { ctx, component: dispatchCall("read", { path }, theme, ctx) };
}

function readResult(id: string, path: string, text: string, extra: Partial<BoxedToolContext> = {}) {
	const ctx = context({ toolCallId: id, args: { path }, cwd: "/fake", ...extra });
	return {
		ctx,
		component: dispatchResult("read", textResult(text), { expanded: false, isPartial: false }, theme, ctx),
	};
}

function plain(lines: readonly string[]): string[] {
	return lines.map((line) => stripAnsi(line));
}

afterEach(() => {
	resetBatchRegistry();
});

describe("batch grouping for quiet tools", () => {
	it("groups consecutive reads into one panel; members render zero lines", () => {
		const r1 = readCall("a.ts", "r1");
		const r2 = readCall("b.ts", "r2");

		// Non-leader member renders nothing at all widths.
		for (const width of [40, 80, 120]) {
			expect(r2.component.render(width)).toEqual([]);
		}

		const lines = r1.component.render(80);
		const joined = plain(lines).join("\n");
		expect(joined).toContain("Read (2)");
		expect(joined).toContain("a.ts");
		expect(joined).toContain("b.ts");
		expectLinesFit(lines, 80);
	});

	it("a lone read renders the same boxless tree panel", () => {
		const r1 = readCall("a.ts", "r1");
		const pending = plain(r1.component.render(80)).join("\n");
		expect(pending).toContain("➔ Read (1)");
		expect(pending).toContain("└─ ◌ a.ts");
		expect(pending).not.toContain("╭");
		expect(pending).not.toContain("Path:");
		// After the result: done header + path, still boxless.
		readResult("r1", "a.ts", "hello world");
		const done = plain(r1.component.render(80)).join("\n");
		expect(done).toContain("● Read (1)");
		expect(done).toContain("└─ a.ts");
		expect(done).not.toContain("╭");
	});

	it("tracks progress and completes with a ✓ summary and word totals", () => {
		const r1 = readCall("a.ts", "r1");
		readCall("b.ts", "r2");

		// Leader result arrives first: running state with progress.
		const r1Result = readResult("r1", "a.ts", "hello world");
		expect(r1Result.component.render(80)).toEqual([]); // panel lives in the call component
		let joined = plain(r1.component.render(80)).join("\n");
		expect(joined).toContain("Read (2)");
		expect(joined).toContain("1/2");
		expect(joined).toContain("a.ts");
		expect(joined).toContain("b.ts");

		// Second member completes: done state, tree stays open.
		readResult("r2", "b.ts", "some more words here");
		joined = plain(r1.component.render(80)).join("\n");
		expect(joined).toContain("● Read (2)");
		// Elapsed is real wall time (performance.now), so only the format is asserted.
		expect(joined).toMatch(/● Read \(2\) · \d+\.\d{2}s/);
		expect(joined).toContain("├─ a.ts"); // tree kept open after completion
		expect(joined).toContain("└─ b.ts");
	});

	it("keeps the tree open in every state (no collapsed summary)", () => {
		const r1 = readCall("a.ts", "r1");
		readCall("b.ts", "r2");
		readResult("r1", "one");
		readResult("r2", "two");
		const joined = plain(r1.component.render(80)).join("\n");
		expect(joined).toContain("● Read (2)");
		expect(joined).toContain("├─ a.ts");
		expect(joined).toContain("└─ b.ts");
	});

	it("renders the member tree with no word-count metadata", () => {
		const r1 = readCall("a.ts", "r1");
		readCall("b.ts", "r2");
		readResult("r1", "a.ts", "hello world");
		readResult("r2", "b.ts", "short");
		const joined = plain(r1.component.render(80)).join("\n");
		expect(joined).toContain("● Read (2)");
		expect(joined).toContain("├─ a.ts");
		expect(joined).toContain("└─ b.ts");
		expect(joined).not.toContain("words");
	});

	it("colors successful reads with the primary (accent) color and failures red", () => {
		const rich = createFakeTheme({ colors: { accent: "#8abeb7", error: "#ff4444" } });
		const c1 = context({ toolCallId: "r1", args: { path: "a.ts" }, cwd: "/fake" });
		const leader = dispatchCall("read", { path: "a.ts" }, rich, c1);
		dispatchCall("read", { path: "b.ts" }, rich, context({ toolCallId: "r2", args: { path: "b.ts" }, cwd: "/fake" }));
		dispatchResult(
			"read",
			textResult("ok"),
			{ expanded: false, isPartial: false },
			rich,
			context({ toolCallId: "r1", args: { path: "a.ts" }, cwd: "/fake" }),
		);
		dispatchResult(
			"read",
			textResult("denied"),
			{ expanded: false, isPartial: false },
			rich,
			context({ toolCallId: "r2", args: { path: "b.ts" }, cwd: "/fake", isError: true }),
		);
		const raw = leader.render(80).join("\n");
		expect(raw).toContain("\x1b[38;2;138;190;183m"); // accent = primary for the ok file
		expect(raw).toContain("\x1b[38;2;255;68;68m"); // error red for the failed file
	});

	it("caps the tree at 5 members with a 'N more' line", () => {
		const first = readCall("f1.ts", "r1");
		for (let i = 2; i <= 7; i++) readCall(`f${i}.ts`, `r${i}`);
		const joined = plain(first.component.render(80)).join("\n");
		expect(joined).toContain("Read (7)");
		expect(joined.match(/├─|└─/g) ?? []).toHaveLength(6); // 5 members + "2 more"
		expect(joined).toContain("2 more");
		expect(joined).not.toContain("f6.ts");
	});

	it("keeps failed members visible with their error text, even collapsed", () => {
		const r1 = readCall("a.ts", "r1");
		readCall("b.ts", "r2");
		readResult("r1", "a.ts", "ok words here");
		const failed = readResult("r2", "b.ts", "Permission denied", { isError: true });

		// Leader result for the failed member is the batch panel leader rendering nothing.
		expect(failed.component.render(80)).toEqual([]);
		const joined = plain(r1.component.render(80)).join("\n");
		expect(joined).toContain("✗ Read (2) · 1 failed");
		expect(joined).toContain("✗ b.ts");
		expect(joined).toContain("Permission denied");
		expect(joined).toContain("1 failed");
		expectLinesFit(r1.component.render(80), 80);
	});

	it("renders the success header for a batch where all members settled", () => {
		const r1 = readCall("a.ts", "r1");
		readCall("b.ts", "r2");
		readResult("r1", "a.ts", "x");
		readResult("r2", "b.ts", "y");
		const joined = plain(r1.component.render(80)).join("\n");
		expect(joined).toMatch(/● Read \(2\) · \d+\.\d{2}s/);
	});

	it("a non-batchable tool dispatch closes the batch", () => {
		readCall("a.ts", "r1");
		readCall("b.ts", "r2");
		dispatchCall("bash", { command: "ls" }, theme, context({ toolCallId: "bash1" }));
		// A later read starts a fresh single-member batch (own tree panel).
		const r3 = readCall("c.ts", "r3");
		const lines = plain(r3.component.render(80)).join("\n");
		expect(lines).toContain("Read (1)");
		expect(lines).toContain("c.ts");
	});

	it("closeActiveBatch prevents further joins but keeps the panel rendering", () => {
		const r1 = readCall("a.ts", "r1");
		readCall("b.ts", "r2");
		closeActiveBatch();
		readCall("c.ts", "r3");
		const joined = plain(r1.component.render(80)).join("\n");
		expect(joined).toContain("Read (2)");
		expect(joined).not.toContain("c.ts");
	});

	it("groups consecutive ls calls under the List label", () => {
		const l1 = context({ toolCallId: "l1", args: { path: "src" }, cwd: "/fake", expanded: true });
		const l2 = context({ toolCallId: "l2", args: { path: "test" }, cwd: "/fake", expanded: true });
		const leaderCall = dispatchCall("ls", { path: "src" }, theme, l1);
		dispatchCall("ls", { path: "test" }, theme, l2);
		dispatchResult("ls", textResult("index.ts\nmain.ts"), { expanded: true, isPartial: false }, theme, l1);
		dispatchResult("ls", textResult("spec.ts"), { expanded: true, isPartial: false }, theme, l2);
		const joined = plain(leaderCall.render(80)).join("\n");
		expect(joined).toContain("● List (2)");
		expect(joined).toContain("src");
		expect(joined).toContain("test");
	});

	it("mixes different batchable tools into separate batches", () => {
		const r1 = readCall("a.ts", "r1");
		const l1 = context({ toolCallId: "l1", args: { path: "src" }, cwd: "/fake" });
		const lsCall = dispatchCall("ls", { path: "src" }, theme, l1);
		const r2 = readCall("b.ts", "r2");
		// The read between/before ls forms its own single batch; the ls is separate.
		const joinedLs = plain(lsCall.component?.render?.(80) ?? lsCall.render(80)).join("\n");
		expect(joinedLs).toContain("List");
		const joinedR1 = plain(r1.component.render(80)).join("\n");
		expect(joinedR1).not.toContain("List");
		expect(plain(r2.component.render(80)).join("\n")).toContain("b.ts");
	});
});
