import {
	AssistantMessageComponent,
	createBashToolDefinition,
	createReadToolDefinition,
	initTheme,
	ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { resetBatchRegistry } from "../../extension-src/pi-style/features/tools/boxed/batch.js";
import { resetGrepRegistry } from "../../extension-src/pi-style/features/tools/boxed/grep.js";
import { renderBoxedToolCall, renderBoxedToolResult } from "../../extension-src/pi-style/features/tools/boxed/index.js";
import { setToolsRenderConfig } from "../../extension-src/pi-style/features/tools/boxed/session-config.js";
import {
	finishAgentRun,
	invalidateTurnMembers,
	registerTurnFromMessage,
	resetTurnRegistry,
	toggleTurnOpen,
} from "../../extension-src/pi-style/features/tools/boxed/turn-summary.js";
import {
	disposePiCompatibilityProbe,
	probePiCompatibility,
	targetSpecs,
} from "../../extension-src/pi-style/pi/compatibility-probe.js";
import { getCompatibilityRecords } from "../../extension-src/pi-style/pi/compatibility-registry.js";
import piStyleExtension from "../../extension-src/pi-style/pi/index.js";
import { stripAnsi } from "../../extension-src/pi-style/shared/ansi.js";
import { FakePiHost } from "../helpers/fake-pi-host.js";
import { createFakeTheme } from "../helpers/fake-theme.js";

initTheme(createFakeTheme());
const theme = createFakeTheme();

function baseMessage(content: Array<Record<string, unknown>>, stopReason: string) {
	return {
		role: "assistant",
		content,
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
		stopReason,
		timestamp: 1,
	} as never;
}

function boxedContext(overrides: Record<string, unknown> = {}): never {
	return {
		toolCallId: "call",
		invalidate: () => {},
		args: {},
		state: {},
		cwd: "/fake",
		executionStarted: true,
		argsComplete: true,
		isPartial: false,
		expanded: false,
		showImages: false,
		isError: false,
		lastComponent: undefined,
		...overrides,
	} as never;
}

const click = (y: number) => ({ type: "click", button: "left", y, x: 0 }) as never;

const visibleLines = (lines: readonly string[]) =>
	lines.map((line) => stripAnsi(line ?? "")).filter((l) => l.trim() !== "");

afterEach(() => {
	resetBatchRegistry();
	resetGrepRegistry();
	resetTurnRegistry();
	for (const spec of targetSpecs) {
		for (const record of getCompatibilityRecords(spec.target)) record.disposer();
	}
});

describe("turn-summary click expansion (behavior consistency)", () => {
	it("expands the WHOLE turn from the summary row and re-collapses on the second click", () => {
		setToolsRenderConfig({
			style: "compact-box",
			maxCollapsedLines: 30,
			maxExpandedLines: 60,
			dimOutput: true,
			collapseAfterTurn: true,
			collapseMutatingTools: false,
			batchOpenGlyph: "▾",
			nerdFonts: false,
			mergedTurnSummary: false,
		} as never);
		const report = probePiCompatibility("0.85.0", { toolSnapshot: { style: "compact-box" } });

		const calls: Array<{ name: string; id: string; arguments: Record<string, unknown> }> = [];
		for (let i = 1; i <= 4; i++) calls.push({ name: "read", id: `r${i}`, arguments: { path: `file${i}.ts` } });
		calls.push({ name: "bash", id: "b1", arguments: { command: "echo hi" } });
		calls.push({ name: "TaskUpdate", id: "t1", arguments: { taskId: "1", status: "in_progress" } });
		const message = baseMessage(
			[{ type: "thinking", thinking: "plan" }, ...calls.map((call) => ({ type: "toolCall", ...call }))],
			"toolUse",
		);

		const readDef = createReadToolDefinition("/fake");
		const bashDef = createBashToolDefinition(undefined as never);
		const components: ToolExecutionComponent[] = [];
		new AssistantMessageComponent(message, true, theme, "", 1); // keeps the message pipeline warm
		for (const call of calls) {
			const component = new ToolExecutionComponent(
				call.name,
				call.id,
				call.arguments,
				{},
				call.name === "read" ? (readDef as never) : call.name === "bash" ? (bashDef as never) : ({} as never),
				{ requestRender: () => {} },
				"/fake",
			);
			components.push(component);
			component.updateResult({
				content: [{ type: "text", text: `ok ${call.id}` }],
				details: {},
				isError: false,
			} as never);
		}
		registerTurnFromMessage(
			message,
			calls.map((call) => ({
				toolCallId: call.id,
				isError: false,
				content: [{ type: "text", text: `ok ${call.id}` }],
				details: {},
			})),
		);
		const run = finishAgentRun();
		expect(run?.ended).toBe(true);
		if (run) invalidateTurnMembers(run);

		const render = () => {
			const out: string[] = [];
			for (const component of components) out.push(...component.render(100));
			return out;
		};

		// Collapsed: exactly the one summary row.
		let visible = visibleLines(render());
		expect(visible).toHaveLength(1);
		expect(visible[0]).toContain("Read 4 files");
		expect(visible[0]).toContain("1 TaskUpdate");

		// Click the summary row: the whole turn opens.
		const leader = components[0] as ToolExecutionComponent;
		const summaryRow = leader.callRendererComponent as { handleMouse?: (event: never) => unknown };
		expect(summaryRow.handleMouse?.(click(0))).toEqual({ handled: true });
		visible = visibleLines(render());
		expect(visible.join("\n")).toContain("file1.ts");
		expect(visible.join("\n")).toContain("file4.ts");
		expect(visible.join("\n")).toContain("echo hi");
		expect(visible.join("\n")).toContain("Task Update");
		// The leader keeps its toggle row on top so the turn can close again.
		expect(visible[0]).toContain("Read 4 files");

		// Click the toggle row again: back to the one-line summary.
		const toggleRow = leader.callRendererComponent as { handleMouse?: (event: never) => unknown };
		expect(toggleRow.handleMouse?.(click(0))).toEqual({ handled: true });
		visible = visibleLines(render());
		expect(visible).toHaveLength(1);
		expect(visible[0]).toContain("Read 4 files");

		disposePiCompatibilityProbe(report);
	});

	it("Ctrl+O keeps working on both sides of a click-opened turn", () => {
		setToolsRenderConfig({
			style: "compact-box",
			maxCollapsedLines: 30,
			maxExpandedLines: 60,
			dimOutput: true,
			collapseAfterTurn: true,
			collapseMutatingTools: false,
			batchOpenGlyph: "▾",
			nerdFonts: false,
			mergedTurnSummary: false,
		} as never);
		const report = probePiCompatibility("0.85.0", { toolSnapshot: { style: "compact-box" } });

		const calls = [
			{ name: "read", id: "r1", arguments: { path: "a.ts" } },
			{ name: "read", id: "r2", arguments: { path: "b.ts" } },
		];
		const message = baseMessage(
			calls.map((call) => ({ type: "toolCall", ...call })),
			"toolUse",
		);
		const readDef = createReadToolDefinition("/fake");
		const components: ToolExecutionComponent[] = [];
		for (const call of calls) {
			const component = new ToolExecutionComponent(
				call.name,
				call.id,
				call.arguments,
				{},
				readDef as never,
				{ requestRender: () => {} },
				"/fake",
			);
			components.push(component);
			component.updateResult({
				content: [{ type: "text", text: `ok ${call.id}` }],
				details: {},
				isError: false,
			} as never);
		}
		registerTurnFromMessage(
			message,
			calls.map((call) => ({
				toolCallId: call.id,
				isError: false,
				content: [{ type: "text", text: "ok" }],
				details: {},
			})),
		);
		const run = finishAgentRun();
		if (!run) throw new Error("run did not end");
		invalidateTurnMembers(run);

		const render = () => visibleLines(components.flatMap((c) => c.render(100)));
		expect(render()).toHaveLength(1);

		// Click-open, then Ctrl+O ON: everything stays individually visible.
		const leaderBox = components[0] as ToolExecutionComponent;
		(leaderBox.callRendererComponent as { handleMouse?: (e: never) => unknown }).handleMouse?.(click(0));
		for (const component of components) component.setExpanded(true);
		const expanded = render().join("\n");
		expect(expanded).toContain("a.ts");
		expect(expanded).toContain("b.ts");

		// Native Ctrl+O OFF is authoritative even after an aggregate click.
		// A stale run-open fallback cannot strand visible blocks.
		for (const component of components) component.setExpanded(false);
		const afterOff = render();
		expect(afterOff).toHaveLength(1);
		expect(afterOff[0]).toContain("Read 2 files");
		expect(afterOff.join("\n")).not.toContain("a.ts");

		// The next click reopens the entire turn; the following click recloses.
		(leaderBox.callRendererComponent as { handleMouse?: (e: never) => unknown }).handleMouse?.(click(0));
		expect(render().join("\n")).toContain("b.ts");
		(leaderBox.callRendererComponent as { handleMouse?: (e: never) => unknown }).handleMouse?.(click(0));
		expect(render()).toHaveLength(1);

		disposePiCompatibilityProbe(report);
	});
});

describe("grep panel expansion consistency", () => {
	it("honors Ctrl+O expansion and the header-click toggle like every other tool", () => {
		setToolsRenderConfig({
			style: "compact-box",
			maxCollapsedLines: 30,
			maxExpandedLines: 60,
			dimOutput: true,
			collapseAfterTurn: true,
			collapseMutatingTools: false,
			batchOpenGlyph: "▾",
			nerdFonts: false,
			mergedTurnSummary: false,
		} as never);
		const matches: string[] = [];
		for (let i = 1; i <= 12; i++) matches.push(`src/file${i}.ts:10:match ${i}`);
		const result = { content: [{ type: "text", text: matches.join("\n") }], details: {} } as never;

		// Collapsed panel: head-limited tree.
		let component = renderBoxedToolCall("grep", { pattern: "match" }, theme, boxedContext({ toolCallId: "g1" }));
		renderBoxedToolResult(
			"grep",
			result,
			{ expanded: false, isPartial: false },
			theme,
			boxedContext({ toolCallId: "g1" }),
		);
		let lines = visibleLines(component.render(100));
		expect(lines.some((line) => line.includes("12 matches"))).toBe(true);
		expect(lines.some((line) => line.includes("file12.ts"))).toBe(false); // head-limited

		// Click the header: full tree.
		expect((component as never as { handleMouse: (e: never) => unknown }).handleMouse(click(0))).toEqual({
			handled: true,
		});
		lines = visibleLines(component.render(100));
		expect(lines.some((line) => line.includes("file12.ts"))).toBe(true);

		// Ctrl+O (expanded dispatch) renders the full tree without any click.
		component = renderBoxedToolCall(
			"grep",
			{ pattern: "match" },
			theme,
			boxedContext({ toolCallId: "g2", expanded: true }),
		);
		renderBoxedToolResult(
			"grep",
			result,
			{ expanded: true, isPartial: false },
			theme,
			boxedContext({ toolCallId: "g2", expanded: true }),
		);
		lines = visibleLines(component.render(100));
		expect(lines.some((line) => line.includes("file12.ts"))).toBe(true);
	});
});

describe("batch panel click expansion", () => {
	it("header click lists every member instead of the head-limited preview", () => {
		setToolsRenderConfig({
			style: "compact-box",
			maxCollapsedLines: 30,
			maxExpandedLines: 60,
			dimOutput: true,
			collapseAfterTurn: true,
			collapseMutatingTools: false,
			batchOpenGlyph: "▾",
			nerdFonts: false,
			mergedTurnSummary: false,
		} as never);

		// 8 consecutive reads: batch panel led by r1.
		for (let i = 1; i <= 8; i++) {
			renderBoxedToolCall("read", { path: `f${i}.ts` }, theme, boxedContext({ toolCallId: `br${i}` }));
			renderBoxedToolResult(
				"read",
				{ content: [{ type: "text", text: `body ${i}` }], details: {} } as never,
				{ expanded: false, isPartial: false },
				theme,
				boxedContext({ toolCallId: `br${i}` }),
			);
		}
		const panel = renderBoxedToolCall("read", { path: "f1.ts" }, theme, boxedContext({ toolCallId: "br1" }));
		let lines = visibleLines(panel.render(100));
		expect(lines.some((line) => line.includes("Read (8)"))).toBe(true);
		expect(lines.some((line) => line.includes("f8.ts"))).toBe(false); // head-limited (5 + "3 more")

		expect((panel as never as { handleMouse: (e: never) => unknown }).handleMouse(click(0))).toEqual({
			handled: true,
		});
		lines = visibleLines(panel.render(100));
		expect(lines.some((line) => line.includes("f8.ts"))).toBe(true);
		expect(lines.some((line) => line.includes("3 more"))).toBe(false);

		// Clicks on non-header rows are consumed (no native solo-render).
		expect((panel as never as { handleMouse: (e: never) => unknown }).handleMouse(click(2))).toEqual({
			handled: true,
		});
	});
});

describe("toggleTurnOpen guard", () => {
	it("does nothing for a turn that has not ended", () => {
		setToolsRenderConfig({
			style: "compact-box",
			maxCollapsedLines: 30,
			maxExpandedLines: 60,
			dimOutput: true,
			collapseAfterTurn: true,
			collapseMutatingTools: false,
			batchOpenGlyph: "▾",
			nerdFonts: false,
			mergedTurnSummary: false,
		} as never);
		const message = baseMessage([{ type: "toolCall", name: "read", id: "x1", arguments: {} }], "toolUse");
		registerTurnFromMessage(message, []); // no result registered: the run is interrupted
		const run = finishAgentRun();
		expect(run).toBeUndefined(); // interrupted runs never collapse
		// toggleTurnOpen on a live/never-ended turn is a no-op by contract.
		const entry = { ended: false, forcedOpen: false, leaderId: "", members: [] } as never;
		expect(toggleTurnOpen(entry)).toBeUndefined();
		expect((entry as { forcedOpen: boolean }).forcedOpen).toBe(false);
	});
});

describe("merged thought-label click opens the run's tools (bridge)", () => {
	it("agent_end hides merged tools immediately and ◈ toggles thinking AND tools consistently", async () => {
		setToolsRenderConfig({
			style: "compact-box",
			maxCollapsedLines: 30,
			maxExpandedLines: 60,
			dimOutput: true,
			collapseAfterTurn: true,
			collapseMutatingTools: false,
			batchOpenGlyph: "▾",
			nerdFonts: false,
			mergedTurnSummary: true,
		} as never);
		const { setThoughtLabelTheme, __resetMessageDecorationTestState } = await import(
			"../../extension-src/pi-style/features/messages/index.js"
		);
		const { resetAgentThoughtRuns } = await import("../../extension-src/pi-style/features/messages/thought-summary.js");
		__resetMessageDecorationTestState();
		resetAgentThoughtRuns();
		setThoughtLabelTheme({ fg: (_c, t) => t } as never);

		const report = probePiCompatibility("0.85.0", {
			messageSnapshot: {
				assistantPrefix: "│ ",
				assistantEnabled: true,
				collapseHiddenThinking: true,
				thoughtSummary: true,
				mergedTurnSummary: true,
				thoughtGlyph: "◈",
			},
			toolSnapshot: { style: "compact-box" },
		});

		const calls = [
			{ name: "read", id: "r1", arguments: { path: "a.ts" } },
			{ name: "read", id: "r2", arguments: { path: "b.ts" } },
		];
		const message = {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "Plan the reads." },
				...calls.map((call) => ({ type: "toolCall", ...call })),
			],
			stopReason: "toolUse",
			timestamp: 1,
		} as never;
		const readDef = createReadToolDefinition("/fake");
		const components: ToolExecutionComponent[] = [];
		const host = new FakePiHost();
		piStyleExtension(host.extensionApi);
		await host.emit("agent_start", { type: "agent_start" });
		const assistant = new AssistantMessageComponent(message, true, theme, "", 1);
		for (const call of calls) {
			const component = new ToolExecutionComponent(
				call.name,
				call.id,
				call.arguments,
				{},
				readDef as never,
				{ requestRender: () => {} },
				"/fake",
			);
			components.push(component);
			component.updateResult({
				content: [{ type: "text", text: "ok" }],
				details: {},
				isError: false,
			} as never);
		}
		registerTurnFromMessage(
			message,
			calls.map((call) => ({ toolCallId: call.id, isError: false, content: [], details: {} })),
		);
		// Exercise the production handler: a manually ordered finalize/invalidate
		// sequence would miss a stale ➔ row on the first collapsed render.
		await host.emit("agent_end", { type: "agent_end", messages: [] });

		// Collapsed: one thought label row, tools hidden.
		const labelRow = visibleLines(assistant.render(100));
		expect(labelRow.join("\n")).toContain("Thought 1 time · Called 2 tools");
		expect(visibleLines(components.flatMap((c) => c.render(100)))).toHaveLength(0);

		// Click the ◈ label: thinking expands AND the run's tools open.
		const container = (
			assistant as unknown as {
				contentContainer: { children: Array<{ handleMouse?: (e: never) => unknown }> };
			}
		).contentContainer;
		const region = container.children.find((child) => typeof child.handleMouse === "function");
		expect(region).toBeDefined();
		expect(region?.handleMouse?.(click(0))).toEqual({ handled: true });
		const expandedText = visibleLines(components.flatMap((c) => c.render(100))).join("\n");
		expect(expandedText).toContain("a.ts");
		expect(expandedText).toContain("b.ts");

		// Click again: tools close together with the thinking.
		const regionAfter = container.children.find((child) => typeof child.handleMouse === "function");
		expect(regionAfter?.handleMouse?.(click(0))).toEqual({ handled: true });
		expect(visibleLines(components.flatMap((c) => c.render(100)))).toHaveLength(0);

		// Pi's global Ctrl+O path must round-trip to the same collapsed output.
		for (const component of components) component.setExpanded(true);
		expect(visibleLines(components.flatMap((c) => c.render(100))).join("\n")).toContain("a.ts");
		for (const component of components) component.setExpanded(false);
		expect(visibleLines(components.flatMap((c) => c.render(100)))).toHaveLength(0);
		expect(visibleLines(assistant.render(100))).toEqual(labelRow);

		disposePiCompatibilityProbe(report);
		resetAgentThoughtRuns();
		__resetMessageDecorationTestState();
	});
});
