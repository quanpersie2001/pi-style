// Turn summary rendering contracts (ADR 0007).
//
// Through the boxed dispatcher: when the turn is ended and Pi's tool-output
// state is collapsed, the leader renders the summary line and members render
// zero lines (EMPTY_BATCH_COMPONENT so the decoration hides them). Errors stay
// visible, Pi's `expanded` flag and `tools.collapseAfterTurn: "off"` disable
// the collapse, and the summary is width-truncated.

import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_BATCH_COMPONENT, resetBatchRegistry } from "../../extension-src/pi-style/features/tools/boxed/batch.js";
import {
	renderBoxedToolCall as dispatchCall,
	renderBoxedToolResult as dispatchResult,
} from "../../extension-src/pi-style/features/tools/boxed/index.js";
import { setToolsRenderConfig } from "../../extension-src/pi-style/features/tools/boxed/session-config.js";
import type { BoxedToolContext } from "../../extension-src/pi-style/features/tools/boxed/shared.js";
import {
	beginAgentRun,
	finishAgentRun,
	invalidateTurnMembers,
	noteTurnMemberElapsed,
	registerTurnFromMessage,
	resetTurnRegistry,
} from "../../extension-src/pi-style/features/tools/boxed/turn-summary.js";
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

function toolCall(id: string, name = "read"): { type: "toolCall"; id: string; name: string; arguments: object } {
	return { type: "toolCall", id, name, arguments: {} };
}

function result(id: string, isError = false): { toolCallId: string; isError: boolean } {
	return { toolCallId: id, isError };
}

function message(calls: readonly ReturnType<typeof toolCall>[]) {
	return { role: "assistant", content: calls };
}

function completedTurn(calls: readonly ReturnType<typeof toolCall>[]) {
	beginAgentRun();
	registerTurnFromMessage(
		message(calls),
		calls.map((call) => result(call.id)),
	);
	return finishAgentRun();
}

const emptyResult = { content: [] as readonly unknown[], details: {} };

afterEach(() => {
	resetTurnRegistry();
	resetBatchRegistry();
	setToolsRenderConfig({ collapseAfterTurn: true, collapseMutatingTools: false });
});

describe("turn summary through the boxed dispatcher", () => {
	it("leader renders the summary line; members render zero lines", () => {
		completedTurn([toolCall("r1", "read"), toolCall("b1", "bash"), toolCall("b2", "bash")]);

		const leader = dispatchCall("read", { path: "a.ts" }, theme, context({ toolCallId: "r1", args: { path: "a.ts" } }));
		const lines = leader.render(80);
		expect(stripAnsi(lines.join("\n"))).toContain("Read 1 file, ran 2 shell commands");
		expect(lines.length).toBe(1);

		for (const memberId of ["b1", "b2"]) {
			const memberCall = dispatchCall("bash", { command: "ls" }, theme, context({ toolCallId: memberId }));
			expect(memberCall).toBe(EMPTY_BATCH_COMPONENT);
			expect(memberCall.render(80)).toEqual([]);
			const memberResult = dispatchResult(
				"bash",
				emptyResult,
				{ expanded: false, isPartial: false },
				theme,
				context({ toolCallId: memberId }),
			);
			expect(memberResult).toBe(EMPTY_BATCH_COMPONENT);
		}
	});

	it("leader result renders an empty non-singleton component", () => {
		completedTurn([toolCall("r1", "read")]);
		const leaderResult = dispatchResult(
			"read",
			emptyResult,
			{ expanded: false, isPartial: false },
			theme,
			context({ toolCallId: "r1" }),
		);
		expect(leaderResult).not.toBe(EMPTY_BATCH_COMPONENT);
		expect(leaderResult.render(80)).toEqual([]);
	});

	it("Pi's expanded state disables the collapse for every block", () => {
		completedTurn([toolCall("r1", "read"), toolCall("b1", "bash")]);
		const memberCall = dispatchCall("bash", { command: "ls" }, theme, context({ toolCallId: "b1", expanded: true }));
		expect(memberCall).not.toBe(EMPTY_BATCH_COMPONENT);
		expect(stripAnsi(memberCall.render(80).join("\n"))).not.toContain("shell commands");
	});

	it("collapseAfterTurn off disables the collapse", () => {
		completedTurn([toolCall("r1", "read"), toolCall("b1", "bash")]);
		setToolsRenderConfig({ collapseAfterTurn: false });
		const memberCall = dispatchCall("bash", { command: "ls" }, theme, context({ toolCallId: "b1" }));
		expect(memberCall).not.toBe(EMPTY_BATCH_COMPONENT);
		const leader = dispatchCall("read", { path: "a.ts" }, theme, context({ toolCallId: "r1" }));
		expect(stripAnsi(leader.render(80).join("\n"))).not.toContain("files");
	});

	it("an unended turn renders normally (no summary, no zero-line members)", () => {
		beginAgentRun();
		registerTurnFromMessage(message([toolCall("r1", "read"), toolCall("b1", "bash")]), [result("r1")]);
		const memberCall = dispatchCall("bash", { command: "ls" }, theme, context({ toolCallId: "b1" }));
		expect(memberCall).not.toBe(EMPTY_BATCH_COMPONENT);
	});

	it("error members stay visible even when the turn ended", () => {
		beginAgentRun();
		registerTurnFromMessage(message([toolCall("r1", "read"), toolCall("b1", "bash")]), [
			result("r1"),
			result("b1", true),
		]);
		finishAgentRun();
		const errorResult = dispatchResult(
			"bash",
			emptyResult,
			{ expanded: false, isPartial: false },
			theme,
			context({ toolCallId: "b1", isError: true }),
		);
		expect(errorResult).not.toBe(EMPTY_BATCH_COMPONENT);
		// Leader still summarizes the non-error members.
		const leader = dispatchCall("read", { path: "a.ts" }, theme, context({ toolCallId: "r1" }));
		expect(stripAnsi(leader.render(80).join("\n"))).toContain("Read 1 file");
	});

	it("summary carries the failed marker and total elapsed", () => {
		beginAgentRun();
		registerTurnFromMessage(message([toolCall("r1", "read"), toolCall("b1", "bash")]), [
			result("r1"),
			result("b1", true),
		]);
		finishAgentRun();
		noteTurnMemberElapsed("r1", 50);
		const leader = dispatchCall("read", { path: "a.ts" }, theme, context({ toolCallId: "r1" }));
		const line = stripAnsi(leader.render(80)[0]);
		expect(line).toContain("· 1 failed");
		expect(line).toContain("· 0.05s");
	});

	it("truncates the summary at narrow widths", () => {
		completedTurn([toolCall("r1", "read"), toolCall("b1", "bash")]);
		const leader = dispatchCall("read", { path: "a.ts" }, theme, context({ toolCallId: "r1" }));
		const lines = leader.render(24);
		expectLinesFit(lines, 24);
	});

	it("turn_end invalidates the captured member components (live collapse path)", () => {
		const invalidated: string[] = [];
		const ctxFor = (id: string) => context({ toolCallId: id, invalidate: () => invalidated.push(id) });
		// Blocks render while the run is live: the dispatcher captures the
		// component invalidate callbacks.
		dispatchCall("read", { path: "a.ts" }, theme, ctxFor("r1"));
		dispatchCall("bash", { command: "ls" }, theme, ctxFor("b1"));
		dispatchResult("bash", emptyResult, { expanded: false, isPartial: false }, theme, ctxFor("b1"));

		beginAgentRun();
		registerTurnFromMessage(message([toolCall("r1", "read"), toolCall("b1", "bash")]), [result("r1"), result("b1")]);
		const turn = finishAgentRun();
		if (!turn) throw new Error("expected a run");
		invalidateTurnMembers(turn);
		expect(invalidated.sort()).toEqual(["b1", "r1"]);

		// The next render pass of the invalidated blocks collapses them.
		const leader = dispatchCall("read", { path: "a.ts" }, theme, ctxFor("r1"));
		expect(stripAnsi(leader.render(80).join("\n"))).toContain("Read 1 file, ran 1 shell command");
	});

	describe("mutating tools stay visible (tools.collapseMutatingTools off)", () => {
		it("edit/write blocks render their own box beside the summary; read-only members collapse", () => {
			completedTurn([toolCall("e1", "edit"), toolCall("r1", "read"), toolCall("w1", "write")]);

			// The leader is the first non-mutating member, not the first call.
			const leader = dispatchCall("read", { path: "a.ts" }, theme, context({ toolCallId: "r1" }));
			const lines = leader.render(80);
			expect(stripAnsi(lines.join("\n"))).toContain("Read 1 file");
			expect(lines.length).toBe(1);
			// The summary describes only what it hides: no edit/write counts.
			expect(stripAnsi(lines.join("\n"))).not.toContain("Edited");
			expect(stripAnsi(lines.join("\n"))).not.toContain("Wrote");

			// Mutating members render their normal (non-summary) components.
			const editCall = dispatchCall("edit", { filePath: "/fake/a.ts" }, theme, context({ toolCallId: "e1" }));
			expect(editCall).not.toBe(EMPTY_BATCH_COMPONENT);
			expect(editCall.render(80).length).toBeGreaterThan(0);
			const writeCall = dispatchCall(
				"write",
				{ path: "/fake/b.ts", content: "hi" },
				theme,
				context({ toolCallId: "w1" }),
			);
			expect(writeCall).not.toBe(EMPTY_BATCH_COMPONENT);
			expect(writeCall.render(80).length).toBeGreaterThan(0);
			// Success results add nothing (the call preview closes the box);
			// the important contract is they are not the zero-line batch singleton.
			const writeResult = dispatchResult(
				"write",
				{ content: [{ type: "text", text: "hi" }], details: { path: "/fake/b.ts" } },
				{ expanded: false, isPartial: false },
				theme,
				context({ toolCallId: "w1" }),
			);
			expect(writeResult).not.toBe(EMPTY_BATCH_COMPONENT);
			expect(writeResult.render(80)).toEqual([]);
		});

		it("an all-mutating turn collapses nothing", () => {
			completedTurn([toolCall("e1", "edit"), toolCall("w1", "write")]);
			const editCall = dispatchCall("edit", { filePath: "/fake/a.ts" }, theme, context({ toolCallId: "e1" }));
			expect(editCall).not.toBe(EMPTY_BATCH_COMPONENT);
			expect(editCall.render(80).length).toBeGreaterThan(0);
		});

		it("collapseMutatingTools on restores the full collapse (edit joins the summary)", () => {
			setToolsRenderConfig({ collapseAfterTurn: true, collapseMutatingTools: true });
			completedTurn([toolCall("e1", "edit"), toolCall("r1", "read")]);
			// With the leaf on the leader is the first non-error member (v1 parity).
			const leader = dispatchCall("edit", { filePath: "/fake/a.ts" }, theme, context({ toolCallId: "e1" }));
			expect(stripAnsi(leader.render(80).join("\n"))).toContain("Edited 1 file, Read 1 file");
			const readCall = dispatchCall("read", { path: "a.ts" }, theme, context({ toolCallId: "r1" }));
			expect(readCall).toBe(EMPTY_BATCH_COMPONENT);
		});
	});
});
