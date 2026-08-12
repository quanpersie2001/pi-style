// Interim narration hiding (ADR 0007 companion): assistant messages that carry
// tool calls use their text only to narrate while working; the tool blocks tell
// the story. `hideInterimText` drops that text from the content container so
// the feed shows the run summary and the final answer. Deterministic per
// content — streaming, scroll-back, and resume behave identically. Errors and
// truncation notices are Text children and stay; if only spacers remain the
// message becomes zero-trace.

import type { AssistantMessage } from "@earendil-works/pi-ai";
import { AssistantMessageComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { decorateMessageUpdate } from "../../extension-src/pi-style/features/messages/index.js";
import { targetSpecs } from "../../extension-src/pi-style/pi/compatibility-probe.js";
import { getCompatibilityRecords } from "../../extension-src/pi-style/pi/compatibility-registry.js";

const HIDE_SNAPSHOT = {
	assistantPrefix: "│ ",
	assistantEnabled: true,
	collapseHiddenThinking: false,
	hideInterimText: true,
} as const;

const KEEP_SNAPSHOT = { ...HIDE_SNAPSHOT, hideInterimText: false } as const;

afterEach(() => {
	for (const spec of targetSpecs) {
		for (const record of getCompatibilityRecords(spec.target)) record.disposer();
	}
});

function assistantMessage(
	content: AssistantMessage["content"],
	stopReason: string = "toolUse",
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

function narrationWithTools(): ConstructorParameters<typeof AssistantMessageComponent>[0] {
	return assistantMessage([
		{ type: "text", text: "Let me look at the in-progress work." },
		{ type: "toolCall", id: "t1", name: "read", arguments: { path: "x" } },
	]);
}

function thinkingNarrationWithTools(): ConstructorParameters<typeof AssistantMessageComponent>[0] {
	return assistantMessage([
		{ type: "thinking", thinking: "Let me think about this." },
		{ type: "text", text: "Let me check the docs." },
		{ type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } },
	]);
}

function textOnly(): ConstructorParameters<typeof AssistantMessageComponent>[0] {
	return assistantMessage([{ type: "text", text: "Final answer." }], "stop");
}

function truncatedNarration(): ConstructorParameters<typeof AssistantMessageComponent>[0] {
	return assistantMessage(
		[
			{ type: "text", text: "Let me read the file." },
			{ type: "toolCall", id: "t1", name: "read", arguments: { path: "x" } },
		],
		"length",
	);
}

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

/** Assistant TEXT markdown: setText + options object + no defaultTextStyle. */
function isTextMarkdownLike(child: unknown): boolean {
	const candidate = child as { setText?: unknown; options?: unknown; defaultTextStyle?: unknown };
	return (
		typeof candidate.setText === "function" &&
		candidate.options !== undefined &&
		typeof candidate.options === "object" &&
		candidate.defaultTextStyle === undefined
	);
}
function isThinkingMarkdownLike(child: unknown): boolean {
	const candidate = child as { setText?: unknown; defaultTextStyle?: unknown };
	return typeof candidate.setText === "function" && candidate.defaultTextStyle !== undefined;
}

describe("interim narration hiding", () => {
	it("drops the narration text of a tool-carrying message; zero trace when nothing else remains", () => {
		initTheme("dark", false);
		const comp = new AssistantMessageComponent(narrationWithTools());
		// Native: spacer + one text markdown.
		expect(comp.contentContainer.children).toHaveLength(2);
		expect(isTextMarkdownLike(comp.contentContainer.children[1])).toBe(true);

		decorateMessageUpdate(
			AssistantMessageComponent.prototype.updateContent,
			comp,
			[narrationWithTools()],
			HIDE_SNAPSHOT,
		);
		expect(comp.contentContainer.children).toHaveLength(0);
		expect(comp.render(40)).toEqual([]);
	});

	it("keeps visible thinking while hiding the narration text", () => {
		initTheme("dark", false);
		const comp = new AssistantMessageComponent(thinkingNarrationWithTools());
		decorateMessageUpdate(
			AssistantMessageComponent.prototype.updateContent,
			comp,
			[thinkingNarrationWithTools()],
			HIDE_SNAPSHOT,
		);
		const children = comp.contentContainer.children;
		expect(children.some(isThinkingMarkdownLike)).toBe(true);
		expect(children.some(isTextMarkdownLike)).toBe(false);
		const text = stripAnsi(comp.render(40).join("\n"));
		expect(text).toContain("Let me think about this.");
		expect(text).not.toContain("Let me check the docs.");
	});

	it("keeps the text of messages without tool calls (the final answer)", () => {
		initTheme("dark", false);
		const comp = new AssistantMessageComponent(textOnly());
		decorateMessageUpdate(AssistantMessageComponent.prototype.updateContent, comp, [textOnly()], HIDE_SNAPSHOT);
		expect(comp.contentContainer.children.some(isTextMarkdownLike)).toBe(true);
		const text = stripAnsi(comp.render(40).join("\n"));
		expect(text).toContain("Final answer.");
	});

	it("keeps the truncation notice when hiding narration", () => {
		initTheme("dark", false);
		const comp = new AssistantMessageComponent(truncatedNarration());
		decorateMessageUpdate(
			AssistantMessageComponent.prototype.updateContent,
			comp,
			[truncatedNarration()],
			HIDE_SNAPSHOT,
		);
		const text = stripAnsi(comp.render(40).join("\n"));
		expect(text).toContain("Response was truncated");
		expect(text).not.toContain("Let me read the file.");
	});

	it("does nothing when hideInterimText is off", () => {
		initTheme("dark", false);
		const comp = new AssistantMessageComponent(narrationWithTools());
		decorateMessageUpdate(
			AssistantMessageComponent.prototype.updateContent,
			comp,
			[narrationWithTools()],
			KEEP_SNAPSHOT,
		);
		expect(comp.contentContainer.children).toHaveLength(2);
		expect(stripAnsi(comp.render(40).join("\n"))).toContain("Let me look at the in-progress work.");
	});

	it("applies during streaming updates identically", () => {
		initTheme("dark", false);
		const comp = new AssistantMessageComponent(narrationWithTools(), false, undefined, undefined, 1);
		decorateMessageUpdate(
			AssistantMessageComponent.prototype.updateContent,
			comp,
			[narrationWithTools(), true],
			HIDE_SNAPSHOT,
		);
		expect(comp.contentContainer.children).toHaveLength(0);
	});
});
