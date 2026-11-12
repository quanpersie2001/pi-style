import { deepStrictEqual, strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { cpus } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type * as Pi from "@earendil-works/pi-coding-agent";
import { bench, describe, vi } from "vitest";
import { normalizeConfig } from "../../extension-src/pi-style/domain/config-normalization.js";
import {
	__resetMessageDecorationTestState,
	setThoughtLabelTheme,
} from "../../extension-src/pi-style/features/messages/index.js";
import {
	disposePiCompatibilityProbe,
	probePiCompatibility,
	targetSpecs,
} from "../../extension-src/pi-style/pi/compatibility-probe.js";

// Explicit, non-CI: npx vitest bench --run test/performance/presentation-buffer.bench.ts
const root = fileURLToPath(new URL("../../node_modules/@earendil-works/pi-coding-agent/", import.meta.url));
const version = JSON.parse(readFileSync(`${root}package.json`, "utf8")).version;
strictEqual(version, "1.5.2");
console.info(
	JSON.stringify({
		node: process.version,
		platform: process.platform,
		arch: process.arch,
		cpu: cpus()[0]?.model,
		version,
	}),
);
const frames = 24;
const finishedRenders = 100;
const snapshot = {
	assistantPrefix: "│ ",
	assistantEnabled: true,
	collapseHiddenThinking: true,
	thoughtSummary: true,
};
function message(content: AssistantMessage["content"], done = false): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "fixture",
		timestamp: 1,
		// Streaming events do not yet have a stop reason. Tool calls end the message;
		// the assistant renderer never renders the separately owned tool UI.
		...(done
			? { stopReason: content.some((part) => part.type === "toolCall") ? ("toolUse" as const) : ("stop" as const) }
			: {}),
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	} as AssistantMessage;
}
function blocks(count: number): AssistantMessage["content"] {
	return Array.from({ length: count }, (_, i) => ({
		type: "text" as const,
		text: `Block ${i}: **Markdown** and inline \`code\`.\n\n\`\`\`ts\nconst value${i} = ${i};\nconsole.log(value${i});\n\`\`\`\nEnd of block ${i}.`,
	}));
}
for (const artifact of ["index.js", "bundle/index.js"]) {
	const host: typeof Pi = await import(pathToFileURL(`${root}dist/${artifact}`).href);
	host.initTheme("dark", false);
	// Same isolated target redirection as identity-artifacts.test.ts: the CLI's
	// bundled class is distinct from the modular import used by the probe.
	const assistantSpecs = targetSpecs.filter((spec) => spec.subtype === "native-assistant-message");
	strictEqual(assistantSpecs.length, 2);
	const originalTargets = assistantSpecs.map((spec) => spec.target);
	for (const spec of assistantSpecs) spec.target = host.AssistantMessageComponent.prototype;
	try {
		for (const workload of ["mixed", "many-blocks", "large-finished"]) {
			for (const updatesPerFrame of [1, 8]) {
				const base = workload === "mixed" ? [] : blocks(workload === "many-blocks" ? 48 : 160);
				const updates = Array.from({ length: frames * updatesPerFrame }, (_, i) => {
					const frame = Math.floor(i / updatesPerFrame);
					const content = [...base];
					if (workload === "mixed") {
						// Monotonic thinking -> text segments; every open run is observed at a
						// frame before closure. The last frame introduces a terminal tool call.
						for (let segment = 0; segment <= Math.min(frame, frames - 2); segment++) {
							content.push(
								segment % 2 === 0
									? {
											type: "thinking",
											thinking: `Reasoning ${segment}:${" detail".repeat(segment === frame ? (i % updatesPerFrame) + 1 : updatesPerFrame)}`,
										}
									: {
											type: "text",
											text: `Answer ${segment}: **result**\n\n\`\`\`ts\nconst result = ${segment};\n\`\`\``,
										},
							);
						}
						if (frame === frames - 1)
							content.push({ type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } });
					} else content.push({ type: "text", text: `Streaming tail ${"word ".repeat(i + 1)}` });
					return message(content);
				});
				const final = message(updates[updates.length - 1].content, true);
				function run(mode: "disabled" | "streaming-only") {
					const enabled = mode !== "disabled";
					__resetMessageDecorationTestState();
					setThoughtLabelTheme({ fg: (_color, text) => text });
					const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
					const report = probePiCompatibility(version, {
						config: normalizeConfig(),
						assistantPresentation: enabled,
						messageSnapshot: snapshot,
					});
					try {
						strictEqual(
							report.recordSnapshots
								.filter((r) => r.subtype === "native-assistant-message")
								.every((r) => r.shape === "installed"),
							true,
						);
						const component = new host.AssistantMessageComponent(message([]), true, undefined, "");
						const internal = component as unknown as {
							contentContainer: { clear(): void; render(width: number): string[] };
						};
						let rebuilds = 0;
						let renders = 0;
						const clear = internal.contentContainer.clear;
						const nativeRender = internal.contentContainer.render;
						internal.contentContainer.clear = function () {
							rebuilds++;
							return clear.call(this);
						};
						internal.contentContainer.render = function (width) {
							renders++;
							return nativeRender.call(this, width);
						};
						const output: string[][] = [];
						let updateMs = 0;
						let renderMs = 0;
						const start = performance.now();
						for (let frame = 0; frame < frames; frame++) {
							const updateStart = performance.now();
							for (let delta = 0; delta < updatesPerFrame; delta++)
								component.updateContent(updates[frame * updatesPerFrame + delta], true);
							updateMs += performance.now() - updateStart;
							const renderStart = performance.now();
							output.push(component.render(120));
							renderMs += performance.now() - renderStart;
						}
						const streamingMs = performance.now() - start;
						const streamingRebuilds = rebuilds;
						const streamingRenders = renders;
						const finishedStart = performance.now();
						component.updateContent(final, false);
						const finalizeMs = performance.now() - finishedStart;
						const repeatStart = performance.now();
						for (let i = 0; i < finishedRenders; i++) output.push(component.render(120));
						const finishedMs = performance.now() - repeatStart;
						const counts = {
							streamingRebuilds,
							streamingRenders,
							finalizedRebuilds: rebuilds - streamingRebuilds,
							finishedRenders: renders - streamingRenders,
						};
						// Untimed output ownership/freshness probes.
						output.push(component.render(80));
						component.render(80)[0] = "caller mutation";
						output.push(component.render(80));
						component.setOutputPad(2);
						output.push(component.render(80));
						component.updateContent(message([{ type: "text", text: "replacement" }], true), false);
						output.push(component.render(80));
						return { output, counts, streamingMs, updateMs, renderMs, finalizeMs, finishedMs };
					} finally {
						disposePiCompatibilityProbe(report);
						clock.mockRestore();
					}
				}
				const baseline = run("disabled");
				const streamingOnly = run("streaming-only");
				deepStrictEqual(streamingOnly.output, baseline.output);
				deepStrictEqual(streamingOnly.counts, { ...baseline.counts, streamingRebuilds: frames });
				strictEqual(baseline.counts.streamingRebuilds, frames * updatesPerFrame);
				strictEqual(streamingOnly.counts.streamingRebuilds, frames);
				for (const result of [baseline, streamingOnly]) {
					strictEqual(result.counts.streamingRenders, frames);
					strictEqual(result.counts.finalizedRebuilds, 1);
				}
				strictEqual(baseline.counts.finishedRenders, finishedRenders);
				strictEqual(streamingOnly.counts.finishedRenders, finishedRenders);
				const samples: Record<string, number[]> = {};
				const modes = ["disabled", "streaming-only"] as const;
				for (let i = 0; i < 2; i++) {
					for (const mode of modes) run(mode);
				}
				for (let i = 0; i < 9; i++) {
					// Alternate first position between the two production paths.
					for (let j = 0; j < modes.length; j++) {
						const mode = modes[(i + j) % modes.length];
						const result = run(mode);
						deepStrictEqual(result.output, baseline.output);
						for (const phase of ["streamingMs", "updateMs", "renderMs", "finalizeMs", "finishedMs"] as const) {
							const key = `${mode}.${phase}`;
							samples[key] ??= [];
							samples[key].push(result[phase]);
						}
					}
				}
				const milliseconds = Object.fromEntries(
					Object.entries(samples).map(([key, values]) => {
						const sorted = [...values].sort((a, b) => a - b);
						return [key, { min: sorted[0], median: sorted[4], max: sorted[8] }];
					}),
				);
				console.info(
					JSON.stringify({
						artifact,
						workload,
						frames,
						updatesPerFrame,
						finishedRenders,
						finalLines: baseline.output[frames].length,
						parity: true,
						counts: { disabled: baseline.counts, streamingOnly: streamingOnly.counts },
						milliseconds,
					}),
				);
				describe(`${artifact}: ${workload}, ${updatesPerFrame} updates/frame`, () => {
					// Whole-workload numbers include probe/reset overhead; phase JSON is the decision evidence.
					for (const mode of modes)
						bench(
							mode,
							() => {
								run(mode);
							},
							{ time: 100, iterations: 2 },
						);
				});
			}
		}
	} finally {
		assistantSpecs.forEach((spec, i) => {
			spec.target = originalTargets[i];
		});
	}
}
