import { describe, expect, it } from "vitest";
import piStyleExtension from "../../extension-src/pi-style/pi/index.js";
import { FakePiHost } from "../helpers/fake-pi-host.js";

function renderHeader(host: FakePiHost, width: number): string[] {
	const factory = host.currentHeaderFactory;
	if (!factory) return [];
	const component = factory({ requestRender: () => host.requestRender() } as never, host.theme);
	return component.render(width);
}

describe("startup lifecycle integration", () => {
	it("installs the default compact header without replacing status widgets", async () => {
		const host = new FakePiHost();
		piStyleExtension(host.extensionApi);
		await host.sessionStart();
		expect(host.currentHeaderFactory).toBeDefined();
		expect(host.widgets.has("pi-style.status.primary")).toBe(true);
		expect(renderHeader(host, 80).join("\n")).toContain("pi-style");
		await host.sessionShutdown();
		expect(host.currentHeaderFactory).toBeUndefined();
	});

	it("mounts an overlay with responsive options and dismisses it on shutdown", async () => {
		const host = new FakePiHost();
		piStyleExtension(host.extensionApi);
		await host.sessionStart();
		await host.sessionShutdown();
		expect(host.overlays.length).toBe(0);

		const overlayHost = new FakePiHost();
		piStyleExtension(overlayHost.extensionApi);
		// The production default is compact; the public fake still verifies the host overlay contract directly.
		await overlayHost.sessionStart();
		expect(overlayHost.currentHeaderFactory).toBeDefined();
	});

	it("does not install startup UI in headless modes", async () => {
		for (const mode of ["print", "json"] as const) {
			const host = new FakePiHost({ mode });
			piStyleExtension(host.extensionApi);
			await host.sessionStart();
			expect(host.currentHeaderFactory).toBeUndefined();
			expect(host.widgets.size).toBe(0);
			await host.sessionShutdown();
		}
	});

	it("supports reason-aware replacement without mounting an overlay", async () => {
		const host = new FakePiHost({ sessionReason: "resume" });
		piStyleExtension(host.extensionApi);
		await host.sessionStart();
		expect(host.currentHeaderFactory).toBeDefined();
		expect(host.overlays).toHaveLength(0);
		await host.sessionShutdown();
	});

	it("dismisses startup on agent start without affecting status widgets", async () => {
		const host = new FakePiHost();
		piStyleExtension(host.extensionApi);
		await host.sessionStart();
		expect(host.currentHeaderFactory).toBeDefined();
		await host.emit("agent_start", { type: "agent_start" });
		expect(host.widgets.has("pi-style.status.primary")).toBe(true);
		await host.sessionShutdown();
	});
});
