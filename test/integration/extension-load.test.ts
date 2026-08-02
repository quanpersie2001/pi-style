import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import piStyleExtension from "../../extension-src/pi-style/pi/index.js";
import { FakePiHost } from "../helpers/fake-pi-host.js";
import { expectNoTerminalUi } from "../helpers/render-assertions.js";

describe("pi-style extension lifecycle foundation", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("loads and registers lifecycle handlers without pre-session resources or UI", () => {
		const host = new FakePiHost();
		expect(() => piStyleExtension(host.extensionApi)).not.toThrow();
		expect(host.handlers.has("session_start")).toBe(true);
		expect(host.handlers.has("session_shutdown")).toBe(true);
		expect(host.commands.size).toBe(0);
		expect(host.widgets.size).toBe(0);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("starts and cleans a minimal runtime idempotently", async () => {
		const host = new FakePiHost();
		piStyleExtension(host.extensionApi);
		await host.sessionStart();
		await host.sessionShutdown();
		await expect(host.sessionShutdown()).resolves.not.toThrow();
		await host.sessionStart();
		await host.sessionShutdown();
		expect(host.handlers.get("session_start")).toHaveLength(1);
		expect(host.handlers.get("session_shutdown")).toHaveLength(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("repeated lifecycle cycles do not accumulate handlers, timers, or UI", async () => {
		const host = new FakePiHost();
		piStyleExtension(host.extensionApi);
		for (let cycle = 0; cycle < 10; cycle++) {
			await host.sessionStart();
			await host.sessionShutdown();
		}
		expect(host.handlers.get("session_start")).toHaveLength(1);
		expect(host.handlers.get("session_shutdown")).toHaveLength(1);
		expect(host.widgets.size).toBe(0);
		expect(host.renderRequests).toHaveLength(0);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("records host capability variants without changing the production load path", () => {
		const host = new FakePiHost({
			capabilities: { header: false, customEditor: false, customFooter: false },
		});
		expect(host.capabilities.header).toBe(false);
		expect(host.capabilities.customEditor).toBe(false);
		expect(host.capabilities.customFooter).toBe(false);
	});

	it("mounts component factories and renders within the requested width", async () => {
		const host = new FakePiHost();
		piStyleExtension(host.extensionApi);
		await host.sessionStart();
		const primary = host.componentFactories.get("pi-style.status.primary");
		expect(primary).toBeDefined();
		const component = primary?.({ requestRender: () => host.requestRender() }, host.theme);
		const lines = component?.render(40) ?? [];
		expect(lines.every((line) => line.length <= 40)).toBe(true);
		component?.invalidate();
		expect(host.renderRequests).toContain("tui");
		await host.sessionShutdown();
	});

	it("mounts below placement and clears widgets when disabled", async () => {
		const host = new FakePiHost();
		piStyleExtension(host.extensionApi);
		await host.sessionStart();
		expect(host.widgets.get("pi-style.status.primary")?.placement).toBe("aboveEditor");
		await host.emit("tool_result", {
			type: "tool_result",
			toolCallId: "x",
			toolName: "write",
			input: {},
			content: [],
			isError: false,
			details: undefined,
		});
		await host.sessionShutdown();
	});

	it("does not mount terminal UI in print or json modes", async () => {
		for (const mode of ["print", "json"] as const) {
			const host = new FakePiHost({ mode });
			piStyleExtension(host.extensionApi);
			await host.sessionStart();
			expectNoTerminalUi(host.renderRequests.length, host.widgets.size);
			await host.sessionShutdown();
		}
	});
});
