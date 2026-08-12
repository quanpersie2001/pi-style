import { afterEach, describe, expect, it } from "vitest";
import {
	__getMessageDecorationTestState,
	__resetMessageDecorationTestState,
	decorateMessageRender,
} from "../../extension-src/pi-style/features/messages/index.js";
import { visibleWidth } from "../../extension-src/pi-style/shared/ansi.js";

const SNAPSHOT = {
	assistantPrefix: "│ ",
	assistantEnabled: true,
	collapseHiddenThinking: false,
	hideInterimText: false,
} as const;

afterEach(() => {
	__resetMessageDecorationTestState();
});

function multilineEnvelope(label: string): string[] {
	return [
		"  ",
		`\x1b]133;A\x07\x1b[44m${label} line 1\x1b[49m`,
		`\x1b[44m${label} line 2\x1b[49m`,
		`\x1b]133;B\x07\x1b]133;C\x07\x1b[44m${label} done\x1b[49m`,
	];
}

describe("message decoration render cache", () => {
	it("reuses finalized decorated output without reprocessing OSC/background lines", () => {
		const instance = {};
		const nativeLines = multilineEnvelope("cached");
		let nativeCalls = 0;
		const render = () => {
			nativeCalls++;
			return nativeLines;
		};

		const first = decorateMessageRender(render, instance, [48], SNAPSHOT) as string[];
		const second = decorateMessageRender(render, instance, [48], SNAPSHOT) as string[];
		const third = decorateMessageRender(render, instance, [48], SNAPSHOT) as string[];

		expect(nativeCalls).toBe(3);
		expect(first).toEqual(second);
		expect(second).toEqual(third);
		expect(first.join("\n")).toContain("\x1b]133;A\x07");
		expect(first.join("\n")).toContain("\x1b]133;B\x07\x1b]133;C\x07");
		expect(first.some((line) => line.includes("│ cached line 1"))).toBe(true);
		expect(first.every((line) => visibleWidth(line) <= 48)).toBe(true);
		expect(__getMessageDecorationTestState()).toMatchObject({
			decoratePasses: 1,
			cacheHits: 2,
			cacheMisses: 1,
		});
	});

	it("invalidates the cached decoration when content changes during streaming", () => {
		const instance = {};
		let nativeLines = multilineEnvelope("draft");
		const render = () => nativeLines;

		const first = decorateMessageRender(render, instance, [52], SNAPSHOT) as string[];
		const stable = decorateMessageRender(render, instance, [52], SNAPSHOT) as string[];
		nativeLines = multilineEnvelope("final");
		const updated = decorateMessageRender(render, instance, [52], SNAPSHOT) as string[];

		expect(first).toEqual(stable);
		expect(updated.join("\n")).toContain("final line 1");
		expect(updated).not.toEqual(first);
		expect(__getMessageDecorationTestState()).toMatchObject({
			decoratePasses: 2,
			cacheHits: 1,
			cacheMisses: 2,
		});
	});

	it("treats width, prefix, and themed native output as separate cache entries", () => {
		const instance = {};
		let themedLines = multilineEnvelope("theme-a");
		const render = () => themedLines;

		const at48 = decorateMessageRender(render, instance, [48], SNAPSHOT) as string[];
		const at64 = decorateMessageRender(render, instance, [64], SNAPSHOT) as string[];
		const withAsciiPrefix = decorateMessageRender(render, instance, [64], {
			...SNAPSHOT,
			assistantPrefix: "[assistant] ",
		}) as string[];
		const asciiAgain = decorateMessageRender(render, instance, [64], {
			...SNAPSHOT,
			assistantPrefix: "[assistant] ",
		}) as string[];
		// Theme change: same content shape, different native ANSI payload.
		themedLines = [
			"  ",
			"\x1b]133;A\x07\x1b[45mtheme-a line 1\x1b[49m",
			"\x1b[45mtheme-a line 2\x1b[49m",
			"\x1b]133;B\x07\x1b]133;C\x07\x1b[45mtheme-a done\x1b[49m",
		];
		const themed = decorateMessageRender(render, instance, [64], SNAPSHOT) as string[];

		expect(at48.every((line) => visibleWidth(line) <= 48)).toBe(true);
		expect(at64.every((line) => visibleWidth(line) <= 64)).toBe(true);
		expect(withAsciiPrefix[1]).toContain("[assistant] ");
		expect(asciiAgain).toEqual(withAsciiPrefix);
		expect(themed.join("\n")).toContain("\x1b[45m");
		expect(__getMessageDecorationTestState()).toMatchObject({
			decoratePasses: 4,
			cacheHits: 1,
			cacheMisses: 4,
		});
	});
});
