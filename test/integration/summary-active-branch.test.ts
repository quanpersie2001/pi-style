import type { AssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetAgentThoughtRuns } from "../../extension-src/pi-style/features/messages/thought-summary.js";
import {
	resetTeammateRuns,
	teammateForRun,
} from "../../extension-src/pi-style/features/tools/boxed/team-run-labels.js";
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
	resetTeammateRuns();
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
			// Both summary reconstruction and session editor-color restoration read the active branch.
			expect(getBranch).toHaveBeenCalledTimes(2);
			expect(getTurnEntry("abandoned")).toBeUndefined();
			expect(getTurnEntry("selected")?.turn.members).toHaveLength(1);
			expect(getTurnEntry("selected")?.member.isError).toBe(false);

			session.branch(abandonedLeaf);
			await host.emit("session_tree", { type: "session_tree", newLeafId: abandonedLeaf, oldLeafId: selectedLeaf });
			expect(getBranch).toHaveBeenCalledTimes(4);
			expect(getTurnEntry("selected")).toBeUndefined();
			expect(getTurnEntry("abandoned")?.turn.members).toHaveLength(1);
			expect(getTurnEntry("abandoned")?.member.isError).toBe(true);
		} finally {
			await host.sessionShutdown();
		}
	});

	it("restores teammate labels from Agent receipts on the selected branch and forgets another branch", async () => {
		const session = SessionManager.inMemory("/fake");
		const root = session.appendMessage({ role: "user", content: "start", timestamp: 1 });
		function spawn(callId: string, runId: string, name: string, timestamp: number): string {
			session.appendMessage({
				...assistant(callId, timestamp),
				content: [{ type: "toolCall", id: callId, name: "Agent", arguments: { name } }],
			});
			return session.appendMessage({
				role: "toolResult",
				toolCallId: callId,
				toolName: "Agent",
				content: [{ type: "text", text: `{agent:${runId} started as @${name}}` }],
				details: { agentId: runId, teammateName: name },
				isError: false,
				timestamp: timestamp + 1,
			});
		}
		const firstLeaf = spawn("call-one", "run-one", "workflow", 2);
		session.branch(root);
		const secondLeaf = spawn("call-two", "run-two", "reviewer", 4);
		const host = new FakePiHost({ mode: "print", sessionEntries: session.getEntries() });
		Object.assign(host.extensionContext.sessionManager, { getBranch: () => session.getBranch() });
		piStyleExtension(host.extensionApi);
		try {
			await host.sessionStart();
			expect(teammateForRun("run-one")).toBeUndefined();
			expect(teammateForRun("run-two")).toBe("reviewer");
			session.branch(firstLeaf);
			await host.emit("session_tree", { type: "session_tree", newLeafId: firstLeaf, oldLeafId: secondLeaf });
			expect(teammateForRun("run-one")).toBe("workflow");
			expect(teammateForRun("run-two")).toBeUndefined();
		} finally {
			await host.sessionShutdown();
		}
		expect(teammateForRun("run-one")).toBeUndefined();
	});
});
