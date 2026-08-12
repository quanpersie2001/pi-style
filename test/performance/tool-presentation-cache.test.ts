import { afterEach, describe, expect, it, vi } from "vitest";
import {
	renderBashExecutionBox,
	setBashExecutionTheme,
} from "../../extension-src/pi-style/features/tools/bash-execution.js";
import {
	registerBatchCall,
	registerBatchResult,
	renderBatchAwareCall,
	resetBatchRegistry,
} from "../../extension-src/pi-style/features/tools/boxed/batch.js";
import { renderBoxedToolResult as dispatchResult } from "../../extension-src/pi-style/features/tools/boxed/index.js";
import {
	__getElapsedTickerDebugState,
	setToolsRenderConfig,
	startElapsedTicker,
	stopAllElapsedTickers,
	stopElapsedTicker,
} from "../../extension-src/pi-style/features/tools/boxed/session-config.js";
import type { BoxedToolContext } from "../../extension-src/pi-style/features/tools/boxed/shared.js";
import { createFakeTheme } from "../helpers/fake-theme.js";

const theme = createFakeTheme();

function context(overrides: Partial<BoxedToolContext> = {}): BoxedToolContext {
	return {
		args: {},
		toolCallId: "fixture-call",
		invalidate: () => {},
		state: {},
		cwd: "/fake",
		executionStarted: true,
		argsComplete: true,
		isPartial: false,
		expanded: false,
		showImages: true,
		isError: false,
		lastComponent: undefined,
		...overrides,
	};
}

describe("tool presentation performance contracts", () => {
	afterEach(() => {
		resetBatchRegistry();
		stopAllElapsedTickers();
		setToolsRenderConfig({
			maxCollapsedLines: 10,
			maxExpandedLines: 50,
			dimOutput: false,
			showElapsed: true,
			batchOpenGlyph: "●",
			nerdFonts: false,
			collapseAfterTurn: true,
			collapseMutatingTools: false,
		});
		setBashExecutionTheme(undefined);
		vi.useRealTimers();
	});

	it("shares one elapsed ticker across multiple tool states and cleans it up", () => {
		vi.useFakeTimers();
		let renders = 0;
		const states = [{}, {}, {}] as Array<Record<string, unknown>>;
		for (const state of states) startElapsedTicker(state, () => renders++);
		expect(__getElapsedTickerDebugState()).toEqual({ trackedStates: 3, hasSharedTicker: true });
		expect(vi.getTimerCount()).toBe(1);

		vi.advanceTimersByTime(3000);
		expect(renders).toBe(9);

		stopElapsedTicker(states[0]);
		expect(__getElapsedTickerDebugState()).toEqual({ trackedStates: 2, hasSharedTicker: true });
		stopAllElapsedTickers();
		expect(__getElapsedTickerDebugState()).toEqual({ trackedStates: 0, hasSharedTicker: false });
		expect(vi.getTimerCount()).toBe(0);
	});

	it("reuses finalized batch tree lines until width or config changes", () => {
		const meta = { toolName: "read", label: "Read" };
		const first = context({ toolCallId: "r1" });
		const second = context({ toolCallId: "r2" });
		const { batch } = registerBatchCall(meta, "src/a.ts", first);
		registerBatchCall(meta, "src/b.ts", second);
		registerBatchResult(meta, { isPartial: false, isError: false, errorText: undefined }, first);
		registerBatchResult(meta, { isPartial: false, isError: false, errorText: undefined }, second);

		const component = renderBatchAwareCall(theme, batch);
		const firstLines = component.render(80);
		const secondLines = component.render(80);
		expect(secondLines).toBe(firstLines);

		const resized = component.render(60);
		expect(resized).not.toBe(firstLines);

		setToolsRenderConfig({ batchOpenGlyph: "v" });
		const reconfigured = component.render(80);
		expect(reconfigured).not.toBe(firstLines);
	});

	it("memoizes finalized bash result components across repeated collapsed renders but separates expanded ones", () => {
		const output = Array.from({ length: 200 }, (_, index) => `line-${index}`).join("\n");
		const ctx = context({
			args: { command: "printf 'x'", timeout: 30 },
			state: {},
		});
		const result = { content: [{ type: "text", text: output }], details: {} };

		const collapsedA = dispatchResult("bash", result, { expanded: false, isPartial: false }, theme, ctx);
		const collapsedB = dispatchResult("bash", result, { expanded: false, isPartial: false }, theme, ctx);
		expect(collapsedB).toBe(collapsedA);
		expect(collapsedA.render(80)).toBe(collapsedA.render(80));

		const expanded = dispatchResult("bash", result, { expanded: true, isPartial: false }, theme, ctx);
		expect(expanded).not.toBe(collapsedA);
		const expandedLines = expanded.render(80);
		expect(expandedLines.length).toBeLessThanOrEqual(55);
	});

	it("memoizes finalized edit diff components across repeated renders", () => {
		const ctx = context({ args: { path: "/fake/src/config.ts" }, state: {} });
		const result = {
			content: [],
			details: { diff: "- 1 const timeout = 300;\n+ 1 const timeout = 60;", path: "/fake/src/config.ts" },
		};

		const first = dispatchResult("edit", result, { expanded: false, isPartial: false }, theme, ctx);
		const second = dispatchResult("edit", result, { expanded: false, isPartial: false }, theme, ctx);
		expect(second).toBe(first);
		expect(first.render(120)).toBe(first.render(120));
	});

	it("reuses finalized direct-bash frames without re-rendering the native content container", () => {
		setBashExecutionTheme(theme as never);
		let nativeRenders = 0;
		const host = {
			command: "echo hi",
			status: "complete" as const,
			exitCode: 0,
			contentContainer: {
				render() {
					nativeRenders++;
					return [" hi"];
				},
			},
		};

		const first = renderBashExecutionBox(host, [50]);
		const second = renderBashExecutionBox(host, [50]);
		expect(second).toBe(first);
		expect(nativeRenders).toBe(1);
	});
});
