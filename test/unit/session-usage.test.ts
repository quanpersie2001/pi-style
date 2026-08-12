import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it } from "vitest";
import {
	getUsageFromSessionCacheStats,
	resetUsageFromSessionCache,
	usageFromSession,
} from "../../extension-src/pi-style/pi/session-usage.js";

function usage(
	overrides: Partial<{ input: number; output: number; cacheRead: number; cacheWrite: number; cost: number }> = {},
) {
	return {
		input: overrides.input ?? 0,
		output: overrides.output ?? 0,
		cacheRead: overrides.cacheRead ?? 0,
		cacheWrite: overrides.cacheWrite ?? 0,
		totalTokens: (overrides.input ?? 0) + (overrides.output ?? 0),
		cost: { total: overrides.cost ?? 0 },
	};
}
function assistant(id: string, message: Record<string, unknown>): SessionEntry {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: "t",
		message: { role: "assistant", ...message },
	} as SessionEntry;
}
function toolResult(id: string, message: Record<string, unknown>): SessionEntry {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: "t",
		message: { role: "toolResult", ...message },
	} as SessionEntry;
}
function user(id = "u"): SessionEntry {
	return { type: "message", id, parentId: null, timestamp: "t", message: { role: "user" } } as SessionEntry;
}
function compaction(id: string, entry: Record<string, unknown>): SessionEntry {
	return { type: "compaction", id, parentId: null, timestamp: "t", ...entry } as SessionEntry;
}
function branchSummary(id: string, entry: Record<string, unknown>): SessionEntry {
	return {
		type: "branch_summary",
		id,
		parentId: null,
		timestamp: "t",
		fromId: "u",
		summary: "x",
		...entry,
	} as SessionEntry;
}

class MutableSession {
	entries: SessionEntry[];
	constructor(entries: SessionEntry[]) {
		this.entries = entries;
	}
	getEntries(): readonly SessionEntry[] {
		return this.entries;
	}
}

describe("session usage aggregation", () => {
	beforeEach(() => resetUsageFromSessionCache());

	it("sums tokens and cost from assistant, toolResult, branch summary, and compaction entries", () => {
		const session = new MutableSession([
			user(),
			assistant("a", { usage: usage({ input: 100, output: 200, cacheRead: 10, cacheWrite: 5, cost: 0.01 }) }),
			toolResult("t", { usage: usage({ output: 50, cost: 0.005 }) }),
			branchSummary("b", { usage: usage({ input: 20, output: 10, cost: 0.002 }) }),
			compaction("c", { usage: usage({ output: 30, cost: 0.001 }) }),
		]);
		expect(usageFromSession(session)).toEqual({
			inputTokens: 120,
			outputTokens: 290,
			cacheReadTokens: 10,
			cacheWriteTokens: 5,
			cost: 0.018000000000000002,
			subscriptionMode: "unknown",
			streaming: false,
		});
	});

	it("returns undefined when no entry carries usage", () => {
		const session = new MutableSession([user(), assistant("a", {}), compaction("c", {})]);
		expect(usageFromSession(session)).toBeUndefined();
	});

	it("only scans appended entries on repeated reads", () => {
		const session = new MutableSession([user("u1"), assistant("a1", { usage: usage({ input: 1, output: 2 }) })]);
		expect(usageFromSession(session)?.outputTokens).toBe(2);
		expect(getUsageFromSessionCacheStats(session)).toMatchObject({ scannedEntries: 2, rebuilds: 1, cacheHits: 0 });
		expect(usageFromSession(session)?.outputTokens).toBe(2);
		expect(getUsageFromSessionCacheStats(session)).toMatchObject({ scannedEntries: 2, rebuilds: 1, cacheHits: 1 });
		session.entries.push(toolResult("t1", { usage: usage({ output: 3 }) }));
		expect(usageFromSession(session)?.outputTokens).toBe(5);
		expect(getUsageFromSessionCacheStats(session)).toMatchObject({ scannedEntries: 3, rebuilds: 1, cacheHits: 1 });
	});

	it("refreshes the finalized tail entry without rescanning the full session", () => {
		const session = new MutableSession([user("u1"), assistant("a1", {})]);
		expect(usageFromSession(session)).toBeUndefined();
		session.entries[1] = assistant("a1", { usage: usage({ input: 7, output: 11, cost: 0.25 }) });
		expect(usageFromSession(session)).toEqual({
			inputTokens: 7,
			outputTokens: 11,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			cost: 0.25,
			subscriptionMode: "unknown",
			streaming: false,
		});
		expect(getUsageFromSessionCacheStats(session)).toMatchObject({ scannedEntries: 3, rebuilds: 1, tailRefreshes: 1 });
	});

	it("rebuilds after cache reset for branch or compaction lifecycle changes", () => {
		const session = new MutableSession([
			assistant("a1", { usage: usage({ input: 4, output: 5 }) }),
			assistant("a2", { usage: usage({ input: 6, output: 7 }) }),
		]);
		expect(usageFromSession(session)?.inputTokens).toBe(10);
		resetUsageFromSessionCache(session);
		session.entries = [assistant("b1", { usage: usage({ input: 3, output: 9 }) })];
		expect(usageFromSession(session)).toEqual({
			inputTokens: 3,
			outputTokens: 9,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			cost: 0,
			subscriptionMode: "unknown",
			streaming: false,
		});
		expect(getUsageFromSessionCacheStats(session)).toMatchObject({ processedLength: 1, rebuilds: 1 });
	});
});
