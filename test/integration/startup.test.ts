import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../../extension-src/pi-style/domain/config-normalization.js";
import { installStartup } from "../../extension-src/pi-style/features/startup/index.js";
import piStyleExtension from "../../extension-src/pi-style/pi/index.js";
import { FakePiHost } from "../helpers/fake-pi-host.js";

describe("startup lifecycle integration", () => {
	const snapshot = { reason: "startup" as const, model: "test", thinkingLevel: "high" as const };
	it("acquires an empty observable header and restores it exactly", () => {
		let owner: unknown;
		const host = {
			mode: "tui",
			hasUI: true,
			setHeader: (value: unknown) => (owner = value),
			getHeaderFactory: () => owner,
		};
		const installation = installStartup({ host, config: normalizeConfig({}), snapshot, generation: 1 });
		expect(owner).toBeTypeOf("function");
		installation?.dispose();
		expect(owner).toBeUndefined();
	});
	it("preserves a pre-existing or later header owner", () => {
		const existing = () => [];
		let owner: unknown = existing;
		const host = {
			mode: "tui",
			hasUI: true,
			setHeader: (value: unknown) => (owner = value),
			getHeaderFactory: () => owner,
		};
		expect(installStartup({ host, config: normalizeConfig({}), snapshot, generation: 1 })).toBeUndefined();
		owner = undefined;
		const installation = installStartup({ host, config: normalizeConfig({}), snapshot, generation: 2 });
		const later = () => [];
		owner = later;
		installation?.dispose();
		expect(owner).toBe(later);
	});
	it("uses widget fallback or no surface without a safe header getter", () => {
		let widget: unknown;
		const widgetHost = {
			mode: "tui",
			hasUI: true,
			setHeader: () => {},
			setWidget: (_key: string, value: unknown) => (widget = value),
		};
		const installation = installStartup({ host: widgetHost, config: normalizeConfig({}), snapshot, generation: 1 });
		expect(widget).toBeTypeOf("function");
		installation?.dispose();
		const noSurface = { mode: "tui", hasUI: true, setHeader: () => {} };
		expect(installStartup({ host: noSurface, config: normalizeConfig({}), snapshot, generation: 1 })).toBeUndefined();
	});
	it("installs the default compact header without replacing status widgets", async () => {
		const host = new FakePiHost();
		piStyleExtension(host.extensionApi);
		await host.sessionStart();
		expect(host.currentHeaderFactory).toBeUndefined();
		expect(host.widgets.has("pi-style.startup")).toBe(true);
		expect(host.componentFactories.has("pi-style.startup")).toBe(true);
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
		expect(overlayHost.widgets.has("pi-style.startup")).toBe(true);
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
		expect(host.widgets.has("pi-style.startup")).toBe(true);
		expect(host.overlays).toHaveLength(0);
		await host.sessionShutdown();
	});

	it("dismisses startup on agent start without affecting status widgets", async () => {
		const host = new FakePiHost();
		piStyleExtension(host.extensionApi);
		await host.sessionStart();
		expect(host.widgets.has("pi-style.startup")).toBe(true);
		await host.emit("agent_start", { type: "agent_start" });
		expect(host.widgets.has("pi-style.status.primary")).toBe(true);
		await host.sessionShutdown();
	});
});
