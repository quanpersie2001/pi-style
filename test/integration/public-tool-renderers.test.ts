// Real public resolution and production extension/coordinator, both native artifacts.
import type { ToolRendererResolver, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakePiHost } from "../helpers/fake-pi-host.js";

let resetBatchRegistry: typeof import("../../extension-src/pi-style/features/tools/boxed/batch.js")["resetBatchRegistry"];
let turns: typeof import("../../extension-src/pi-style/features/tools/boxed/turn-summary.js");
let targetSpecs: typeof import("../../extension-src/pi-style/pi/compatibility-probe.js")["targetSpecs"];
let getCompatibilityRecords: typeof import("../../extension-src/pi-style/pi/compatibility-registry.js")["getCompatibilityRecords"];
let publicToolRendererBridge: typeof import("../../extension-src/pi-style/features/tools/public-renderers.js")["publicToolRendererBridge"];

import { stripAnsi } from "../../extension-src/pi-style/shared/ansi.js";

const root = new URL("../../node_modules/@earendil-works/pi-coding-agent/", import.meta.url);
const loader = await import(new URL("dist/core/extensions/loader.js", root).href);
const visible = (tools: Array<{ render(w: number): string[] }>) =>
	tools
		.flatMap((t) => t.render(100))
		.map(stripAnsi)
		.filter((l) => l.trim());
const result = { content: [{ type: "text", text: "fixture output" }], details: {}, isError: false };

afterEach(() => {
	for (const spec of targetSpecs) for (const record of getCompatibilityRecords(spec.target)) record.disposer();
	resetBatchRegistry();
	turns.resetTurnRegistry();
	vi.doUnmock("@earendil-works/pi-coding-agent");
	vi.useRealTimers();
});

for (const entry of ["dist/index.js", "dist/bundle/index.js"]) {
	describe(`production hybrid: ${entry}`, () => {
		async function setup(options: ConstructorParameters<typeof FakePiHost>[0] = {}) {
			const pi = await import(new URL(entry, root).href);
			pi.initTheme("dark", false);
			// Pi's CLI gives extensions bundled class objects via jiti aliases.
			// Reproduce that boundary, rather than patching a second prototype by hand.
			vi.resetModules();
			vi.doMock("@earendil-works/pi-coding-agent", () => pi);
			const { default: piStyleExtension, __setCompatibilityTestHooks } = await import(
				"../../extension-src/pi-style/pi/index.js"
			);
			({ resetBatchRegistry } = await import("../../extension-src/pi-style/features/tools/boxed/batch.js"));
			turns = await import("../../extension-src/pi-style/features/tools/boxed/turn-summary.js");
			({ targetSpecs } = await import("../../extension-src/pi-style/pi/compatibility-probe.js"));
			({ getCompatibilityRecords } = await import("../../extension-src/pi-style/pi/compatibility-registry.js"));
			({ publicToolRendererBridge } = await import("../../extension-src/pi-style/features/tools/public-renderers.js"));
			const host = new FakePiHost(options);
			const hooks = {
				filePort: {
					read: async () =>
						JSON.stringify({
							piStyle: {
								tools: { collapseAfterTurn: true },
								messages: { mergedTurnSummary: false },
								startup: { mode: "off" },
							},
						}),
					writeAtomic: async () => {},
				},
				paths: () => ({ globalPath: "global", projectPath: "project" }),
			};
			const reset = __setCompatibilityTestHooks(hooks);
			const runtime = pi.createExtensionRuntime();
			const ext = await loader.loadExtensionFromFactory(
				(api: { registerToolRenderer(r: ToolRendererResolver): void }) => {
					const capture = host.extensionApi.registerToolRenderer;
					if (capture)
						host.extensionApi.registerToolRenderer = (resolver) => {
							capture(resolver);
							api.registerToolRenderer(resolver);
						};
					piStyleExtension(host.extensionApi);
				},
				"/fake",
				pi.createEventBus(),
				runtime,
			);
			reset();
			const runner = new pi.ExtensionRunner([ext], runtime, "/fake", undefined, undefined);
			const native = {
				read: pi.createReadToolDefinition("/fake"),
				write: pi.createWriteToolDefinition("/fake"),
				edit: pi.createEditToolDefinition("/fake"),
				grep: pi.createGrepToolDefinition("/fake"),
				find: pi.createFindToolDefinition("/fake"),
				ls: pi.createLsToolDefinition("/fake"),
				bash: pi.createBashToolDefinition(),
			};
			const resolve = (name: string, downstream = native[name as keyof typeof native]) =>
				runner.resolveToolRenderers(name, () => downstream);
			const make = (name: string, id: string) => {
				const tool = new pi.ToolExecutionComponent(
					name,
					id,
					name === "read" ? { path: `${id}.ts` } : { command: "echo fixture" },
					{},
					resolve(name),
					{ requestRender() {} },
					"/fake",
				);
				tool.updateResult(result);
				return tool;
			};
			const command = host.commands.get("pi-style") as { handler(args: string, ctx: unknown): Promise<void> };
			const set = (path: string, value: string) =>
				command.handler(
					`set ${path} ${["true", "false"].includes(value) ? value : JSON.stringify(value)}`,
					host.extensionContext,
				);
			const tickers = await import("../../extension-src/pi-style/features/tools/boxed/session-config.js");
			return {
				tickers,
				async replacement() {
					const replacement = new FakePiHost();
					const reset = __setCompatibilityTestHooks(hooks);
					piStyleExtension(replacement.extensionApi);
					reset();
					await replacement.sessionStart();
					return replacement;
				},
				pi,
				host,
				native,
				resolve,
				make,
				set,
				start: () => host.sessionStart(),
				restore: () => host.sessionShutdown(),
			};
		}

		it("keeps exact detached callbacks outside certified Main decorators, including same-id rows", async () => {
			const h = await setup();
			await h.start();
			try {
				const key = Symbol.for("pi-style.detached-tool-renderers.v1");
				const ports = globalThis as unknown as Record<symbol, { resolve(name: string): ToolRenderers }>;
				const port = ports[key];
				const main = [h.make("read", "shared"), h.make("read", "main-second")];
				const before = visible(main);
				expect(before.join("\n")).toContain("Read (2)");
				const tickers = h.tickers.__getElapsedTickerDebugState();
				const detached = port.resolve("read");
				const child = new h.pi.ToolExecutionComponent(
					"read",
					"shared",
					{ path: "/child/secret.ts" },
					{ showImages: false },
					detached,
					{ requestRender() {} },
					"/child",
				);
				expect(child.getCallRenderer()).toBe(detached.renderCall);
				expect(child.getResultRenderer()).toBe(detached.renderResult);
				child.markExecutionStarted();
				child.updateResult({ content: [{ type: "text", text: "child-only-output" }], isError: false }, true);
				expect(visible([child]).join("\n")).toContain("child-only-output");
				expect(visible(main)).toEqual(before);
				expect(child.rendererState).toEqual({});
				expect(h.tickers.__getElapsedTickerDebugState()).toEqual(tickers);
				expect(turns.getTurnEntry("shared")).toBeUndefined();
				const lone = new h.pi.ToolExecutionComponent(
					"read",
					"child-only",
					{ path: "/child/lone.ts" },
					{},
					detached,
					{ requestRender() {} },
					"/child",
				);
				lone.markExecutionStarted();
				expect(turns.getTurnEntry("child-only")).toBeUndefined();
				expect(h.tickers.__getElapsedTickerDebugState()).toEqual(tickers);
				const writing = new h.pi.ToolExecutionComponent(
					"write",
					"child-write",
					{ path: "/child/new.ts", content: "new" },
					{},
					port.resolve("write"),
					{ requestRender() {} },
					"/child",
				);
				writing.markExecutionStarted();
				expect(h.tickers.__getElapsedTickerDebugState()).toEqual(tickers);
				expect(visible(main)).toEqual(before);
				turns.registerTurnFromMessage(
					{
						role: "assistant",
						content: [{ type: "toolCall", name: "read", id: "shared", arguments: { path: "shared.ts" } }],
						stopReason: "toolUse",
						timestamp: 1,
					} as never,
					[{ toolCallId: "shared", ...result }],
				);
				const run = turns.finishAgentRun();
				if (!run) throw new Error("missing Main turn");
				turns.invalidateTurnMembers(run);
				main[0].render(100);
				expect(
					main[0].handleMouse({
						type: "click",
						button: "left",
						x: 0,
						y: 1,
						width: 100,
						height: 100,
						originX: 0,
						originY: 0,
					}),
				).toMatchObject({ handled: true });
				expect(main[0].expanded).toBe(true);
				expect(child.expanded).toBe(false);
				const images = await import("@earendil-works/pi-tui");
				const caps = images.getCapabilities();
				try {
					images.setCapabilities({ ...caps, images: null });
					child.setShowImages(true);
					child.updateResult({ content: [{ type: "image", data: "AAAA", mimeType: "image/png" }], isError: false });
					expect(visible([child]).join("\n")).toContain("[image: image/png]");
				} finally {
					images.setCapabilities(caps);
				}
				await h.restore();
				await h.start();
				expect(ports[key]).toBe(port);
				expect(port.resolve("read")).toBeDefined();
			} finally {
				await h.restore();
			}
		});

		it("six eligible default-shell names resolve publicly; native self shells and bash remain legacy", async () => {
			const h = await setup();
			await h.start();
			try {
				for (const name of ["read", "write", "edit", "grep", "find", "ls"] as const) {
					const downstream = h.native[name];
					// Pi 1.5.2's edit definition owns a self shell. Keep that native
					// selection unchanged; also exercise its public callbacks when a
					// downstream resolver explicitly selects the eligible default shell.
					if (downstream.renderShell === "self") expect(h.resolve(name)).toBe(downstream);
					const selected = h.resolve(name, { ...downstream, renderShell: "default" });
					expect(selected.renderShell).toBe("default");
					expect(publicToolRendererBridge(selected.renderCall), name).toBeDefined();
					expect(publicToolRendererBridge(selected.renderResult), name).toBeDefined();
				}
				expect(h.resolve("bash")).toBe(h.native.bash);
			} finally {
				await h.restore();
			}
		});

		it("public read and legacy bash share summary expansion; summary click, Ctrl+O ON/OFF, reopen/close share native flags", async () => {
			const h = await setup();
			await h.start();
			try {
				const tools = [h.make("read", "r1"), h.make("read", "r2"), h.make("bash", "b1")];
				const message = {
					role: "assistant",
					content: [
						{ type: "toolCall", name: "read", id: "r1", arguments: { path: "r1.ts" } },
						{ type: "toolCall", name: "read", id: "r2", arguments: { path: "r2.ts" } },
						{ type: "toolCall", name: "bash", id: "b1", arguments: { command: "echo fixture" } },
					],
					stopReason: "toolUse",
					timestamp: 1,
				};
				turns.registerTurnFromMessage(
					message as never,
					["r1", "r2", "b1"].map((toolCallId) => ({ toolCallId, ...result })),
				);
				const run = turns.finishAgentRun();
				expect(run?.ended).toBe(true);
				if (!run) throw new Error("missing completed run");
				turns.invalidateTurnMembers(run);
				expect(visible(tools)).toHaveLength(1);
				const click = () => {
					tools[0].render(100);
					// Real native mouse routing, including leading Spacer and Box offsets.
					expect(
						tools[0].handleMouse({
							type: "click",
							button: "left",
							x: 0,
							y: 1,
							width: 100,
							height: 100,
							originX: 0,
							originY: 0,
						}),
					).toMatchObject({ handled: true });
				};
				click();
				expect(tools.map((t) => t.expanded)).toEqual([true, true, true]);
				expect(visible(tools).join("\n")).toContain("echo fixture");
				tools.forEach((t) => {
					t.setExpanded(true);
				}); // native global Ctrl+O ON loop
				tools.forEach((t) => {
					t.setExpanded(false);
				}); // native global Ctrl+O OFF loop
				expect(visible(tools)).toHaveLength(1);
				click();
				expect(tools.every((t) => t.expanded)).toBe(true);
				click();
				expect(tools.every((t) => !t.expanded)).toBe(true);
				expect(visible(tools)).toHaveLength(1);
				expect(publicToolRendererBridge(h.resolve("read").renderCall)).toBeDefined();
				expect(h.resolve("bash")).toBe(h.native.bash);
				expect(publicToolRendererBridge(h.resolve("bash").renderResult)).toBeUndefined();
			} finally {
				await h.restore();
			}
		});

		it("ten-member batch has nine truly zero-line members", async () => {
			const h = await setup();
			await h.start();
			try {
				const tools = Array.from({ length: 10 }, (_, i) => h.make("read", `batch${i}`));
				tools.forEach((tool) => {
					tool.invalidate();
				});
				expect(visible(tools).join("\n")).toContain("Read (10)");
				for (const member of tools.slice(1)) expect(member.render(100)).toEqual([]);
				expect(tools[0].render(100)).toHaveLength(8);
			} finally {
				await h.restore();
			}
		});

		it("cached native/compact/marker/OFF and lifecycle gap use production policy", async () => {
			const h = await setup();
			try {
				// Pre-bind rows have a certified retained selector bridge. A callback
				// invoked with no row bridge (e.g. export) is not a live candidate.
				await h.start();
				await h.restore();
				const restored = h.make("read", "restored");
				const nativeLines = restored.render(100);
				const definition = restored.toolDefinition;
				await h.start();
				expect(visible([restored]).join("\n")).toContain("Read");
				await h.set("tools.style", "marker");
				expect(visible([restored]).join("\n")).toContain("[tool] ");
				expect(restored.contentBox.paddingY).toBe(1);
				await h.set("tools.style", "compact-box");
				for (const path of ["enabled", "tools.enabled", "compatibility.allowCorePatches"]) {
					await h.set(path, "false");
					expect(restored.render(100), path).toEqual(nativeLines);
					await h.set(path, "true");
					expect(visible([restored]).join("\n")).toContain("Read");
				}
				expect(restored.toolDefinition).toBe(definition);
				expect(h.host.registeredTools).toEqual([]);
				await h.restore();
				expect(restored.contentBox.paddingY).toBe(1);
				const gap = h.make("read", "restored");
				expect(gap.render(100)).toEqual(nativeLines);
				await h.start();
				expect(visible([gap]).join("\n")).toContain("Read");
			} finally {
				await h.restore();
			}
		});

		it("default-shell extension callbacks follow legacy override policy; self/unknown stay owned", async () => {
			const h = await setup();
			await h.start();
			try {
				const custom = { ...h.native.read, renderCall: () => ({ render: () => ["custom"], invalidate() {} }) };
				const selected = h.resolve("read", custom);
				expect(publicToolRendererBridge(selected.renderCall)).toBeDefined();
				const tool = new h.pi.ToolExecutionComponent(
					"read",
					"custom",
					{ path: "custom.ts" },
					{},
					selected,
					{ requestRender() {} },
					"/fake",
				);
				expect(visible([tool]).join("\n")).toContain("Read");
				const self = { ...custom, renderShell: "self" };
				expect(h.resolve("read", self)).toBe(self);
				expect(h.resolve("unknown", custom)).toBe(custom);
			} finally {
				await h.restore();
			}
		});

		it.each([
			{ flags: { "pi-style-core-patches": false } },
			{ flags: { "pi-style-tools": false } },
			{ mode: "rpc" as const },
		])("OFF authorization gates native-delegate cached public callbacks: %j", async (options) => {
			const h = await setup(options);
			const tool = h.make("read", "off");
			const before = tool.render(100);
			try {
				await h.start();
				expect(tool.render(100)).toEqual(before);
			} finally {
				await h.restore();
			}
		});

		it("replacement coordinator reactivates retained public callback definitions", async () => {
			const h = await setup();
			await h.start();
			await h.restore();
			const gap = h.make("read", "handoff");
			expect(visible([gap]).join("\n")).not.toContain("Read");
			const replacement = await h.replacement();
			try {
				expect(visible([gap]).join("\n")).toContain("Read");
				expect(replacement.registeredTools).toEqual([]);
			} finally {
				await replacement.sessionShutdown();
			}
		});

		it("shutdown does not resurrect elapsed tickers through public or retained legacy selectors", async () => {
			const h = await setup();
			await h.start();
			try {
				const nativeResult = vi.spyOn(h.native.read, "renderResult");
				const running = new h.pi.ToolExecutionComponent(
					"read",
					"running",
					{ path: "running.ts" },
					{},
					h.resolve("read"),
					{ requestRender() {} },
					"/fake",
				);
				running.markExecutionStarted();
				running.updateResult(result, true);
				const legacyRunning = new h.pi.ToolExecutionComponent(
					"bash",
					"legacy-running",
					{ command: "echo fixture" },
					{},
					h.resolve("bash"),
					{ requestRender() {} },
					"/fake",
				);
				legacyRunning.markExecutionStarted();
				expect(h.tickers.__getElapsedTickerDebugState().hasSharedTicker).toBe(true);
				await h.restore();
				expect(nativeResult).not.toHaveBeenCalled();
				running.invalidate();
				const legacy = new h.pi.ToolExecutionComponent(
					"bash",
					"legacy-gap",
					{ command: "echo fixture" },
					{},
					h.native.bash,
					{ requestRender() {} },
					"/fake",
				);
				legacy.markExecutionStarted();
				legacy.invalidate();
				expect(visible([legacy]).join("\n")).toContain("Bash");
				expect(h.tickers.__getElapsedTickerDebugState()).toEqual({ trackedStates: 0, hasSharedTicker: false });
			} finally {
				await h.restore();
			}
		});

		it.each(["compact", "native-to-compact"])(
			"partial public read shutdown leaves no adapter ticker: %s",
			async (mode) => {
				const h = await setup();
				await h.start();
				if (mode === "native-to-compact") await h.set("tools.style", "marker");
				vi.useFakeTimers();
				try {
					const running = new h.pi.ToolExecutionComponent(
						"read",
						"partial-shutdown",
						{ path: "partial.ts" },
						{},
						h.resolve("read"),
						{ requestRender() {} },
						"/fake",
					);
					running.markExecutionStarted();
					running.updateResult(result, true);
					if (mode === "native-to-compact") await h.set("tools.style", "compact-box");
					await h.restore();
					expect(running.isPartial).toBe(true);
					expect(vi.getTimerCount()).toBe(0);
					running.invalidate();
					expect(vi.getTimerCount()).toBe(0);
				} finally {
					await h.restore();
				}
			},
		);

		it("OFF native partial bash output, original renderer state and timers match the untouched native definition", async () => {
			const h = await setup({ flags: { "pi-style-tools": false } });
			await h.start();
			const selected = h.resolve("bash");
			expect(selected).toBe(h.native.bash);
			expect(selected.renderCall).toBe(h.native.bash.renderCall);
			expect(selected.renderResult).toBe(h.native.bash.renderResult);
			vi.useFakeTimers();
			const make = (definition: unknown, id: string) =>
				new h.pi.ToolExecutionComponent(
					"bash",
					id,
					{ command: "echo fixture" },
					{},
					definition,
					{ requestRender() {} },
					"/fake",
				);
			const running = make(selected, "native-partial");
			const baseline = make(h.native.bash, "native-baseline");
			try {
				for (const tool of [running, baseline]) {
					tool.markExecutionStarted();
					tool.updateResult(result, true);
				}
				expect(running.render(100)).toEqual(baseline.render(100));
				expect(visible([running]).join("\n")).toContain("fixture output");
				expect(running.isPartial).toBe(true);
				expect(vi.getTimerCount()).toBe(2); // two native rows, not adapter subscriptions
				vi.advanceTimersByTime(1000);
				expect(running.render(100)).toEqual(baseline.render(100));
				await h.restore();
				expect(vi.getTimerCount()).toBe(2); // shutdown must neither repaint nor clear native-owned clocks
			} finally {
				// Real terminal result delivery owns native timer cleanup; no production
				// lifecycle code fabricates completion or touches opaque timer fields.
				running.updateResult(result);
				baseline.updateResult(result);
				await h.restore();
			}
			expect(vi.getTimerCount()).toBe(0);
		});

		it("real HTML export cannot replace a live row invalidator with the same tool ID", async () => {
			const h = await setup();
			await h.start();
			const live = h.make("read", "same-export-id");
			await h.set("tools.enabled", "false");
			const nativeLines = live.render(100);
			await h.set("tools.enabled", "true");
			try {
				const { createToolHtmlRenderer } = await import(new URL("dist/core/export-html/tool-renderer.js", root).href);
				const html = createToolHtmlRenderer({ getToolRenderers: h.resolve, theme: h.host.theme, cwd: "/fake" });
				const exportTool = () => {
					expect(html.renderCall("same-export-id", "read", { path: "same-export-id.ts" })).toBeDefined();
					expect(html.renderResult("same-export-id", "read", result.content, result.details, false)).toBeDefined();
				};
				exportTool();
				await h.set("tools.enabled", "false");
				expect(live.render(100)).toEqual(nativeLines);
				await h.set("tools.enabled", "true");
				exportTool();
				await h.set("tools.style", "marker");
				expect(visible([live]).join("\n")).toContain("[tool] ");
			} finally {
				await h.restore();
			}
		});

		it("branch changes prune callbacks outside the active branch", async () => {
			const h = await setup();
			await h.start();
			try {
				const tool = h.make("read", "old-branch");
				const request = vi.spyOn(tool.ui, "requestRender");
				await h.host.emit("session_tree", { type: "session_tree" } as never);
				request.mockClear();
				await h.set("tools.enabled", "false");
				expect(request).not.toHaveBeenCalled();
			} finally {
				await h.restore();
			}
		});

		it("API absent retains legacy rendering", async () => {
			const h = await setup({ capabilities: { toolRenderers: false } });
			await h.start();
			try {
				expect(h.host.registeredToolRenderers).toEqual([]);
				expect(publicToolRendererBridge(h.resolve("read").renderCall)).toBeUndefined();
				expect(visible([h.make("read", "legacy-read")]).join("\n")).toContain("Read");
				expect(publicToolRendererBridge(h.resolve("bash").renderCall)).toBeUndefined();
				expect(visible([h.make("bash", "legacy")]).join("\n")).toContain("Bash");
			} finally {
				await h.restore();
			}
		});
	});
}
