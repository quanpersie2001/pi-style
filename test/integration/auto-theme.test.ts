import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { targetSpecs } from "../../extension-src/pi-style/pi/compatibility-probe.js";
import { getCompatibilityRecords } from "../../extension-src/pi-style/pi/compatibility-registry.js";
import { createPiStyleSessionCoordinator } from "../../extension-src/pi-style/pi/session-coordinator.js";
import { FakePiHost } from "../helpers/fake-pi-host.js";
import { createFakeTheme } from "../helpers/fake-theme.js";

function injectedSettings(config: unknown) {
	let document = JSON.stringify({ piStyle: { schemaVersion: 1, ...(config as Record<string, unknown>) } });
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

describe("pi-style auto theme", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => {
		vi.useRealTimers();
		// The coordinator installs Tier C patches when the host is certified;
		// restore every wrapper so the shared prototype registry stays clean.
		for (const spec of targetSpecs) {
			for (const record of getCompatibilityRecords(spec.target)) record.disposer();
		}
	});

	const startCoordinator = async (host: FakePiHost, config: unknown) => {
		const settings = injectedSettings(config);
		const coordinator = createPiStyleSessionCoordinator(host.extensionApi, {
			filePort: settings.port,
			paths: settings.paths,
		});
		await coordinator.start({ reason: "startup" }, host.extensionContext);
		return coordinator;
	};

	it("auto-applies titanium at TUI session start when the active theme differs", async () => {
		const host = new FakePiHost({
			themeName: "dark",
			themes: { dark: createFakeTheme({ name: "dark" }), titanium: createFakeTheme({ name: "titanium" }) },
		});
		const coordinator = await startCoordinator(host, {});
		expect(host.setThemeCalls).toEqual(["titanium"]);
		expect(host.theme.name).toBe("titanium");
		coordinator.shutdown();
	});

	it("skips the switch when titanium is already the active theme", async () => {
		const host = new FakePiHost({
			themeName: "titanium",
			themes: { titanium: createFakeTheme({ name: "titanium" }) },
		});
		const coordinator = await startCoordinator(host, {});
		expect(host.setThemeCalls).toEqual([]);
		expect(host.theme.name).toBe("titanium");
		coordinator.shutdown();
	});

	it("respects theme.autoApply off", async () => {
		const host = new FakePiHost({
			themeName: "dark",
			themes: { dark: createFakeTheme({ name: "dark" }), titanium: createFakeTheme({ name: "titanium" }) },
		});
		const coordinator = await startCoordinator(host, { theme: { autoApply: "off" } });
		expect(host.setThemeCalls).toEqual([]);
		expect(host.theme.name).toBe("dark");
		coordinator.shutdown();
	});

	it("never passes an unresolvable theme name to Pi's setTheme", async () => {
		// No titanium in the registry: the coordinator must not call setTheme,
		// because Pi's setTheme falls back to the dark theme on load error.
		const host = new FakePiHost({
			themeName: "dark",
			themes: { dark: createFakeTheme({ name: "dark" }) },
		});
		const coordinator = await startCoordinator(host, {});
		expect(host.setThemeCalls).toEqual([]);
		expect(host.theme.name).toBe("dark");
		coordinator.shutdown();
	});

	it("keeps non-TUI sessions untouched", async () => {
		const host = new FakePiHost({
			mode: "rpc",
			themeName: "dark",
			themes: { dark: createFakeTheme({ name: "dark" }), titanium: createFakeTheme({ name: "titanium" }) },
		});
		const coordinator = await startCoordinator(host, {});
		expect(host.setThemeCalls).toEqual([]);
		expect(host.theme.name).toBe("dark");
		coordinator.shutdown();
	});
});
