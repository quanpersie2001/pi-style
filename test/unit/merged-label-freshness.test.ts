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
	attributeMessageToLatestGroup,
	beginAgentThoughtRun,
	finishAgentThoughtRun,
	refreshThoughtComponentsForMessage,
} from "../../extension-src/pi-style/features/messages/thought-summary.js";
import { renderBoxedToolCall as dispatchCall } from "../../extension-src/pi-style/features/tools/boxed/index.js";
import {
	beginAgentRun,
	finishAgentRun,
	registerTurnFromMessage,
	resetTurnRegistry,
} from "../../extension-src/pi-style/features/tools/boxed/turn-summary.js";
import {
	disposePiCompatibilityProbe,
	probePiCompatibility,
} from "../../extension-src/pi-style/pi/compatibility-probe.js";
import { stripAnsi } from "../../extension-src/pi-style/shared/ansi.js";
import type { BoxTheme } from "../../extension-src/pi-style/shared/box.js";
import { createFakeTheme } from "../helpers/fake-theme.js";

const plainTheme: BoxTheme = { fg: (_color, text) => text };
const theme = createFakeTheme();

function toolContext(id: string, overrides: Record<string, unknown> = {}) {
	return {
		args: {},
		toolCallId: id,
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
	} as never;
}

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

describe("thinking-less tool messages attribute to the latest thought group", () => {
	it("counts continuation tools on the merged line and hides the run's ➔ leader (subagent flow)", () => {
		initTheme("dark", false);
		setThoughtLabelTheme(plainTheme);
		const report = installProbe();

		beginAgentThoughtRun();
		beginAgentRun();

		// Message 1: thinking + commentary + one tool.
		const m1 = msg(
			[
				{ type: "thinking", thinking: "round one" },
				{ type: "text", text: "Nhận kết quả subagent:" },
				{ type: "toolCall", id: "t1", name: "read", arguments: {} },
			],
			3,
		);
		const comp1 = new AssistantMessageComponent(m1, true, undefined, "", 1);
		comp1.setHideThinkingBlock(true);
		comp1.setHiddenThinkingLabel("");
		comp1.updateContent(m1, false);
		registerTurnFromMessage(m1, [{ toolCallId: "t1", isError: false, content: [] }]);
		expect(attributeMessageToLatestGroup(m1)).toBe(true);
		refreshThoughtComponentsForMessage(m1);

		// Message 2: thinking-less continuation (extension tool + bash).
		const m2 = msg(
			[
				{ type: "toolCall", id: "t2", name: "get_subagent_result", arguments: {} },
				{ type: "toolCall", id: "t3", name: "bash", arguments: {} },
			],
			4,
		);
		registerTurnFromMessage(m2, [
			{ toolCallId: "t2", isError: false, content: [] },
			{ toolCallId: "t3", isError: false, content: [] },
		]);
		expect(attributeMessageToLatestGroup(m2)).toBe(true);
		refreshThoughtComponentsForMessage(m2);

		finishAgentRun();
		finishAgentThoughtRun();

		// The merged label counts ALL THREE tools (attributed continuation included).
		const label = labelOf(comp1);
		expect(label).toContain("Thought 1 time · Called 3 tools");

		// The run's ➔ leader defers entirely (every message attributed), and
		// Ctrl+O expansion still renders every member standalone (unknown/
		// extension tools through the boxed fallback).
		// Collapsed: leader defers, members hide.
		const leader = dispatchCall("read", { path: "a.ts" }, theme, toolContext("t1"));
		expect(leader.render(80)).toEqual([]);
		expect(dispatchCall("get_subagent_result", {}, theme, toolContext("t2")).render(80)).toEqual([]);
		expect(dispatchCall("bash", { command: "ls" }, theme, toolContext("t3")).render(80)).toEqual([]);
		// Expanded (Ctrl+O): every member renders standalone — the extension
		// tool through the boxed fallback, bash through its own renderer.
		for (const [name, args, id] of [
			["read", { path: "a.ts" }, "t1"],
			["get_subagent_result", {}, "t2"],
			["bash", { command: "ls" }, "t3"],
		] as const) {
			const expanded = dispatchCall(name, args as never, theme, toolContext(id, { expanded: true }));
			expect(expanded.render(80).length, `${name} expanded renders`).toBeGreaterThan(0);
		}

		disposePiCompatibilityProbe(report);
	});
});

describe("contiguous tool rounds stay ONE segment", () => {
	it("three thinking+tool messages with no text between collapse to a single label", () => {
		initTheme("dark", false);
		setThoughtLabelTheme(plainTheme);
		const report = installProbe();

		beginAgentThoughtRun();
		beginAgentRun();

		const comps: AssistantMessageComponent[] = [];
		for (let i = 1; i <= 3; i++) {
			const m = msg(
				[
					{ type: "thinking", thinking: `round ${i}` },
					{ type: "toolCall", id: `t${i}`, name: "read", arguments: {} },
				],
				100 + i,
			);
			const comp = new AssistantMessageComponent(m, true, undefined, "", 1);
			comp.setHideThinkingBlock(true);
			comp.setHiddenThinkingLabel("");
			comp.updateContent(m, false);
			registerTurnFromMessage(m, [{ toolCallId: `t${i}`, isError: false, content: [] }]);
			attributeMessageToLatestGroup(m);
			refreshThoughtComponentsForMessage(m);
			comps.push(comp);
		}

		finishAgentRun();
		finishAgentThoughtRun();

		// ONE aggregate on the leader (first message); the rest zero-trace.
		const first = stripAnsi(comps[0].render(100).join("\n"));
		const matches = first.match(/◈ [^\n]*/g) ?? [];
		console.log(
			"leader labels:",
			matches,
			"| others:",
			comps.slice(1).map((c) => (stripAnsi(c.render(100).join("\n")).match(/◈ [^\n]*/g) ?? []).length),
		);
		expect(first).toContain("Thought 3 times · Called 3 tools");
		for (const comp of comps.slice(1)) {
			expect(stripAnsi(comp.render(100).join("\n"))).not.toContain("◈");
		}
		disposePiCompatibilityProbe(report);
	});
});

describe("interleaved run-progress labels (cumulative per text segment)", () => {
	it("text-split rounds each keep their cumulative label right before their text", () => {
		initTheme("dark", false);
		setThoughtLabelTheme(plainTheme);
		const report = installProbe();

		beginAgentThoughtRun();
		beginAgentRun();

		const comps: AssistantMessageComponent[] = [];
		for (let i = 1; i <= 3; i++) {
			const m = msg(
				[
					{ type: "thinking", thinking: `round ${i}` },
					{ type: "text", text: `tiến độ ${i}` },
					{ type: "toolCall", id: `t${i}`, name: "read", arguments: {} },
				],
				200 + i,
			);
			const comp = new AssistantMessageComponent(m, true, undefined, "", 1);
			comp.setHideThinkingBlock(true);
			comp.setHiddenThinkingLabel("");
			comp.updateContent(m, false);
			registerTurnFromMessage(m, [{ toolCallId: `t${i}`, isError: false, content: [] }]);
			attributeMessageToLatestGroup(m);
			refreshThoughtComponentsForMessage(m);
			comps.push(comp);
		}

		finishAgentRun();
		for (const comp of comps) {
			const m = comp.lastMessage as unknown as object;
			attributeMessageToLatestGroup(m);
		}
		finishAgentThoughtRun();

		// Every segment leader keeps its own CUMULATIVE run-progress line.
		const texts = comps.map((comp) => stripAnsi(comp.render(100).join("\n")));
		expect(texts[0]).toContain("◈ Thought 1 time · Called 1 tool");
		expect(texts[1]).toContain("◈ Thought 2 times · Called 2 tools");
		expect(texts[2]).toContain("◈ Thought 3 times · Called 3 tools");
		// Each label sits right before its segment's commentary text.
		expect(texts[1].indexOf("Thought 2 times")).toBeLessThan(texts[1].indexOf("tiến độ 2"));
		for (const [index, text] of texts.entries()) expect(text).toContain(`tiến độ ${index + 1}`);
		// The run's ➔ leader still defers (all messages attributed + ended).
		const leader = dispatchCall("read", { path: "a.ts" }, theme, toolContext("t1"));
		expect(leader.render(80)).toEqual([]);

		disposePiCompatibilityProbe(report);
	});
});
