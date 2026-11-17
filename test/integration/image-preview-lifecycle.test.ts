import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMessagesRenderConfig } from "../../extension-src/pi-style/features/messages/render-config.js";
import piStyleExtension from "../../extension-src/pi-style/pi/index.js";
import { FakePiHost } from "../helpers/fake-pi-host.js";

// Isolate the adapter's staging/timer lifecycle from session UI/config resources.
vi.mock("../../extension-src/pi-style/pi/session-coordinator.js", () => ({
	createPiStyleSessionCoordinator: () => ({
		app: { update: vi.fn(), runtime: {} },
		start: vi.fn(),
		shutdown: vi.fn(),
		invalidateTools: vi.fn(),
	}),
}));

const image = { type: "image" as const, data: "original-image-bytes", mimeType: "image/png" };

async function stage(host: FakePiHost, data = image.data) {
	await host.emit("before_agent_start", {
		type: "before_agent_start",
		messageType: "user",
		prompt: "look",
		images: [{ ...image, data }],
		systemPrompt: "",
	});
}

async function startMessage(host: FakePiHost, role: "user" | "assistant") {
	await host.emit("message_start", { type: "message_start", message: { role, content: [] } } as never);
}

const boundaries = ["shutdown", "start", "tree"] as const;
async function replace(host: FakePiHost, boundary: (typeof boundaries)[number]) {
	if (boundary === "shutdown") await host.sessionShutdown();
	else if (boundary === "start") await host.sessionStart();
	else await host.emit("session_tree", { type: "session_tree", oldLeafId: "old", newLeafId: "new" });
}

function setup() {
	const host = new FakePiHost();
	piStyleExtension(host.extensionApi);
	return host;
}

beforeEach(() => {
	vi.useFakeTimers();
	resetMessagesRenderConfig();
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.clearAllTimers();
	vi.useRealTimers();
	resetMessagesRenderConfig();
});

describe("prompt preview staging lifecycle", () => {
	it.each(boundaries)("clears staged bytes on session %s before any flush is scheduled", async (boundary) => {
		const host = setup();
		await stage(host);
		await replace(host, boundary);
		await startMessage(host, "assistant");
		await startMessage(host, "user");
		await vi.advanceTimersByTimeAsync(0);
		expect(host.appendedEntries).toEqual([]);
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each(boundaries)("cancels a scheduled flush on session %s and permits a fresh preview", async (boundary) => {
		const host = setup();
		await stage(host);
		await startMessage(host, "user");
		expect(vi.getTimerCount()).toBe(1);
		await replace(host, boundary);
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(0);
		expect(host.appendedEntries).toEqual([]);
		await stage(host, "fresh-image-bytes");
		await startMessage(host, "user");
		await vi.advanceTimersByTimeAsync(0);
		expect(host.appendedEntries).toEqual([
			{
				customType: "pi-style-image-preview",
				data: { images: [{ data: "fresh-image-bytes", mimeType: image.mimeType }] },
			},
		]);
	});

	it("ignores an obsolete callback without losing the replacement timer", async () => {
		const host = setup();
		const timers = vi.spyOn(globalThis, "setTimeout");
		await stage(host);
		await startMessage(host, "user");
		const obsoleteFlush = timers.mock.calls.at(-1)?.[0] as () => void;
		await host.sessionShutdown();
		await stage(host, "fresh-image-bytes");
		await startMessage(host, "user");
		obsoleteFlush();
		expect(host.appendedEntries).toEqual([]);
		await startMessage(host, "assistant");
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(0);
		expect(host.appendedEntries).toHaveLength(1);
		expect(host.appendedEntries[0]?.data).toEqual({
			images: [{ data: "fresh-image-bytes", mimeType: image.mimeType }],
		});
	});

	it.each(["leaf", null])("preserves a pending preview when tree navigation keeps leaf %s", async (leaf) => {
		const host = setup();
		await stage(host);
		await startMessage(host, "user");
		await host.emit("session_tree", { type: "session_tree", oldLeafId: leaf, newLeafId: leaf });
		await vi.advanceTimersByTimeAsync(0);
		expect(host.appendedEntries[0]?.data).toEqual({ images: [{ data: image.data, mimeType: image.mimeType }] });
		expect(host.appendedEntries).toHaveLength(1);
	});

	it("retains deferred ordering, custom-run staging and the assistant-start fallback without duplicates", async () => {
		const host = setup();
		await stage(host, "superseded");
		await stage(host);
		await host.emit("before_agent_start", {
			type: "before_agent_start",
			messageType: "custom",
			message: { role: "custom", customType: "test", content: "run", display: false, timestamp: 0 },
			systemPrompt: "",
		});
		await startMessage(host, "user");
		expect(host.appendedEntries).toEqual([]);
		await startMessage(host, "assistant");
		expect(host.appendedEntries[0]?.data).toEqual({ images: [{ data: image.data, mimeType: image.mimeType }] });
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(0);
		await startMessage(host, "assistant");
		expect(host.appendedEntries).toHaveLength(1);
	});
});
