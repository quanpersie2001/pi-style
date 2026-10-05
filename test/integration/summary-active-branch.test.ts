import type { AssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetAgentThoughtRuns } from "../../extension-src/pi-style/features/messages/thought-summary.js";
import { getTurnEntry, resetTurnRegistry } from "../../extension-src/pi-style/features/tools/boxed/turn-summary.js";
import piStyleExtension from "../../extension-src/pi-style/pi/index.js";
import { FakePiHost } from "../helpers/fake-pi-host.js";

function assistant(id: string, timestamp: number): AssistantMessage {
	return {
		role: "assistant",
		content: [
			{ type: "thinking", thinking: `reason_${id}` },
			{ type: "toolCall", id, name: "read", arguments: { path: `${id}.ts` } },
		],
		api: "openai-responses",
		provider: "openai",
		model: "fixture",
		stopReason: "toolUse",
		timestamp,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
}

afterEach(() => {
	resetTurnRegistry();
	resetAgentThoughtRuns();
});

describe("summary registries follow the selected session branch", () => {
	it("uses getBranch rather than the append-only getEntries log on startup and tree switches", async () => {
		const session = SessionManager.inMemory("/fake");
		const root = session.appendMessage({ role: "user", content: "first request", timestamp: 1 });
		session.appendMessage(assistant("abandoned", 2));
		const abandonedLeaf = session.appendMessage({
			role: "toolResult",
			toolCallId: "abandoned",
			toolName: "read",
			content: [],
			isError: true,
			timestamp: 3,
		});
		session.branch(root);
		session.appendMessage({ role: "user", content: "selected request", timestamp: 4 });
		session.appendMessage(assistant("selected", 5));
		const selectedLeaf = session.appendMessage({
			role: "toolResult",
			toolCallId: "selected",
			toolName: "read",
			content: [],
			isError: false,
			timestamp: 6,
		});
		const host = new FakePiHost({ mode: "print", sessionEntries: session.getEntries() });
		const getBranch = vi.fn(() => session.getBranch());
		Object.assign(host.extensionContext.sessionManager, { getBranch });
		piStyleExtension(host.extensionApi);
		try {
			await host.sessionStart();
			expect(getBranch).toHaveBeenCalledTimes(1);
			expect(getTurnEntry("abandoned")).toBeUndefined();
			expect(getTurnEntry("selected")?.turn.members).toHaveLength(1);
			expect(getTurnEntry("selected")?.member.isError).toBe(false);

			session.branch(abandonedLeaf);
			await host.emit("session_tree", { type: "session_tree", newLeafId: abandonedLeaf, oldLeafId: selectedLeaf });
			expect(getBranch).toHaveBeenCalledTimes(2);
			expect(getTurnEntry("selected")).toBeUndefined();
			expect(getTurnEntry("abandoned")?.turn.members).toHaveLength(1);
			expect(getTurnEntry("abandoned")?.member.isError).toBe(true);
		} finally {
			await host.sessionShutdown();
		}
	});
});
