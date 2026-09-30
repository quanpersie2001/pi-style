import { Container, Text } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { decorateCompactionTranscript } from "../../extension-src/pi-style/features/messages/compaction-transcript.js";

interface FakeMode {
	chatContainer: Container;
	addedMessages: unknown[];
	addMessageToChat(message: unknown): void;
	addCompactionCostNotice(notice: unknown): void;
	footer: { invalidate(): void };
	ui: { requestRender(): void };
}

function fakeMode(): FakeMode {
	const mode = {
		chatContainer: new Container(),
		addedMessages: [] as unknown[],
		addMessageToChat(message: unknown) {
			mode.addedMessages.push(message);
		},
		addCompactionCostNotice(notice: unknown) {
			mode.addedMessages.push(notice);
		},
		footer: { invalidate: vi.fn() },
		ui: { requestRender: vi.fn() },
	};
	return mode;
}

function compactionEvent(overrides: Record<string, unknown> = {}) {
	return {
		type: "compaction_end",
		aborted: false,
		result: { summary: "the summary", tokensBefore: 1234, usage: { total: 1 } },
		...overrides,
	};
}

/** Native-like handler: clears the chat, renders retained entries, appends the
 * summary through addMessageToChat, then fires the remaining side effects. */
function nativeHandler(this: FakeMode, event: { result?: { summary: string; usage?: unknown } }) {
	this.chatContainer.clear();
	this.chatContainer.addChild(new Text("retained entry"));
	this.addMessageToChat({ role: "compactionSummary", summary: event.result?.summary ?? "", native: true });
	this.footer.invalidate();
	this.ui.requestRender();
	return "native-return";
}

describe("decorateCompactionTranscript", () => {
	it("preserves the transcript on a completed compaction and appends the summary via native routing", () => {
		const mode = fakeMode();
		const sentinel = new Text("pre-compaction message");
		mode.chatContainer.addChild(sentinel);

		const original = vi.fn(nativeHandler);
		const result = decorateCompactionTranscript(original, mode as unknown as object, [compactionEvent()]);

		expect(result).toBe("native-return");
		expect(original).toHaveBeenCalledTimes(1);
		// The native clear-and-rerender hit the detached sink, not the real chat.
		expect(mode.chatContainer.children).toContain(sentinel);
		expect(mode.chatContainer.children).toHaveLength(1);
		// The summary block was appended into the preserved transcript through
		// addMessageToChat (native spacing + expanded-state sync routing); the
		// native-path message went to the sink first and carries the marker.
		const summary = mode.addedMessages.find(
			(message) =>
				(message as { role?: string }).role === "compactionSummary" &&
				(message as { native?: boolean }).native === undefined,
		) as { summary?: string; tokensBefore?: number; native?: boolean } | undefined;
		expect(summary?.summary).toBe("the summary");
		expect(summary?.tokensBefore).toBe(1234);
		// The cost notice followed (native usage reporting).
		expect(mode.addedMessages.some((m) => (m as { type?: string }).type === "compaction_cost")).toBe(true);
		expect(mode.footer.invalidate).toHaveBeenCalled();
		expect(mode.ui.requestRender).toHaveBeenCalled();
	});

	it("passes non-compaction and aborted events through without swapping the container", () => {
		const mode = fakeMode();
		const sentinel = new Text("sentinel");
		mode.chatContainer.addChild(sentinel);

		const original = vi.fn(function (this: FakeMode, _event: unknown) {
			// Observes the container identity the native code would mutate.
			return this.chatContainer;
		});
		for (const event of [
			{ type: "message_end" },
			{ type: "compaction_end", aborted: true, reason: "manual" },
			{ type: "compaction_end", errorMessage: "boom" },
			undefined,
		]) {
			const observed = decorateCompactionTranscript(original, mode as unknown as object, [event]);
			expect(observed).toBe(mode.chatContainer);
		}
		expect(original).toHaveBeenCalledTimes(4);
		expect(mode.chatContainer.children).toContain(sentinel);
		expect(mode.addedMessages).toHaveLength(0);
	});

	it("fails closed to the native clear-and-rerender when the shape is unsupported", () => {
		const mode = fakeMode();
		const broken = mode as unknown as { addMessageToChat?: unknown };
		delete broken.addMessageToChat;

		const original = vi.fn(function (this: FakeMode) {
			this.chatContainer.clear();
			return "native";
		});
		const result = decorateCompactionTranscript(original, mode as unknown as object, [compactionEvent()]);
		expect(result).toBe("native");
		expect(mode.chatContainer.children).toHaveLength(0);
	});

	it("restores the real container even when the native handler throws", () => {
		const mode = fakeMode();
		const sentinel = new Text("sentinel");
		mode.chatContainer.addChild(sentinel);

		const original = vi.fn(function (this: FakeMode) {
			this.chatContainer.clear();
			throw new Error("entries missing");
		});
		expect(() => decorateCompactionTranscript(original, mode as unknown as object, [compactionEvent()])).toThrow(
			"entries missing",
		);
		expect(mode.chatContainer).toBeDefined();
		expect(mode.chatContainer.children).toContain(sentinel);
	});

	it("rejects malformed result payloads to the native path", () => {
		const mode = fakeMode();
		const original = vi.fn(() => "native");
		const result = decorateCompactionTranscript(original, mode as unknown as object, [
			compactionEvent({ result: { summary: 42 } }),
		]);
		expect(result).toBe("native");
		expect(mode.addedMessages).toHaveLength(0);
	});
});

describe("decorateCompactionTranscript — async handler timing", () => {
	it("keeps the sink installed until a suspended native handler settles, then restores and appends", async () => {
		const mode = fakeMode();
		const sentinel = new Text("sentinel");
		mode.chatContainer.addChild(sentinel);

		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const original = vi.fn(function (this: FakeMode) {
			// Simulates the `await this.init()` suspension before the switch: the
			// compaction case runs only after the gate resolves.
			return gate.then(() => {
				this.chatContainer.clear();
				this.chatContainer.addChild(new Text("retained"));
				return "native-return";
			});
		});
		const real = mode.chatContainer;
		const resultPromise = decorateCompactionTranscript(original, mode as unknown as object, [
			compactionEvent(),
		]) as Promise<unknown>;

		// Pending: the swap is still active — the field points at the sink while
		// the real chat (with the sentinel) waits, and no summary was appended yet.
		expect(mode.chatContainer).not.toBe(real);
		expect(real.children).toContain(sentinel);
		expect(mode.addedMessages).toHaveLength(0);

		release();
		await expect(resultPromise).resolves.toBe("native-return");
		// The native clear hit the sink; the real transcript survived and now
		// carries the appended summary (plus the cost notice).
		expect(mode.chatContainer.children).toContain(sentinel);
		expect(mode.chatContainer.children).toHaveLength(1);
		expect(
			mode.addedMessages.some(
				(message) =>
					(message as { role?: string }).role === "compactionSummary" &&
					(message as { native?: boolean }).native === undefined,
			),
		).toBe(true);
		expect(mode.addedMessages.some((m) => (m as { type?: string }).type === "compaction_cost")).toBe(true);
	});

	it("restores the container when a suspended native handler rejects", async () => {
		const mode = fakeMode();
		const sentinel = new Text("sentinel");
		mode.chatContainer.addChild(sentinel);

		const original = vi.fn(() => Promise.reject(new Error("late failure")));
		const resultPromise = decorateCompactionTranscript(original, mode as unknown as object, [
			compactionEvent(),
		]) as Promise<unknown>;
		await expect(resultPromise).rejects.toThrow("late failure");
		expect(mode.chatContainer.children).toContain(sentinel);
		expect(mode.addedMessages).toHaveLength(0);
	});
});
