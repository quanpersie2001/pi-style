// Merged-label freshness across the real production sequence (regression).
//
// The merged summary line went stale mid-run in two reported scenarios:
// (a) a text-split segment's label rendered before its message's tool stats
//     existed — stats were only published at agent_end (`finishAgentRun`), so
//     the label showed `◈ 1 thought` until a manual expand/collapse re-fired
//     updateContent;
// (b) a mid-conversation `agent_start` re-fire (steering) ends live segments
//     without any stats publication.
//
// Both are fixed by publishing per-message stats at `turn_end`
// (`registerTurnFromMessage`) and refreshing exactly the covering components
// (`refreshThoughtComponentsForMessage`). These tests drive the PATCHED
// AssistantMessageComponent (probe installed with the production snapshot)
// through both sequences.

import type { AssistantMessage } from "@earendil-works/pi-ai";
import { AssistantMessageComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { setThoughtLabelTheme } from "../../extension-src/pi-style/features/messages/index.js";
import {
	beginAgentThoughtRun,
	finishAgentThoughtRun,
	refreshThoughtComponentsForMessage,
} from "../../extension-src/pi-style/features/messages/thought-summary.js";
import {
	beginAgentRun,
	registerTurnFromMessage,
	resetTurnRegistry,
} from "../../extension-src/pi-style/features/tools/boxed/turn-summary.js";
import {
	disposePiCompatibilityProbe,
	probePiCompatibility,
} from "../../extension-src/pi-style/pi/compatibility-probe.js";
import { stripAnsi } from "../../extension-src/pi-style/shared/ansi.js";
import type { BoxTheme } from "../../extension-src/pi-style/shared/box.js";

const plainTheme: BoxTheme = { fg: (_color, text) => text };

function msg(
	content: AssistantMessage["content"],
	timestamp: number,
): ConstructorParameters<typeof AssistantMessageComponent>[0] {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "fixture",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		timestamp,
	};
}

function labelOf(comp: AssistantMessageComponent): string {
	const text = stripAnsi(comp.render(100).join("\n"));
	const match = text.match(/◈ [^\n]*/);
	return match ? match[0] : "(none)";
}

function installProbe() {
	const report = probePiCompatibility("0.85.0", {
		config: {
			messages: {
				enabled: true,
				assistantPrefix: true,
				specialBlocks: false,
				hideThinkingLabel: true,
				preserveCompactionTranscript: false,
			},
			tools: { enabled: false, style: "compact-box", maxCollapsedLines: 10, maxExpandedLines: 50, dimOutput: false },
			preset: "fixture",
		},
		messageSnapshot: {
			assistantPrefix: "│ ",
			assistantEnabled: true,
			collapseHiddenThinking: true,
			thoughtSummary: true,
			mergedTurnSummary: true,
			thoughtGlyph: "◈",
		},
	});
	expect(report.recordSnapshots.some((r) => r.shape === "installed")).toBe(true);
	return report;
}

afterEach(() => {
	resetTurnRegistry();
});

describe("merged label freshness (probe installed, production wiring)", () => {
	it("publishes stats at turn_end: a re-begun (steered) segment labels correctly mid-run", () => {
		initTheme("dark", false);
		setThoughtLabelTheme(plainTheme);
		const report = installProbe();

		beginAgentThoughtRun();
		beginAgentRun();

		// Message 1: thinking + commentary text + one tool call.
		const m1 = msg(
			[
				{ type: "thinking", thinking: "round one" },
				{ type: "text", text: "Đã thấy gateway. Giờ xem adapter:" },
				{ type: "toolCall", id: "t1", name: "read", arguments: {} },
			],
			1,
		);
		const comp1 = new AssistantMessageComponent(m1, true, undefined, "", 1);
		comp1.setHideThinkingBlock(true);
		comp1.setHiddenThinkingLabel("");
		comp1.updateContent(m1, false);

		// turn_end wiring: register (+ publish stats) + targeted refresh.
		registerTurnFromMessage(m1, [{ toolCallId: "t1", isError: false, content: [] }]);
		refreshThoughtComponentsForMessage(m1);
		expect(labelOf(comp1)).toBe("(none)"); // live group: still zero-trace mid-run

		// Steering re-fire: agent_start again mid-conversation — begin's
		// fail-closed finishes the live segments WITHOUT finishAgentRun.
		beginAgentThoughtRun();
		beginAgentRun();
		const steeredLabel = labelOf(comp1);
		expect(steeredLabel).toContain("Thought 1 time · Called 1 tool");
		expect(steeredLabel).not.toContain("(none)");

		disposePiCompatibilityProbe(report);
	});

	it("labels carry stats immediately when the segment ends after its turn", () => {
		initTheme("dark", false);
		setThoughtLabelTheme(plainTheme);
		const report = installProbe();

		beginAgentThoughtRun();
		beginAgentRun();

		const m1 = msg(
			[
				{ type: "thinking", thinking: "round one" },
				{ type: "text", text: "Đã thấy gateway. Giờ xem adapter:" },
				{ type: "toolCall", id: "t1", name: "read", arguments: {} },
			],
			2,
		);
		const comp1 = new AssistantMessageComponent(m1, true, undefined, "", 1);
		comp1.setHideThinkingBlock(true);
		comp1.setHiddenThinkingLabel("");
		comp1.updateContent(m1, false);
		registerTurnFromMessage(m1, [{ toolCallId: "t1", isError: false, content: [] }]);
		refreshThoughtComponentsForMessage(m1);

		// Agent end (production ordering): stats → thought finalize → refresh.
		finishAgentThoughtRun();
		const label = labelOf(comp1);
		expect(label).toContain("Thought 1 time · Called 1 tool");

		disposePiCompatibilityProbe(report);
	});
});
