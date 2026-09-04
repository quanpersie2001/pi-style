// Mixed assistant messages must preserve every text block. A toolCall is not a
// reliable signal that adjacent text is disposable narration: it may contain a
// warning, conclusion, or provider-specific final answer. Tool compaction owns
// feed density; message decoration never removes assistant prose.

import type { AssistantMessage } from "@earendil-works/pi-ai";
import { AssistantMessageComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { decorateMessageUpdate } from "../../extension-src/pi-style/features/messages/index.js";

const SNAPSHOT = {
	assistantPrefix: "│ ",
	assistantEnabled: true,
	collapseHiddenThinking: false,
} as const;

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

function mixedMessage(text = "Important warning before using the tool.") {
	return assistantMessage([
		{ type: "text", text },
		{ type: "toolCall", id: "t1", name: "read", arguments: { path: "x" } },
	]);
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

function renderedText(component: AssistantMessageComponent): string {
	return stripAnsi(component.render(80).join("\n"));
}

function isTextMarkdownLike(child: unknown): boolean {
	const candidate = unwrapMouseRegion(child) as { setText?: unknown; options?: unknown; defaultTextStyle?: unknown };
	return (
		typeof candidate.setText === "function" &&
		candidate.options !== undefined &&
		typeof candidate.options === "object" &&
		candidate.defaultTextStyle === undefined
	);
}

function isThinkingMarkdownLike(child: unknown): boolean {
	const candidate = unwrapMouseRegion(child) as { setText?: unknown; defaultTextStyle?: unknown };
	return typeof candidate.setText === "function" && candidate.defaultTextStyle !== undefined;
}

// Pi 0.85.0 wraps thinking-run components in a render-transparent MouseRegion
// (click-to-toggle visibility); unwrap before shape checks.
function unwrapMouseRegion(child: unknown): unknown {
	const candidate = child as { handleMouse?: unknown; child?: unknown } | undefined;
	if (typeof candidate?.handleMouse !== "function" || candidate.child === undefined) return child;
	return candidate.child;
}

describe("mixed assistant text preservation", () => {
	it("keeps text when the same message carries a tool call", () => {
		initTheme("dark", false);
		const message = mixedMessage();
		const component = new AssistantMessageComponent(message);

		decorateMessageUpdate(AssistantMessageComponent.prototype.updateContent, component, [message], SNAPSHOT);

		expect(component.contentContainer.children.some(isTextMarkdownLike)).toBe(true);
		expect(renderedText(component)).toContain("Important warning before using the tool.");
	});

	it("keeps text when a later streaming update introduces a tool call", () => {
		initTheme("dark", false);
		const initial = assistantMessage([{ type: "text", text: "Streaming explanation." }]);
		const component = new AssistantMessageComponent(initial, false, undefined, undefined, 1);
		const mixed = mixedMessage("Streaming explanation.");

		decorateMessageUpdate(AssistantMessageComponent.prototype.updateContent, component, [mixed, true], SNAPSHOT);

		expect(renderedText(component)).toContain("Streaming explanation.");
	});

	it("keeps both thinking and visible text in a mixed message", () => {
		initTheme("dark", false);
		const message = assistantMessage([
			{ type: "thinking", thinking: "Reasoning that remains visible." },
			{ type: "text", text: "Conclusion that must remain visible." },
			{ type: "toolCall", id: "t1", name: "bash", arguments: { command: "npm test" } },
		]);
		const component = new AssistantMessageComponent(message);

		decorateMessageUpdate(AssistantMessageComponent.prototype.updateContent, component, [message], SNAPSHOT);

		expect(component.contentContainer.children.some(isThinkingMarkdownLike)).toBe(true);
		expect(component.contentContainer.children.some(isTextMarkdownLike)).toBe(true);
		const text = renderedText(component);
		expect(text).toContain("Reasoning that remains visible.");
		expect(text).toContain("Conclusion that must remain visible.");
	});

	it("keeps mixed text and Pi's truncation notice", () => {
		initTheme("dark", false);
		const message = assistantMessage(
			[
				{ type: "text", text: "Partial but still useful answer." },
				{ type: "toolCall", id: "t1", name: "read", arguments: { path: "x" } },
			],
			"length",
		);
		const component = new AssistantMessageComponent(message);

		decorateMessageUpdate(AssistantMessageComponent.prototype.updateContent, component, [message], SNAPSHOT);

		const text = renderedText(component);
		expect(text).toContain("Partial but still useful answer.");
		expect(text).toContain("Response was truncated");
	});
});
