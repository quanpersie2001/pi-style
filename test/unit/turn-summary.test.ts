// Turn summary registry contracts (ADR 0007).
//
// One summary group = one agent run (user request → `agent_end`). The live
// path appends each assistant message's tool batch via
// `registerTurnFromMessage` and finalizes at `finishAgentRun`; the restore
// path (`rebuildTurnRegistryFromEntries`) rebuilds from session entries so
// scroll-back and session resume render identically. A run is ended only when
// every tool call has a result and the run is complete; error members are
// flagged but never summarized.

import { afterEach, describe, expect, it } from "vitest";
import { setToolsRenderConfig } from "../../extension-src/pi-style/features/tools/boxed/session-config.js";
import {
	beginAgentRun,
	finishAgentRun,
	getTurnEntry,
	noteTurnMemberElapsed,
	rebuildTurnRegistryFromEntries,
	registerTurnFromMessage,
	resetTurnRegistry,
	turnSummaryParts,
} from "../../extension-src/pi-style/features/tools/boxed/turn-summary.js";

function toolCall(id: string, name = "read"): { type: "toolCall"; id: string; name: string; arguments: object } {
	return { type: "toolCall", id, name, arguments: {} };
}

function result(id: string, isError = false): { toolCallId: string; isError: boolean } {
	return { toolCallId: id, isError };
}

function message(calls: readonly ReturnType<typeof toolCall>[], stopReason?: string) {
	return { role: "assistant", content: calls, ...(stopReason ? { stopReason } : {}) };
}

function toolResultEntry(id: string, isError = false) {
	return { type: "message", message: { role: "toolResult", toolCallId: id, isError } };
}

function entry(message: unknown) {
	return { type: "message", message };
}

afterEach(() => {
	resetTurnRegistry();
});

/** Run the live path end-to-end: one agent run with the given message batches. */
function completedRun(
	batches: Array<{ calls: readonly ReturnType<typeof toolCall>[]; results: readonly ReturnType<typeof result>[] }>,
) {
	beginAgentRun();
	for (const batch of batches) registerTurnFromMessage(message(batch.calls), batch.results);
	const run = finishAgentRun();
	if (!run) throw new Error("expected a completed run");
	return run;
}

describe("registerTurnFromMessage + finishAgentRun (live path)", () => {
	it("groups tool batches of one run and marks it ended when complete", () => {
		const run = completedRun([
			{ calls: [toolCall("r1", "read")], results: [result("r1")] },
			{ calls: [toolCall("b1", "bash"), toolCall("b2", "bash")], results: [result("b1"), result("b2")] },
		]);
		expect(run?.ended).toBe(true);
		expect(run?.members.map((m) => m.toolName)).toEqual(["read", "bash", "bash"]);
		expect(run?.leaderId).toBe("r1");
	});

	it("keeps an interrupted run expanded when a tool call lacks a result", () => {
		beginAgentRun();
		registerTurnFromMessage(message([toolCall("r1", "read"), toolCall("b1", "bash")]), [result("r1")]);
		expect(finishAgentRun()).toBeUndefined();
	});

	it("returns undefined for runs without tool calls", () => {
		beginAgentRun();
		registerTurnFromMessage(message([]), []);
		registerTurnFromMessage({ role: "assistant", content: [{ type: "text", text: "hi" }] }, []);
		expect(finishAgentRun()).toBeUndefined();
		beginAgentRun();
		expect(finishAgentRun()).toBeUndefined();
	});

	it("flags error results; the leader is the first non-error member", () => {
		const run = completedRun([
			{
				calls: [toolCall("b1", "bash"), toolCall("r1", "read"), toolCall("b2", "bash")],
				results: [result("b1", true), result("r1"), result("b2")],
			},
		]);
		expect(run?.ended).toBe(true);
		expect(run?.leaderId).toBe("r1");
		expect(run?.members.find((m) => m.toolCallId === "b1")?.isError).toBe(true);
	});

	it("skips mutating members when picking the leader", () => {
		const run = completedRun([
			{
				calls: [toolCall("e", "edit"), toolCall("w", "write"), toolCall("r", "read")],
				results: [result("e"), result("w"), result("r")],
			},
		]);
		expect(run?.ended).toBe(true);
		expect(run?.leaderId).toBe("r");
	});

	it("an all-mutating run is ended but has no leader and collapses nothing", () => {
		const run = completedRun([
			{
				calls: [toolCall("e", "edit"), toolCall("w", "write")],
				results: [result("e"), result("w")],
			},
		]);
		expect(run?.ended).toBe(true);
		expect(run?.leaderId).toBe("");
		expect(turnSummaryParts(run).parts).toEqual([]);
	});

	it("a mutating leader stays in the live-path registry", () => {
		const run = completedRun([
			{ calls: [toolCall("e", "edit"), toolCall("r", "read")], results: [result("e"), result("r")] },
		]);
		expect(run?.leaderId).toBe("r");
		expect(getTurnEntry("e")?.member.toolName).toBe("edit");
	});

	it("collapseMutatingTools on makes the first member the leader and includes mutating counts", () => {
		setToolsRenderConfig({ collapseAfterTurn: true, collapseMutatingTools: true });
		try {
			const run = completedRun([
				{ calls: [toolCall("e", "edit"), toolCall("r", "read")], results: [result("e"), result("r")] },
			]);
			expect(run?.leaderId).toBe("e");
			expect(turnSummaryParts(run).parts).toEqual(["Edited 1 file", "Read 1 file"]);
		} finally {
			setToolsRenderConfig({ collapseAfterTurn: true, collapseMutatingTools: false });
		}
	});

	it("registers every member id for renderer lookup", () => {
		const run = completedRun([
			{ calls: [toolCall("a", "read"), toolCall("b", "bash")], results: [result("a"), result("b")] },
		]);
		expect(run).toBeDefined();
		expect(getTurnEntry("a")?.turn.ended).toBe(true);
		expect(getTurnEntry("b")?.turn).toBe(getTurnEntry("a")?.turn);
		expect(getTurnEntry("nope")).toBeUndefined();
	});

	it("a new run replaces the previous one", () => {
		const first = completedRun([{ calls: [toolCall("a", "read")], results: [result("a")] }]);
		expect(first?.ended).toBe(true);
		const second = completedRun([{ calls: [toolCall("b", "bash")], results: [result("b")] }]);
		expect(second?.members.map((m) => m.toolCallId)).toEqual(["b"]);
		expect(getTurnEntry("a")?.turn.ended).toBe(true);
	});
});

describe("rebuildTurnRegistryFromEntries (restore path)", () => {
	it("groups consecutive assistant messages into one run; ended via stopReason or a later user message", () => {
		const entries = [
			entry({ role: "user", content: "do it" }),
			entry(message([toolCall("a", "read")], "toolUse")),
			toolResultEntry("a"),
			entry(message([toolCall("b", "bash")], "stop")),
			toolResultEntry("b"),
			entry({ role: "user", content: "next" }),
		];
		rebuildTurnRegistryFromEntries(entries);
		expect(getTurnEntry("a")?.turn.ended).toBe(true);
		expect(getTurnEntry("b")?.turn).toBe(getTurnEntry("a")?.turn);
		expect(getTurnEntry("b")?.turn.members).toHaveLength(2);
	});

	it("keeps the streaming last run expanded (no stopReason, nothing after)", () => {
		const entries = [
			entry(message([toolCall("a", "read")], "toolUse")),
			toolResultEntry("a"),
			entry(message([toolCall("b", "bash")])),
		];
		rebuildTurnRegistryFromEntries(entries);
		expect(getTurnEntry("a")?.turn.ended).toBe(false);
		expect(getTurnEntry("b")?.turn.ended).toBe(false);
	});

	it("keeps runs with missing results expanded even with stopReason", () => {
		const entries = [entry(message([toolCall("a", "bash"), toolCall("b", "bash")], "toolUse")), toolResultEntry("a")];
		rebuildTurnRegistryFromEntries(entries);
		expect(getTurnEntry("a")?.turn.ended).toBe(false);
		expect(getTurnEntry("b")?.turn.ended).toBe(false);
	});

	it("clears the registry before rebuilding", () => {
		beginAgentRun();
		registerTurnFromMessage(message([toolCall("a", "read")]), [result("a")]);
		finishAgentRun();
		rebuildTurnRegistryFromEntries([]);
		expect(getTurnEntry("a")).toBeUndefined();
	});

	it("derives error flags from toolResult entries", () => {
		const entries = [entry(message([toolCall("a", "bash")], "stop")), toolResultEntry("a", true)];
		rebuildTurnRegistryFromEntries(entries);
		expect(getTurnEntry("a")?.member.isError).toBe(true);
	});

	it("ignores non-message entries and toolResult entries without an owner", () => {
		const entries = [
			{ type: "branch_summary", summary: "x" },
			toolResultEntry("orphan"),
			entry({ role: "user", content: "only a question" }),
		];
		rebuildTurnRegistryFromEntries(entries);
		expect(getTurnEntry("orphan")).toBeUndefined();
	});

	it("splits runs at user message boundaries", () => {
		const entries = [
			entry({ role: "user", content: "one" }),
			entry(message([toolCall("a", "read")], "stop")),
			toolResultEntry("a"),
			entry({ role: "user", content: "two" }),
			entry(message([toolCall("b", "bash")], "stop")),
			toolResultEntry("b"),
		];
		rebuildTurnRegistryFromEntries(entries);
		expect(getTurnEntry("a")?.turn).not.toBe(getTurnEntry("b")?.turn);
	});

	it("skips mutating members when picking the leader on restore", () => {
		const entries = [
			entry({ role: "user", content: "fix it" }),
			entry(message([toolCall("e", "edit"), toolCall("r", "read")], "stop")),
			toolResultEntry("e"),
			toolResultEntry("r"),
		];
		rebuildTurnRegistryFromEntries(entries);
		expect(getTurnEntry("r")?.turn.leaderId).toBe("r");
		expect(getTurnEntry("r")?.turn.ended).toBe(true);
	});
});

describe("turnSummaryParts", () => {
	it("aggregates per-tool counts across batches in first-use order with plural units", () => {
		const run = completedRun([
			{ calls: [toolCall("a", "read"), toolCall("b", "bash")], results: [result("a"), result("b")] },
			{ calls: [toolCall("c", "bash"), toolCall("d", "read")], results: [result("c"), result("d")] },
		]);
		const parts = turnSummaryParts(run);
		expect(parts.parts).toEqual(["Read 2 files", "ran 2 shell commands"]);
		expect(parts.failedCount).toBe(0);
		expect(parts.elapsedMs).toBeUndefined();
	});

	it("counts errors separately and excludes them from the parts", () => {
		const run = completedRun([
			{ calls: [toolCall("a", "read"), toolCall("b", "bash")], results: [result("a"), result("b", true)] },
		]);
		const parts = turnSummaryParts(run);
		expect(parts.parts).toEqual(["Read 1 file"]);
		expect(parts.failedCount).toBe(1);
	});

	it("tracks the failed count across all-error members", () => {
		const run = completedRun([
			{
				calls: [toolCall("a", "read"), toolCall("b", "bash"), toolCall("c", "bash")],
				results: [result("a", true), result("b", true), result("c", true)],
			},
		]);
		const parts = turnSummaryParts(run);
		expect(parts.failedCount).toBe(3);
		expect(parts.parts).toEqual([]);
	});

	it("sums frozen member elapsed; first write wins", () => {
		const run = completedRun([
			{ calls: [toolCall("a", "read"), toolCall("b", "bash")], results: [result("a"), result("b")] },
		]);
		noteTurnMemberElapsed("a", 100);
		noteTurnMemberElapsed("b", 250);
		noteTurnMemberElapsed("a", 999);
		expect(turnSummaryParts(run).elapsedMs).toBe(350);
	});

	it("stays undefined when no member recorded elapsed", () => {
		const run = completedRun([{ calls: [toolCall("a", "read")], results: [result("a")] }]);
		noteTurnMemberElapsed("a", undefined);
		expect(turnSummaryParts(run).elapsedMs).toBeUndefined();
	});

	it("pluralizes units", () => {
		const run = completedRun([
			{
				calls: [toolCall("a", "ls"), toolCall("b", "ls"), toolCall("c", "grep")],
				results: [result("a"), result("b"), result("c")],
			},
		]);
		expect(turnSummaryParts(run).parts).toEqual(["Listed 2 paths", "Grepped 1 pattern"]);
	});

	it("excludes mutating tools from parts, counts, and elapsed", () => {
		const run = completedRun([
			{
				calls: [toolCall("a", "read"), toolCall("e", "edit"), toolCall("w", "write")],
				results: [result("a"), result("e"), result("w")],
			},
		]);
		noteTurnMemberElapsed("a", 100);
		noteTurnMemberElapsed("e", 500);
		noteTurnMemberElapsed("w", 900);
		const parts = turnSummaryParts(run);
		expect(parts.parts).toEqual(["Read 1 file"]);
		expect(parts.elapsedMs).toBe(100);
	});

	it("covers every mutating alias", () => {
		const run = completedRun([
			{
				calls: [
					toolCall("a", "quick_edit"),
					toolCall("b", "substitute_edit"),
					toolCall("c", "target_edit"),
					toolCall("d", "edit"),
					toolCall("e", "write"),
					toolCall("f", "bash"),
				],
				results: [result("a"), result("b"), result("c"), result("d"), result("e"), result("f")],
			},
		]);
		expect(turnSummaryParts(run).parts).toEqual(["ran 1 shell command"]);
	});

	it("falls back to neutral phrasing for unknown tools", () => {
		const run = completedRun([
			{ calls: [toolCall("a", "gh"), toolCall("b", "gh")], results: [result("a"), result("b")] },
		]);
		expect(turnSummaryParts(run).parts).toEqual(["used 2 gh"]);
	});
});
