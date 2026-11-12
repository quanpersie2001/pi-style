import { fileURLToPath, pathToFileURL } from "node:url";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { AssistantMessageComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { normalizeConfig } from "../../extension-src/pi-style/domain/config-normalization.js";
import {
	__resetMessageDecorationTestState,
	setThoughtLabelTheme,
} from "../../extension-src/pi-style/features/messages/index.js";
import { createCompatibilityCoordinator } from "../../extension-src/pi-style/pi/compatibility-coordinator.js";
import {
	disposePiCompatibilityProbe,
	probePiCompatibility,
	retainPiCompatibilityProbe,
	targetSpecs,
} from "../../extension-src/pi-style/pi/compatibility-probe.js";

function message(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
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
		stopReason: "stop",
		timestamp: 1,
	};
}

describe("certified native presentation buffering", () => {
	it("coalesces native rebuilds and renders final delta, invalidation and completion", () => {
		initTheme("dark", false);
		const report = probePiCompatibility("0.85.0", {
			config: normalizeConfig(),
		});
		try {
			expect(
				report.recordSnapshots
					.filter((record) => record.subtype === "native-assistant-message")
					.every((record) => record.shape === "installed"),
			).toBe(true);
			const component = new AssistantMessageComponent(message("initial"));
			const internal = component as unknown as { contentContainer: { clear(): void }; lastMessage: AssistantMessage };
			const rebuild = vi.spyOn(internal.contentContainer, "clear");
			for (let i = 0; i < 1000; i++) component.updateContent(message(`delta ${i}`), true);
			expect(rebuild).not.toHaveBeenCalled();
			expect(internal.lastMessage.content[0]).toMatchObject({ text: "delta 999" });
			expect(component.render(120).join("\n")).toContain("delta 999");
			expect(rebuild).toHaveBeenCalledTimes(1);
			component.updateContent(message("complete"), false);
			expect(component.render(120).join("\n")).toContain("complete");
			component.setOutputPad(3);
			expect(rebuild).toHaveBeenCalledTimes(3);
			component.updateContent(message("pending on disposal"), true);
			disposePiCompatibilityProbe(report);
			expect(component.render(120).join("\n")).toContain("pending on disposal");
		} finally {
			disposePiCompatibilityProbe(report);
		}
	});

	it("installs optimization-only configuration through session authorization", () => {
		initTheme("dark", false);
		const coordinator = createCompatibilityCoordinator();
		coordinator.captureAuthorization(true, true, false, false, false);
		try {
			const config = normalizeConfig({
				messages: {
					assistantPrefix: false,
					hideThinkingLabel: false,
					specialBlocks: false,
					preserveCompactionTranscript: false,
				},
				tools: { enabled: false },
			});
			const report = coordinator.install(config, true);
			expect(report).toBeDefined();
			expect(
				report?.recordSnapshots
					.filter((record) => record.subtype === "native-assistant-message")
					.every((record) => record.shape === "installed"),
			).toBe(true);
			const component = new AssistantMessageComponent(message("initial"));
			component.updateContent(message("next"), true);
			expect(component.render(120).join("\n")).toContain("next");
		} finally {
			coordinator.dispose();
		}
	});

	it("disables buffering when only one retained wrapper can be reclaimed", () => {
		initTheme("dark", false);
		const config = normalizeConfig();
		const first = probePiCompatibility("0.85.0", { config });
		const installedRender = Object.getOwnPropertyDescriptor(AssistantMessageComponent.prototype, "render");
		if (!installedRender) throw new Error("missing assistant render descriptor");
		let second: ReturnType<typeof probePiCompatibility> | undefined;
		try {
			const component = new AssistantMessageComponent(message("initial"));
			component.render(120); // Seed the finished decoration cache.
			Object.defineProperty(AssistantMessageComponent.prototype, "render", {
				...installedRender,
				value: function (this: AssistantMessageComponent, width: number) {
					return installedRender.value.call(this, width);
				},
			});
			retainPiCompatibilityProbe(first);
			second = probePiCompatibility("0.85.0", { config });
			// Old renderer survives under the foreign wrapper, updater is replaced.
			component.updateContent(message("fresh"), false);
			expect(component.render(120).join("\n")).toContain("fresh");
			component.updateContent(message("streaming after conflict"), true);
			expect(component.render(120).join("\n")).toContain("streaming after conflict");
		} finally {
			Object.defineProperty(AssistantMessageComponent.prototype, "render", installedRender);
			disposePiCompatibilityProbe(first);
			if (second) disposePiCompatibilityProbe(second);
		}
	});

	it("preserves frame output while reducing native rebuilds", () => {
		initTheme("dark", false);
		const run = (enabled: boolean) => {
			const report = probePiCompatibility("1.5.2", {
				config: normalizeConfig(),
				assistantPresentation: enabled,
			});
			try {
				const component = new AssistantMessageComponent(message("initial"));
				const internal = component as unknown as {
					contentContainer: { clear(): void; render(width: number): string[] };
				};
				const rebuild = vi.spyOn(internal.contentContainer, "clear");
				const output: string[][] = [];
				for (let frame = 0; frame < 8; frame++) {
					for (let delta = 0; delta < 4; delta++) {
						component.updateContent(message(`**frame ${frame}**, delta ${delta}`), true);
					}
					output.push(component.render(120));
				}
				const streamingRebuilds = rebuild.mock.calls.length;
				component.updateContent(message("complete"), false);
				const nativeRender = vi.spyOn(internal.contentContainer, "render");
				for (let i = 0; i < 20; i++) output.push(component.render(120));
				return { output, streamingRebuilds, finishedNativeRenders: nativeRender.mock.calls.length };
			} finally {
				disposePiCompatibilityProbe(report);
			}
		};
		const baseline = run(false);
		const buffered = run(true);
		expect(buffered.output).toEqual(baseline.output);
		expect(baseline.streamingRebuilds).toBe(32);
		expect(buffered.streamingRebuilds).toBe(8);
		expect(baseline.finishedNativeRenders).toBe(20);
		expect(buffered.finishedNativeRenders).toBe(20);
	});

	it.each(["index.js", "bundle/index.js"])("preserves decorated mixed/many-block frames on %s", async (artifact) => {
		const root = fileURLToPath(new URL("../../node_modules/@earendil-works/pi-coding-agent/", import.meta.url));
		const host: typeof import("@earendil-works/pi-coding-agent") = await import(
			pathToFileURL(`${root}dist/${artifact}`).href
		);
		host.initTheme("dark", false);
		const specs = targetSpecs.filter((spec) => spec.subtype === "native-assistant-message");
		expect(specs).toHaveLength(2);
		const targets = specs.map((spec) => spec.target);
		for (const spec of specs) spec.target = host.AssistantMessageComponent.prototype;
		const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
		try {
			for (const hidden of [true, false]) {
				const run = (enabled: boolean) => {
					__resetMessageDecorationTestState();
					setThoughtLabelTheme({ fg: (_color, text) => text });
					const report = probePiCompatibility("1.5.2", {
						config: normalizeConfig(),
						assistantPresentation: enabled,
						messageSnapshot: {
							assistantPrefix: "│ ",
							assistantEnabled: true,
							collapseHiddenThinking: true,
							thoughtSummary: true,
						},
					});
					try {
						expect(
							report.recordSnapshots
								.filter((r) => r.subtype === "native-assistant-message")
								.every((r) => r.shape === "installed"),
						).toBe(true);
						const component = new host.AssistantMessageComponent(message("initial"), hidden, undefined, "");
						const internal = component as unknown as {
							contentContainer: { clear(): void; render(width: number): string[] };
						};
						const rebuild = vi.spyOn(internal.contentContainer, "clear");
						const render = vi.spyOn(internal.contentContainer, "render");
						const output: string[][] = [];
						const content: AssistantMessage["content"] = [];
						let latest = message("");
						for (let frame = 0; frame < 8; frame++) {
							if (frame % 2 === 0) content.push({ type: "thinking", thinking: `Thought ${frame}` });
							else
								content.push(
									...Array.from({ length: 20 }, (_, i) => ({
										type: "text" as const,
										text: `Block ${frame}/${i}: **answer**\n\n\`\`\`ts\nconst value = ${i};\n\`\`\``,
									})),
								);
							for (let delta = 0; delta < 4; delta++) {
								latest = {
									...message(""),
									content: content.map((part, i) =>
										i === content.length - 1 && part.type === "thinking"
											? { ...part, thinking: `${part.thinking} delta ${delta}` }
											: part,
									),
								};
								delete (latest as Partial<AssistantMessage>).stopReason;
								component.updateContent(latest, true);
							}
							// Carry the completed thought text forward unchanged into the next frame.
							content.splice(0, content.length, ...latest.content);
							output.push(component.render(120));
						}
						const streamingRebuilds = rebuild.mock.calls.length;
						const streamingRenders = render.mock.calls.length;
						// Terminal tool call: no synthetic tool UI or manual isStreaming mutation.
						latest = {
							...latest,
							content: [
								...latest.content,
								{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "README.md" } },
							],
							stopReason: "toolUse",
						};
						component.updateContent(latest, false);
						for (let i = 0; i < 20; i++) output.push(component.render(120));
						const finishedRenders = render.mock.calls.length - streamingRenders;
						output.push(component.render(80));
						component.render(80)[0] = "caller mutation";
						output.push(component.render(80));
						component.setOutputPad(2);
						output.push(component.render(80));
						component.setHideThinkingBlock(!hidden);
						output.push(component.render(80));
						component.updateContent(message("replacement"), false);
						output.push(component.render(80));
						return { output, streamingRebuilds, streamingRenders, finishedRenders };
					} finally {
						disposePiCompatibilityProbe(report);
					}
				};
				const baseline = run(false);
				const buffered = run(true);
				expect(buffered.output).toEqual(baseline.output);
				expect(baseline.streamingRebuilds).toBe(32);
				expect(buffered.streamingRebuilds).toBe(8);
				expect([baseline.streamingRenders, buffered.streamingRenders]).toEqual([8, 8]);
				expect([baseline.finishedRenders, buffered.finishedRenders]).toEqual([20, 20]);
				expect(baseline.output[8].length).toBeGreaterThan(400);
			}
		} finally {
			clock.mockRestore();
			specs.forEach((spec, i) => {
				spec.target = targets[i];
			});
			__resetMessageDecorationTestState();
		}
	});

	it("leaves unauthorized native updates immediate", () => {
		initTheme("dark", false);
		const report = probePiCompatibility("0.85.0", { config: normalizeConfig(), assistantPresentation: false });
		try {
			const component = new AssistantMessageComponent(message("initial"));
			const internal = component as unknown as { contentContainer: { clear(): void } };
			const rebuild = vi.spyOn(internal.contentContainer, "clear");
			for (let i = 0; i < 10; i++) component.updateContent(message(String(i)), true);
			expect(rebuild).toHaveBeenCalledTimes(10);
		} finally {
			disposePiCompatibilityProbe(report);
		}
	});
});
