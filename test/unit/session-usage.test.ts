import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { usageFromSession } from "../../extension-src/pi-style/pi/session-usage.js";

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
function assistant(message: Record<string, unknown>): SessionEntry {
	return {
		type: "message",
		id: "a",
		parentId: null,
		timestamp: "t",
		message: { role: "assistant", ...message },
	} as SessionEntry;
}
function toolResult(message: Record<string, unknown>): SessionEntry {
	return {
		type: "message",
		id: "t",
		parentId: null,
		timestamp: "t",
		message: { role: "toolResult", ...message },
	} as SessionEntry;
}
function user(): SessionEntry {
	return { type: "message", id: "u", parentId: null, timestamp: "t", message: { role: "user" } } as SessionEntry;
}
function compaction(entry: Record<string, unknown>): SessionEntry {
	return { type: "compaction", id: "c", parentId: null, timestamp: "t", ...entry } as SessionEntry;
}

describe("session usage aggregation", () => {
	it("sums tokens and cost from assistant, toolResult, and compaction entries", () => {
		const session = {
			getEntries: () => [
				user(),
				assistant({ usage: usage({ input: 100, output: 200, cacheRead: 10, cacheWrite: 5, cost: 0.01 }) }),
				toolResult({ usage: usage({ output: 50, cost: 0.005 }) }),
				compaction({ usage: usage({ output: 30, cost: 0.001 }) }),
			],
		};
		expect(usageFromSession(session)).toEqual({
			inputTokens: 100,
			outputTokens: 280,
			cacheReadTokens: 10,
			cacheWriteTokens: 5,
			cost: 0.016,
			subscriptionMode: "unknown",
			streaming: false,
		});
	});

	it("returns undefined when no entry carries usage", () => {
		const session = { getEntries: () => [user(), assistant({}), compaction({})] };
		expect(usageFromSession(session)).toBeUndefined();
	});
});
