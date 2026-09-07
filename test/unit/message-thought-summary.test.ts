import type { AssistantMessage } from "@earendil-works/pi-ai";
import { AssistantMessageComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import {
	__resetMessageDecorationTestState,
	decorateMessageRender,
	decorateMessageUpdate,
	setThoughtLabelTheme,
} from "../../extension-src/pi-style/features/messages/index.js";
import {
	disposePiCompatibilityProbe,
	probePiCompatibility,
	targetSpecs,
} from "../../extension-src/pi-style/pi/compatibility-probe.js";
import { getCompatibilityRecords } from "../../extension-src/pi-style/pi/compatibility-registry.js";
import type { BoxTheme } from "../../extension-src/pi-style/shared/box.js";

const SUMMARY_SNAPSHOT = {
	assistantPrefix: "│ ",
	assistantEnabled: true,
	collapseHiddenThinking: true,
	thoughtSummary: true,
	thoughtGlyph: "◈",
} as const;

const ASCII_SNAPSHOT = {
	assistantPrefix: "[assistant] ",
	assistantEnabled: true,
	collapseHiddenThinking: true,
	thoughtSummary: true,
	thoughtGlyph: ">",
} as const;

// Minimal BoxTheme stand-in: identity styling, so label text is assertable raw.
const plainTheme: BoxTheme = { fg: (_color, text) => text };

function baseMessage(
	content: AssistantMessage["content"],
	stopReason?: AssistantMessage["stopReason"],
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
		stopReason,
		timestamp: 1,
	};
}

const thinkingOnly = () => baseMessage([{ type: "thinking", thinking: "Working through it." }]);
const thinkingThenAnswer = () =>
	baseMessage([
		{ type: "thinking", thinking: "Working through it." },
		{ type: "text", text: "Final answer." },
	]);

function stripAnsi(value: string): string {
	let output = "";
	for (let index = 0; index < value.length; index++) {
		if (value[index] !== "\x1b") {
			output += value[index];
			continue;
		}
		if (value[index + 1] === "]") {
			index += 2;
			while (index < value.length && value.charCodeAt(index) !== 7) index++;
			continue;
		}
		if (value[index + 1] === "[") {
			index += 2;
			while (index < value.length && (value.charCodeAt(index) < 64 || value.charCodeAt(index) > 126)) index++;
		}
	}
	return output;
}

// pi-coding-agent resolves its own nested pi-tui copy, so class identity across
// the module boundary is not shared; assert on the public component shape instead.
function unwrapMouseRegion(child: unknown): unknown {
	const candidate = child as { handleMouse?: unknown; child?: unknown } | undefined;
	if (typeof candidate?.handleMouse !== "function" || candidate.child === undefined) return child;
	return candidate.child;
}
function isSpacerLike(child: unknown): boolean {
	return typeof (child as { setLines?: unknown }).setLines === "function";
}
function isTextLike(child: unknown): boolean {
	return typeof (unwrapMouseRegion(child) as { setCustomBgFn?: unknown }).setCustomBgFn === "function";
}
function textOf(child: unknown): string {
	const text = (unwrapMouseRegion(child) as { text?: unknown }).text;
	return typeof text === "string" ? stripAnsi(text) : "";
}
function rendered(comp: AssistantMessageComponent, width = 60): string {
	return stripAnsi(comp.render(width).join("\n"));
}

afterEach(() => {
	__resetMessageDecorationTestState(); // also clears the thought theme + timing state
	for (const spec of targetSpecs) {
		for (const record of getCompatibilityRecords(spec.target)) record.disposer();
	}
});

describe("thought summary label", () => {
	it("keeps the zero-trace collapse while the thinking run is still streaming", () => {
		initTheme("dark", false);
		setThoughtLabelTheme(plainTheme);
		const comp = new AssistantMessageComponent(undefined, true, undefined, "", 1);
		decorateMessageUpdate(
			AssistantMessageComponent.prototype.updateContent,
			comp,
			[thinkingOnly(), true],
			SUMMARY_SNAPSHOT,
		);
		// Streaming (isStreaming=true, thinking is the trailing content): the blank
		// label row is dropped entirely — no summary row before completion.
		expect(comp.contentContainer.children).toHaveLength(1);
		expect(isSpacerLike(comp.contentContainer.children[0])).toBe(true);
		expect(rendered(comp)).not.toContain("Thought");
	});

	it("rewrites the label of a first-observed-complete run without a duration (resume/history)", () => {
		initTheme("dark", false);
		setThoughtLabelTheme(plainTheme);
		// History path: constructed with the finalized message (no streaming pass
		// observed) — duration-less summary, never a fabricated number.
		const comp = new AssistantMessageComponent(thinkingThenAnswer(), true, undefined, "", 1);
		decorateMessageUpdate(
			AssistantMessageComponent.prototype.updateContent,
			comp,
			[thinkingThenAnswer()],
			SUMMARY_SNAPSHOT,
		);
		const children = comp.contentContainer.children;
		expect(children).toHaveLength(4);
		expect(isSpacerLike(children[0])).toBe(true);
		expect(isTextLike(children[1])).toBe(true); // label row kept (clickable)
		expect(textOf(children[1])).toBe("◈ Thought");
		expect(isSpacerLike(children[2])).toBe(true);
		expect(rendered(comp)).toContain("◈ Thought");
	});

	it("shows a measured duration for a run the extension watched stream", () => {
		initTheme("dark", false);
		setThoughtLabelTheme(plainTheme);
		const comp = new AssistantMessageComponent(undefined, true, undefined, "", 1);
		// Pass 1: streaming thinking-only — run observed mid-stream.
		decorateMessageUpdate(
			AssistantMessageComponent.prototype.updateContent,
			comp,
			[thinkingOnly(), true],
			SUMMARY_SNAPSHOT,
		);
		// Pass 2: finalized thinking+text — completed with a measured duration.
		decorateMessageUpdate(
			AssistantMessageComponent.prototype.updateContent,
			comp,
			[thinkingThenAnswer(), false],
			SUMMARY_SNAPSHOT,
		);
		const label = textOf(comp.contentContainer.children[1]);
		expect(label).toMatch(/^◈ Thought for \d+(\.\d+)?(ms|s)$/);
	});

	it("treats a stopReason on a thinking-only message as a completed run", () => {
		initTheme("dark", false);
		setThoughtLabelTheme(plainTheme);
		const message = baseMessage([{ type: "thinking", thinking: "Aborted mid-thought." }], "aborted");
		const comp = new AssistantMessageComponent(message, true, undefined, "", 1);
		decorateMessageUpdate(AssistantMessageComponent.prototype.updateContent, comp, [message], SUMMARY_SNAPSHOT);
		expect(textOf(comp.contentContainer.children[1])).toBe("◈ Thought");
	});

	it("falls back to zero-trace when no session theme is cached", () => {
		initTheme("dark", false);
		setThoughtLabelTheme(undefined);
		const comp = new AssistantMessageComponent(thinkingThenAnswer(), true, undefined, "", 1);
		decorateMessageUpdate(
			AssistantMessageComponent.prototype.updateContent,
			comp,
			[thinkingThenAnswer()],
			SUMMARY_SNAPSHOT,
		);
		// Fail-safe: without a theme the label cannot be styled, so the completed
		// run keeps the plain zero-trace collapse.
		expect(comp.contentContainer.children).toHaveLength(2);
		expect(rendered(comp)).not.toContain("Thought");
	});

	it("keeps the zero-trace collapse for completed runs when thoughtSummary is off", () => {
		initTheme("dark", false);
		setThoughtLabelTheme(plainTheme);
		const comp = new AssistantMessageComponent(thinkingThenAnswer(), true, undefined, "", 1);
		decorateMessageUpdate(AssistantMessageComponent.prototype.updateContent, comp, [thinkingThenAnswer()], {
			assistantPrefix: "│ ",
			assistantEnabled: true,
			collapseHiddenThinking: true,
		});
		expect(comp.contentContainer.children).toHaveLength(2);
	});

	it("uses the ASCII glyph pair from the snapshot", () => {
		initTheme("dark", false);
		setThoughtLabelTheme(plainTheme);
		const comp = new AssistantMessageComponent(thinkingThenAnswer(), true, undefined, "", 1);
		decorateMessageUpdate(
			AssistantMessageComponent.prototype.updateContent,
			comp,
			[thinkingThenAnswer()],
			ASCII_SNAPSHOT,
		);
		expect(textOf(comp.contentContainer.children[1])).toBe("> Thought");
	});

	it("rewrites each label of a multi-run message independently", () => {
		initTheme("dark", false);
		setThoughtLabelTheme(plainTheme);
		const message = baseMessage([
			{ type: "thinking", thinking: "First pass." },
			{ type: "text", text: "Interlude." },
			{ type: "thinking", thinking: "Second pass." },
			{ type: "text", text: "Done." },
		]);
		const comp = new AssistantMessageComponent(message, true, undefined, "", 1);
		decorateMessageUpdate(AssistantMessageComponent.prototype.updateContent, comp, [message], SUMMARY_SNAPSHOT);
		const labels = comp.contentContainer.children.filter((child) => isTextLike(child)).map(textOf);
		expect(labels).toEqual(["◈ Thought", "◈ Thought"]);
	});

	it("inserts an expanded-run header above thinking content after a click toggle (probe path)", () => {
		initTheme("dark", false);
		setThoughtLabelTheme(plainTheme);
		const report = probePiCompatibility("0.83.0", { markers: new Set<string>(), messageSnapshot: SUMMARY_SNAPSHOT });
		expect(
			report.recordSnapshots.find(
				(record) => record.subtype === "native-assistant-message" && record.method === "updateContent",
			)?.shape,
		).toBe("installed");

		const comp = new AssistantMessageComponent(undefined, true, undefined, "", 1);
		comp.updateContent(thinkingOnly(), true);
		comp.updateContent(thinkingThenAnswer(), false);
		// The completed run's rewritten label row is still the click toggle.
		const labelRegion = comp.contentContainer.children[1] as unknown as {
			handleMouse: (event: { type: string; button: string }) => unknown;
		};
		expect(labelRegion.handleMouse).toBeTypeOf("function");
		expect(labelRegion.handleMouse({ type: "click", button: "left" })).toEqual({ handled: true });

		const children = comp.contentContainer.children;
		// [Spacer, header Text, MouseRegion(Markdown thinking), Spacer, Markdown answer]
		expect(children).toHaveLength(5);
		expect(textOf(children[1])).toMatch(/^◈ Thought for \d+(\.\d+)?(ms|s)$/);
		// Native clear()-and-rebuild creates a fresh MouseRegion wrapping the
		// now-visible thinking Markdown (same toggle semantics, new instance).
		expect(isTextLike(children[2])).toBe(false); // Markdown, not a label Text
		expect(rendered(comp)).toContain("◈ Thought for");
		disposePiCompatibilityProbe(report);
	});

	it("recovers a recorded duration when Pi's history rebuild replaces the component", () => {
		initTheme("dark", false);
		setThoughtLabelTheme(plainTheme);
		// Live streaming component A observes the run stream, then finalize
		// (message_end keeps the instance; the duration is recorded by signature).
		const comp = new AssistantMessageComponent(undefined, true, undefined, "", 1);
		decorateMessageUpdate(
			AssistantMessageComponent.prototype.updateContent,
			comp,
			[thinkingOnly(), true],
			SUMMARY_SNAPSHOT,
		);
		const final = thinkingThenAnswer();
		decorateMessageUpdate(AssistantMessageComponent.prototype.updateContent, comp, [final, false], SUMMARY_SNAPSHOT);
		// agent_end removes A; the history rebuild constructs a fresh component B
		// whose first observation is the already-complete run — it must recover the
		// recorded duration instead of rendering the duration-less variant.
		const replacement = new AssistantMessageComponent(final, true, undefined, "", 1);
		decorateMessageUpdate(AssistantMessageComponent.prototype.updateContent, replacement, [final], SUMMARY_SNAPSHOT);
		expect(textOf(replacement.contentContainer.children[1])).toMatch(/^◈ Thought for \d+(\.\d+)?(ms|s)$/);
	});

	it("prefixes the answer with │ but not the thought row (glyph replaces the role prefix)", () => {
		initTheme("dark", false);
		setThoughtLabelTheme(plainTheme);
		const comp = new AssistantMessageComponent(thinkingThenAnswer(), true, undefined, "", 1);
		decorateMessageUpdate(
			AssistantMessageComponent.prototype.updateContent,
			comp,
			[thinkingThenAnswer()],
			SUMMARY_SNAPSHOT,
		);
		const lines = decorateMessageRender(
			AssistantMessageComponent.prototype.render,
			comp,
			[60],
			SUMMARY_SNAPSHOT,
		) as string[];
		const plain = lines.map(stripAnsi);
		const thoughtLine = plain.find((line) => line.includes("◈ Thought"));
		const answerLine = plain.find((line) => line.includes("Final answer."));
		expect(thoughtLine).toBeDefined();
		expect(thoughtLine?.startsWith("│")).toBe(false); // continuation indent, not the role prefix
		expect(thoughtLine?.trimStart().startsWith("◈ Thought")).toBe(true);
		expect(answerLine?.startsWith("│")).toBe(true); // the role prefix moves to the answer
	});

	it("rails expanded thinking content with │ under the header; the answer keeps its prefix", () => {
		initTheme("dark", false);
		setThoughtLabelTheme(plainTheme);
		const report = probePiCompatibility("0.83.0", { markers: new Set<string>(), messageSnapshot: SUMMARY_SNAPSHOT });
		const comp = new AssistantMessageComponent(undefined, true, undefined, "", 1);
		comp.updateContent(thinkingOnly(), true);
		comp.updateContent(thinkingThenAnswer(), false);
		// Click the summary row to expand the thinking content.
		const labelRegion = comp.contentContainer.children[1] as unknown as {
			handleMouse: (event: { type: string; button: string }) => unknown;
		};
		expect(labelRegion.handleMouse({ type: "click", button: "left" })).toEqual({ handled: true });
		const plain = (comp.render(60) as string[]).map(stripAnsi);
		const headerLine = plain.find((line) => line.includes("◈ Thought for"));
		const thinkingLines = plain.filter((line) => line.includes("Working through it."));
		const answerLine = plain.find((line) => line.includes("Final answer."));
		expect(headerLine?.startsWith("│")).toBe(false); // header: glyph only, no rail
		expect(thinkingLines.length).toBeGreaterThan(0);
		expect(thinkingLines.every((line) => line.trimStart().startsWith("│"))).toBe(true); // quote rail
		expect(answerLine?.startsWith("│")).toBe(true); // the role prefix lands on the answer
		disposePiCompatibilityProbe(report);
	});

	it("leaves native visible labels untouched when the label is not blanked", () => {
		initTheme("dark", false);
		setThoughtLabelTheme(plainTheme);
		const comp = new AssistantMessageComponent(thinkingThenAnswer(), true, undefined, "Thinking...", 1);
		decorateMessageUpdate(
			AssistantMessageComponent.prototype.updateContent,
			comp,
			[thinkingThenAnswer()],
			SUMMARY_SNAPSHOT,
		);
		expect(textOf(comp.contentContainer.children[1])).toBe("Thinking...");
		expect(rendered(comp)).toContain("Thinking...");
	});
});
