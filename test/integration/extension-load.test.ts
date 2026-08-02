import { initTheme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executePiStyleCommand } from "../../extension-src/pi-style/app/command-service.js";
import { disposePiCompatibilityProbe } from "../../extension-src/pi-style/pi/compatibility-probe.js";
import {
	__setCompatibilityRegistryTestHooks,
	currentGeneration,
} from "../../extension-src/pi-style/pi/compatibility-registry.js";
import piStyleExtension from "../../extension-src/pi-style/pi/index.js";
import { createPiStyleSessionCoordinator } from "../../extension-src/pi-style/pi/session-coordinator.js";
import { FakePiHost } from "../helpers/fake-pi-host.js";
import { expectNoTerminalUi } from "../helpers/render-assertions.js";

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

describe("pi-style extension lifecycle foundation", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("loads and registers lifecycle handlers without pre-session resources or UI", () => {
		const host = new FakePiHost();
		expect(() => piStyleExtension(host.extensionApi)).not.toThrow();
		expect(host.handlers.has("session_start")).toBe(true);
		expect(host.handlers.has("session_shutdown")).toBe(true);
		expect(host.commands.has("pi-style")).toBe(true);
		expect(host.registeredTools).toHaveLength(0);
		expect(host.registeredMessageRenderers.size).toBe(0);
		expect(host.registeredEntryRenderers.size).toBe(0);
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

	it("retains real rejected prototype cleanup and retries before a new generation", async () => {
		const native = Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render");
		let blocked = true;
		let restoreAttempts = 0;
		const resetRegistry = __setCompatibilityRegistryTestHooks({
			defineProperty: (target, key, descriptor) => {
				if (target === UserMessageComponent.prototype && key === "render" && descriptor.value === native?.value) {
					restoreAttempts++;
					if (blocked) return false;
				}
				return Reflect.defineProperty(target, key, descriptor);
			},
		});
		try {
			const host = new FakePiHost({ flags: { "pi-style-core-patches": true, "pi-style-message-user": true } });
			piStyleExtension(host.extensionApi);
			await host.sessionStart();
			const installed = Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render");
			const generation = currentGeneration();
			expect(installed?.value).not.toBe(native?.value);
			await host.sessionShutdown();
			expect(restoreAttempts).toBe(1);
			expect(Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value).toBe(installed?.value);
			await host.sessionStart();
			// Incomplete cleanup is retryable but must not create a new generation or install over the live owner.
			expect(currentGeneration()).toBe(generation);
			expect(Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value).toBe(installed?.value);
			await host.sessionShutdown();
			expect(restoreAttempts).toBe(3);
			blocked = false;
			await host.sessionStart();
			expect(currentGeneration()).toBe(generation + 1);
			expect(Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value).not.toBe(native?.value);
			await host.sessionShutdown();
			expect(Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value).toBe(native?.value);
		} finally {
			resetRegistry();
		}
	});

	it("replaces runtime ownership on start-to-start and suppresses stale replacement on cleanup failure", async () => {
		const host = new FakePiHost();
		const coordinator = createPiStyleSessionCoordinator(host.extensionApi);
		await coordinator.start({ reason: "startup" }, host.extensionContext);
		const first = coordinator.app.runtime.current;
		expect(first).toBeDefined();
		await coordinator.start({ reason: "reload" }, host.extensionContext);
		const second = coordinator.app.runtime.current;
		expect(first?.disposed).toBe(true);
		expect(second).toBeDefined();
		expect(second).not.toBe(first);
		expect(second?.generation).toBeGreaterThan(first?.generation ?? 0);
		await coordinator.shutdown();
	});

	it("disposes old runtime and starts fresh runtime after incomplete cleanup retry", async () => {
		let attempts = 0;
		const host = new FakePiHost({ flags: { "pi-style-core-patches": true, "pi-style-message-user": true } });
		const coordinator = createPiStyleSessionCoordinator(host.extensionApi, {
			dispose: (report) => {
				attempts++;
				const result = disposePiCompatibilityProbe(report);
				return attempts < 2 ? { ...result, complete: false, retryablePrototypeRecords: 1 } : result;
			},
		});
		await coordinator.start({ reason: "startup" }, host.extensionContext);
		const first = coordinator.app.runtime.current;
		await coordinator.start({ reason: "reload" }, host.extensionContext);
		expect(first?.disposed).toBe(true);
		expect(coordinator.app.runtime.current).toBeUndefined();
		await coordinator.start({ reason: "reload" }, host.extensionContext);
		expect(coordinator.app.runtime.current).toBeDefined();
		expect(coordinator.app.runtime.current).not.toBe(first);
		coordinator.shutdown();
	});

	it("recomputes deny-only policy across raw sources, session commands, and reload", async () => {
		const native = Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value;
		const run = async (global: unknown, project: unknown, trusted: boolean, expectInstall: boolean) => {
			const host = new FakePiHost({
				flags: { "pi-style-core-patches": true, "pi-style-message-user": true },
				projectTrusted: trusted,
			});
			const port = {
				read: async (path: string) => JSON.stringify({ piStyle: path === "global" ? global : project }),
				writeAtomic: async () => {},
			};
			const coordinator = createPiStyleSessionCoordinator(host.extensionApi, {
				filePort: port,
				paths: () => ({ globalPath: "global", projectPath: "project" }),
			});
			coordinator.app.setProjectTrusted(trusted);
			await coordinator.start({ reason: "startup" }, host.extensionContext);
			await executePiStyleCommand(
				"set compatibility.allowCorePatches true",
				host.extensionContext as never,
				coordinator.app,
				{ port, paths: { globalPath: "global", projectPath: "project" } },
			);
			const doctor = coordinator.app.doctor() as { operational: { authorization: { productCorePatchGate: string } } };
			expect(doctor.operational.authorization.productCorePatchGate).toBe(expectInstall ? "omitted" : "deny");
			expect(Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value === native).toBe(
				!expectInstall,
			);
			await executePiStyleCommand("reload", host.extensionContext as never, coordinator.app, {
				port,
				paths: { globalPath: "global", projectPath: "project" },
			});
			expect(Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value === native).toBe(
				!expectInstall,
			);
			coordinator.shutdown();
		};
		await run({ compatibility: { allowCorePatches: false }, messages: { enabled: true } }, {}, true, false);
		await run({}, { compatibility: { allowCorePatches: false }, messages: { enabled: true } }, true, false);
		await run({}, { compatibility: { allowCorePatches: false }, messages: { enabled: true } }, false, true);
	});

	it("retains effective lower-source provenance through direct session mutation and real reload", async () => {
		const host = new FakePiHost();
		const document = {
			global: JSON.stringify({ piStyle: { tools: { maxCollapsedLines: 7 } } }),
			project: "{}",
		};
		const port = {
			read: async (path: string) => document[path === "global" ? "global" : "project"],
			writeAtomic: async () => {},
		};
		const coordinator = createPiStyleSessionCoordinator(host.extensionApi, {
			filePort: port,
			paths: () => ({ globalPath: "global", projectPath: "project" }),
		});
		await coordinator.start({ reason: "startup" }, host.extensionContext);
		const identity = (item: { code: string; level: string; path: string; message: string }) =>
			`${item.code}|${item.level}|${item.path}|${item.message}`;
		coordinator.app.applySession({ tools: { maxCollapsedLines: "bad" } });
		let state = coordinator.app.doctor() as {
			diagnostics: Array<{ code: string; level: string; path: string; message: string }>;
			sources: Record<string, string>;
		};
		expect(coordinator.app.config.tools.maxCollapsedLines).toBe(7);
		expect(state.sources["tools.maxCollapsedLines"]).toBe("global");
		expect(state.diagnostics.map(identity).filter((value) => value.includes("tools.maxCollapsedLines"))).toEqual([
			"CFG-VALUE|warning|tools.maxCollapsedLines|invalid or unknown field ignored",
		]);

		coordinator.app.applySession({ tools: { maxCollapsedLines: 5 } });
		expect(coordinator.app.config.tools.maxCollapsedLines).toBe(5);
		expect((coordinator.app.doctor().sources as Record<string, string>)["tools.maxCollapsedLines"]).toBe("session");
		coordinator.app.applySession({ tools: { maxCollapsedLines: "bad" } });
		state = coordinator.app.doctor() as typeof state;
		expect(coordinator.app.config.tools.maxCollapsedLines).toBe(7);
		expect(state.sources["tools.maxCollapsedLines"]).toBe("global");
		expect(state.diagnostics.map(identity).filter((value) => value.includes("tools.maxCollapsedLines"))).toEqual([
			"CFG-VALUE|warning|tools.maxCollapsedLines|invalid or unknown field ignored",
		]);
		await executePiStyleCommand("reload", host.extensionContext as never, coordinator.app, {
			port,
			paths: { globalPath: "global", projectPath: "project" },
		});
		state = coordinator.app.doctor() as typeof state;
		expect(coordinator.app.config.tools.maxCollapsedLines).toBe(7);
		expect(state.sources["tools.maxCollapsedLines"]).toBe("global");
		expect(state.diagnostics.map(identity).filter((value) => value.includes("tools.maxCollapsedLines"))).toEqual([
			"CFG-VALUE|warning|tools.maxCollapsedLines|invalid or unknown field ignored",
		]);
		await host.sessionShutdown();
	});

	it("falls back to the default source when an invalid session leaf has no durable source", async () => {
		const host = new FakePiHost();
		const port = {
			read: async () => "{}",
			writeAtomic: async () => {},
		};
		const coordinator = createPiStyleSessionCoordinator(host.extensionApi, {
			filePort: port,
			paths: () => ({ globalPath: "global", projectPath: "project" }),
		});
		await coordinator.start({ reason: "startup" }, host.extensionContext);
		coordinator.app.applySession({ tools: { maxCollapsedLines: "bad" } });
		const state = coordinator.app.doctor() as {
			sources: Record<string, string>;
		};
		expect(coordinator.app.config.tools.maxCollapsedLines).toBe(10);
		expect(state.sources["tools.maxCollapsedLines"]).toBe("default");
		expect(state.sources["tools.maxCollapsedLines"]).not.toBeUndefined();
		expect(state.sources["tools.maxCollapsedLines"]).not.toBe("session");
		await host.sessionShutdown();
	});

	it("deduplicates durable diagnostics and preserves lower-source provenance", async () => {
		const host = new FakePiHost();
		const port = {
			read: async (path: string) =>
				JSON.stringify({ piStyle: path === "global" ? { tools: { maxCollapsedLines: "bad" } } : {} }),
			writeAtomic: async () => {},
		};
		const coordinator = createPiStyleSessionCoordinator(host.extensionApi, {
			filePort: port,
			paths: () => ({ globalPath: "global", projectPath: "project" }),
		});
		await coordinator.start({ reason: "startup" }, host.extensionContext);
		const identity = (item: { code: string; level: string; path: string; message: string }) =>
			`${item.code}|${item.level}|${item.path}|${item.message}`;
		const first = coordinator.app.doctor() as {
			diagnostics: Array<{ code: string; level: string; path: string; message: string }>;
		};
		const firstIds = first.diagnostics.map(identity).filter((value) => value.includes("tools.maxCollapsedLines"));
		expect(firstIds).toHaveLength(1);
		coordinator.app.applySession({ placement: "below" });
		const second = coordinator.app.doctor() as {
			diagnostics: Array<{ code: string; level: string; path: string; message: string }>;
		};
		expect(second.diagnostics.map(identity).filter((value) => value.includes("tools.maxCollapsedLines"))).toEqual(
			firstIds,
		);
		await executePiStyleCommand("reload", host.extensionContext as never, coordinator.app, {
			port,
			paths: { globalPath: "global", projectPath: "project" },
		});
		const third = coordinator.app.doctor() as {
			diagnostics: Array<{ code: string; level: string; path: string; message: string }>;
			sources: Record<string, string>;
			config: { tools?: { maxCollapsedLines: number } };
		};
		expect(third.diagnostics.map(identity).filter((value) => value.includes("tools.maxCollapsedLines"))).toEqual(
			firstIds,
		);
		expect(third.config.tools?.maxCollapsedLines ?? 10).toBe(10);
		expect(third.sources["tools.maxCollapsedLines"]).toBe("default");
		coordinator.shutdown();
	});

	it("denies product-only and surface-only compatibility authorization", async () => {
		const native = Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value;
		for (const flags of [{}, { "pi-style-message-user": true }]) {
			const host = new FakePiHost({ flags });
			piStyleExtension(host.extensionApi);
			await host.sessionStart();
			expect(Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value).toBe(native);
			await host.sessionShutdown();
		}
	});

	it("disables and re-enables authorized compatibility through the command path", async () => {
		const native = Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value;
		const host = new FakePiHost({ flags: { "pi-style-core-patches": true, "pi-style-message-user": true } });
		piStyleExtension(host.extensionApi);
		await host.sessionStart();
		const installed = Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value;
		expect(installed).not.toBe(native);
		const command = host.commands.get("pi-style") as {
			handler(args: string, context: typeof host.extensionContext): Promise<void>;
		};
		await command.handler("off", host.extensionContext);
		expect(Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value).toBe(native);
		await command.handler("on", host.extensionContext);
		expect(Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value).not.toBe(native);
		await host.sessionShutdown();
	});

	it("transitions each public surface off and on through real commands", async () => {
		const host = new FakePiHost();
		piStyleExtension(host.extensionApi);
		await host.sessionStart();
		const command = host.commands.get("pi-style") as {
			handler(args: string, context: typeof host.extensionContext): Promise<void>;
		};
		await command.handler("surface status off", host.extensionContext);
		expect(host.widgets.has("pi-style.status.primary")).toBe(false);
		await command.handler("doctor", host.extensionContext);
		const statusDoctor = JSON.parse(host.notifications.at(-1)?.message ?? "{}");
		expect(statusDoctor.operational.installations.status).toBe("disabled");
		await command.handler("surface status on", host.extensionContext);
		expect(host.widgets.has("pi-style.status.primary")).toBe(true);
		await command.handler("doctor", host.extensionContext);
		const statusOnDoctor = JSON.parse(host.notifications.at(-1)?.message ?? "{}");
		expect(statusOnDoctor.operational.installations.status).toBe("installed");
		await command.handler("surface editor off", host.extensionContext);
		expect(host.ownership.editor.current).toBe(false);
		await command.handler("doctor", host.extensionContext);
		const editorOffDoctor = JSON.parse(host.notifications.at(-1)?.message ?? "{}");
		expect(editorOffDoctor.operational.installations.editor).toBe("disabled");
		await command.handler("surface editor on", host.extensionContext);
		expect(host.ownership.editor.current).toBe(true);
		await command.handler("doctor", host.extensionContext);
		const editorOnDoctor = JSON.parse(host.notifications.at(-1)?.message ?? "{}");
		expect(["installed", "preserved"]).toContain(editorOnDoctor.operational.installations.editor);
		await command.handler("surface startup off", host.extensionContext);
		expect(host.widgets.has("pi-style.startup")).toBe(false);
		expect(host.currentHeaderFactory).toBeUndefined();
		await command.handler("doctor", host.extensionContext);
		const startupOffDoctor = JSON.parse(host.notifications.at(-1)?.message ?? "{}");
		expect(startupOffDoctor.operational.installations.startup).toBe("disabled");
		await command.handler("surface startup on", host.extensionContext);
		expect(host.widgets.has("pi-style.startup") || host.currentHeaderFactory !== undefined).toBe(true);
		await command.handler("doctor", host.extensionContext);
		const startupOnDoctor = JSON.parse(host.notifications.at(-1)?.message ?? "{}");
		expect(startupOnDoctor.operational.installations.startup).toBe("installed");
		await host.sessionShutdown();
	});

	it("preserves provider identity across config-only reconciliation", async () => {
		const host = new FakePiHost();
		piStyleExtension(host.extensionApi);
		await host.sessionStart();
		const before = host.componentFactories.get("pi-style.status.primary");
		const command = host.commands.get("pi-style") as {
			handler(args: string, context: typeof host.extensionContext): Promise<void>;
		};
		await command.handler("placement below", host.extensionContext);
		expect(host.componentFactories.get("pi-style.status.primary")).not.toBe(before);
		expect(host.ownership.footer.current).toBe(false);
		await host.sessionShutdown();
	});

	it("exposes live doctor state after session start and command reload", async () => {
		const host = new FakePiHost();
		piStyleExtension(host.extensionApi);
		await host.sessionStart();
		const command = host.commands.get("pi-style") as {
			handler(args: string, context: typeof host.extensionContext): Promise<void>;
		};
		const output: string[] = [];
		host.extensionContext.ui.notify = (message) => output.push(message);
		await command.handler("reload", host.extensionContext);
		await command.handler("doctor", host.extensionContext);
		const state = JSON.parse(output.at(-1) ?? "{}");
		expect(state.sources).toBeDefined();
		expect(state.operational).toBeDefined();
		expect(state.operational.provider).toBeDefined();
		expect(state.operational.compatibility).toMatchObject({
			configuredByProduct: true,
			authorized: false,
			installed: false,
		});
		expect(state.operational.installations).toBeDefined();
		await host.sessionShutdown();
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

	it.each([
		[{ preset: "ascii" }, { "pi-style-core-patches": true, "pi-style-message-user": true }, "❯ "],
		[
			{ preset: "default" },
			{ "pi-style-core-patches": true, "pi-style-message-user": true, "pi-style-ascii": true },
			"[user] ",
		],
	] as const)("uses original ASCII authorization for installed user markers", async (config, flags, marker) => {
		const native = Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value;
		const host = new FakePiHost({ flags });
		const settings = injectedSettings(config);
		const coordinator = createPiStyleSessionCoordinator(host.extensionApi, {
			filePort: settings.port,
			paths: settings.paths,
		});
		await coordinator.start({ reason: "startup" }, host.extensionContext);
		initTheme("dark", false);
		expect(Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value).not.toBe(native);
		const output = new UserMessageComponent("installed marker sentinel").render(120).join("\\n");
		expect(output).toContain(marker);
		expect(output).not.toContain(marker === "❯ " ? "[user] " : "❯ ");
		coordinator.shutdown();
	});

	it("leaves the native prototype untouched for persisted ASCII without original authorization", async () => {
		const native = Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value;
		const host = new FakePiHost({ flags: {} });
		const coordinator = createPiStyleSessionCoordinator(host.extensionApi, injectedSettings({ preset: "ascii" }));
		await coordinator.start({ reason: "startup" }, host.extensionContext);
		expect(Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value).toBe(native);
		coordinator.shutdown();
	});

	it("reports cleanup pending through command off/on and reinstalls only after restoration", async () => {
		const native = Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render");
		let blocked = true;
		const reset = __setCompatibilityRegistryTestHooks({
			defineProperty: (target, key, descriptor) => {
				if (
					target === UserMessageComponent.prototype &&
					key === "render" &&
					descriptor.value === native?.value &&
					blocked
				)
					return false;
				return Reflect.defineProperty(target, key, descriptor);
			},
		});
		try {
			const host = new FakePiHost({ flags: { "pi-style-core-patches": true, "pi-style-message-user": true } });
			piStyleExtension(host.extensionApi);
			await host.sessionStart();
			const command = host.commands.get("pi-style") as {
				handler(args: string, context: typeof host.extensionContext): Promise<void>;
			};
			const installed = Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value;
			const generation = currentGeneration();
			await command.handler("off", host.extensionContext);
			expect(Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value).toBe(installed);
			await command.handler("on", host.extensionContext);
			// Incomplete cleanup suppresses replacement installation and remains retryable.
			expect(currentGeneration()).toBe(generation);
			await command.handler("doctor", host.extensionContext);
			expect(JSON.parse(host.notifications.at(-1)?.message ?? "{}").operational.compatibility.cleanupPending).toBe(
				true,
			);
			blocked = false;
			await command.handler("off", host.extensionContext);
			await command.handler("on", host.extensionContext);
			expect(currentGeneration()).toBe(generation + 1);
			await host.sessionShutdown();
		} finally {
			reset();
		}
	});

	it("keeps product deny and source-backed session provenance across reload", async () => {
		const denyNative = Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value;
		const denyHost = new FakePiHost({ flags: { "pi-style-core-patches": true, "pi-style-message-user": true } });
		const denyInjected = injectedSettings({ schemaVersion: 1, messages: { enabled: false } });
		const denyCoordinator = createPiStyleSessionCoordinator(denyHost.extensionApi, {
			filePort: denyInjected.port,
			paths: denyInjected.paths,
		});
		await denyCoordinator.start({ reason: "startup" }, denyHost.extensionContext);
		expect(Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value).toBe(denyNative);
		const denyDoctor = denyCoordinator.app.doctor() as { operational: { compatibility: Record<string, unknown> } };
		expect(denyDoctor.operational.compatibility.userMessage).toMatchObject({
			configured: false,
			authorized: true,
			installed: false,
		});
		expect(denyDoctor.operational.compatibility.userMessage).not.toHaveProperty("awaitingAuthorization");
		denyCoordinator.shutdown();
		expect(Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value).toBe(denyNative);

		const awaitingNative = Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value;
		const awaitingHost = new FakePiHost({ flags: {} });
		const awaitingInjected = injectedSettings({ messages: { enabled: true } });
		const awaitingCoordinator = createPiStyleSessionCoordinator(awaitingHost.extensionApi, {
			filePort: awaitingInjected.port,
			paths: awaitingInjected.paths,
		});
		await awaitingCoordinator.start({ reason: "startup" }, awaitingHost.extensionContext);
		expect(Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value).toBe(awaitingNative);
		const awaitingDoctor = awaitingCoordinator.app.doctor() as {
			operational: { compatibility: Record<string, unknown> };
		};
		expect(awaitingDoctor.operational.compatibility.userMessage).toMatchObject({
			configured: true,
			authorized: false,
			installed: false,
			awaitingAuthorization: true,
		});
		awaitingCoordinator.shutdown();
		expect(Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value).toBe(awaitingNative);

		const authorizedNative = Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value;
		const authorizedHost = new FakePiHost({ flags: { "pi-style-core-patches": true, "pi-style-message-user": true } });
		const authorizedInjected = injectedSettings({ messages: { enabled: true } });
		const authorizedCoordinator = createPiStyleSessionCoordinator(authorizedHost.extensionApi, {
			filePort: authorizedInjected.port,
			paths: authorizedInjected.paths,
		});
		await authorizedCoordinator.start({ reason: "startup" }, authorizedHost.extensionContext);
		expect(Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value).not.toBe(authorizedNative);
		const authorizedDoctor = authorizedCoordinator.app.doctor() as {
			operational: { compatibility: Record<string, unknown> };
		};
		expect(authorizedDoctor.operational.compatibility.userMessage).toMatchObject({
			configured: true,
			authorized: true,
			installed: true,
		});
		authorizedCoordinator.shutdown();
		expect(Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value).toBe(authorizedNative);

		const host = new FakePiHost({ flags: { "pi-style-core-patches": true, "pi-style-message-user": true } });
		let source = { placement: "above", editor: { style: "compact" }, messages: { enabled: true }, schemaVersion: 1 };
		const settings = {
			port: {
				read: async (path: string) => (path === "global" ? JSON.stringify({ piStyle: source }) : "{}"),
				writeAtomic: async () => {},
			},
			paths: () => ({ globalPath: "global", projectPath: "project" }),
		};
		const commandStorage = { port: settings.port, paths: settings.paths() };
		const coordinator = createPiStyleSessionCoordinator(host.extensionApi, {
			filePort: settings.port,
			paths: settings.paths,
		});
		await coordinator.start({ reason: "startup" }, host.extensionContext);
		const context = host.extensionContext as never;
		await executePiStyleCommand("placement below", context, coordinator.app, commandStorage);
		source = { placement: "above", editor: { style: "boxed" }, messages: { enabled: true }, schemaVersion: 1 };
		await executePiStyleCommand("reload", context, coordinator.app, commandStorage);
		expect(coordinator.app.config.placement).toBe("below");
		expect((coordinator.app.doctor().sources as Record<string, string>).placement).toBe("session");
		expect(coordinator.app.config.editor.style).toBe("boxed");
		expect((coordinator.app.doctor().sources as Record<string, string>)["editor.style"]).toBe("global");
		coordinator.shutdown();
	});

	it("keeps print/json prototypes native after command mutation and reload", async () => {
		const native = Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value;
		for (const mode of ["print", "json"] as const) {
			const host = new FakePiHost({ mode, flags: { "pi-style-core-patches": true, "pi-style-message-user": true } });
			piStyleExtension(host.extensionApi);
			await host.sessionStart();
			const command = host.commands.get("pi-style") as {
				handler(args: string, context: typeof host.extensionContext): Promise<void>;
			};
			await command.handler("on", host.extensionContext);
			await command.handler("reload", host.extensionContext);
			expect(Object.getOwnPropertyDescriptor(UserMessageComponent.prototype, "render")?.value).toBe(native);
			await host.sessionShutdown();
		}
	});
});
