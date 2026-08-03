import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../../extension-src/pi-style/domain/config-normalization.js";
import { installStartup } from "../../extension-src/pi-style/features/startup/index.js";
import piStyleExtension, { __setCompatibilityTestHooks } from "../../extension-src/pi-style/pi/index.js";
import { FakePiHost } from "../helpers/fake-pi-host.js";

function injectedStartupConfig(mode: "compact" | "overlay") {
	let document = JSON.stringify({ piStyle: { schemaVersion: 1, startup: { mode } } });
	return {
		port: {
			read: async (path: string) => (path === "global" ? document : "{}"),
			writeAtomic: async (_path: string, content: string) => {
				document = content;
			},
		},
		paths: () => ({ globalPath: "global", projectPath: "project" }),
	};
}

describe("startup lifecycle integration", () => {
	const snapshot = { reason: "startup" as const, model: "test", thinkingLevel: "high" as const };
	const compact = normalizeConfig({ startup: { mode: "compact" } });
	it("acquires an empty observable header and restores it exactly", () => {
		let owner: unknown;
		const host = {
			mode: "tui",
			hasUI: true,
			setHeader: (value: unknown) => (owner = value),
			getHeaderFactory: () => owner,
		};
		const installation = installStartup({ host, config: compact, snapshot, generation: 1 });
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
		expect(installStartup({ host, config: compact, snapshot, generation: 1 })).toBeUndefined();
		owner = undefined;
		const installation = installStartup({ host, config: compact, snapshot, generation: 2 });
		const later = () => [];
		owner = later;
		installation?.dispose();
		expect(owner).toBe(later);
	});
	it("uses the public header API by default and falls back to the widget", () => {
		let header: unknown;
		let widget: unknown;
		const headerHost = {
			mode: "tui",
			hasUI: true,
			setHeader: (value: unknown) => (header = value),
		};
		const headerInstallation = installStartup({ host: headerHost, config: compact, snapshot, generation: 1 });
		expect(header).toBeTypeOf("function");
		headerInstallation?.dispose();
		expect(header).toBeUndefined();

		const widgetHost = {
			mode: "tui",
			hasUI: true,
			setWidget: (_key: string, value: unknown) => (widget = value),
		};
		const widgetInstallation = installStartup({ host: widgetHost, config: compact, snapshot, generation: 2 });
		expect(widget).toBeTypeOf("function");
		widgetInstallation?.dispose();

		const noSurface = { mode: "tui", hasUI: true };
		expect(installStartup({ host: noSurface, config: compact, snapshot, generation: 3 })).toBeUndefined();
	});
	it("installs the compact startup header without replacing status widgets", async () => {
		const host = new FakePiHost();
		const settings = injectedStartupConfig("compact");
		const reset = __setCompatibilityTestHooks({ filePort: settings.port, paths: settings.paths });
		try {
			piStyleExtension(host.extensionApi);
			await host.sessionStart();
			expect(host.currentHeaderFactory).toBeDefined();
			expect(host.widgets.has("pi-style.startup")).toBe(false);
			expect(host.widgets.has("pi-style.status.primary")).toBe(true);
			await host.sessionShutdown();
			expect(host.currentHeaderFactory).toBeUndefined();
		} finally {
			reset();
		}
	});

	it("mounts an overlay with responsive options and dismisses it on shutdown", async () => {
		const host = new FakePiHost();
		piStyleExtension(host.extensionApi);
		await host.sessionStart();
		await host.sessionShutdown();
		expect(host.overlays.length).toBe(0);

		const overlayHost = new FakePiHost();
		const settings = injectedStartupConfig("overlay");
		const reset = __setCompatibilityTestHooks({ filePort: settings.port, paths: settings.paths });
		try {
			piStyleExtension(overlayHost.extensionApi);
			await overlayHost.sessionStart();
			expect(overlayHost.overlays.length).toBe(1);
			expect(overlayHost.overlays[0]?.options).toBeDefined();
		} finally {
			reset();
		}
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
		const settings = injectedStartupConfig("compact");
		const reset = __setCompatibilityTestHooks({ filePort: settings.port, paths: settings.paths });
		try {
			piStyleExtension(host.extensionApi);
			await host.sessionStart();
			expect(host.currentHeaderFactory).toBeDefined();
			expect(host.overlays).toHaveLength(0);
			await host.sessionShutdown();
		} finally {
			reset();
		}
	});

	it("dismisses startup on agent start without affecting status widgets", async () => {
		const host = new FakePiHost();
		const settings = injectedStartupConfig("compact");
		const reset = __setCompatibilityTestHooks({ filePort: settings.port, paths: settings.paths });
		try {
			piStyleExtension(host.extensionApi);
			await host.sessionStart();
			expect(host.currentHeaderFactory).toBeDefined();
			await host.emit("agent_start", { type: "agent_start" });
			expect(host.widgets.has("pi-style.status.primary")).toBe(true);
			await host.sessionShutdown();
		} finally {
			reset();
		}
	});
});
