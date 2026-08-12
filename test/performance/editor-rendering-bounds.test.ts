import { describe, expect, it, vi } from "vitest";
import { normalizeConfig } from "../../extension-src/pi-style/domain/config-normalization.js";
import { StyledEditor } from "../../extension-src/pi-style/features/editor/index.js";

function fakeTui() {
	return { requestRender() {}, terminal: { rows: 24 } } as never;
}

function fakeTheme() {
	return {
		borderColor: (value: string) => `\x1b[34m${value}\x1b[0m`,
		selectList: {},
	} as never;
}

function fakeKeys() {
	return { matches: () => false } as never;
}

describe("editor render performance bounds", () => {
	it("reuses the cached render plan across repeated same-width renders", () => {
		const editor = new StyledEditor(fakeTui(), fakeTheme(), fakeKeys(), {
			config: normalizeConfig({ editor: { style: "dock", frame: "rounded" } }),
			snapshot: {},
			theme: fakeTheme(),
			onSnapshot: () => {},
		});
		editor.setText("render plan cache");

		editor.render(80);
		const firstCache = (editor as unknown as { renderPlanCache?: unknown }).renderPlanCache;
		expect(firstCache).toBeDefined();

		for (let index = 0; index < 25; index++) editor.render(80);
		const repeatedCache = (editor as unknown as { renderPlanCache?: unknown }).renderPlanCache;
		expect(repeatedCache).toBe(firstCache);

		editor.render(81);
		const resizedCache = (editor as unknown as { renderPlanCache?: unknown }).renderPlanCache;
		expect(resizedCache).not.toBe(firstCache);
	});

	it("keeps native render work proportional to editor renders, not decorated branches", () => {
		const editor = new StyledEditor(fakeTui(), fakeTheme(), fakeKeys(), {
			config: normalizeConfig({ editor: { style: "dock", frame: "rounded" } }),
			snapshot: {},
			theme: fakeTheme(),
			onSnapshot: () => {},
		});
		const basePrototype = Object.getPrototypeOf(Object.getPrototypeOf(editor)) as {
			render: (width: number) => string[];
		};
		const spy = vi.spyOn(basePrototype, "render");
		try {
			editor.setText(Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n"));

			for (let index = 0; index < 20; index++) editor.render(100);
			expect(spy).toHaveBeenCalledTimes(20);
			const widths = new Set(spy.mock.calls.map(([width]) => width));
			expect(widths.size).toBe(1);
			expect([...widths][0]).toBeLessThan(100);
			expect([...widths][0]).toBeGreaterThan(0);
		} finally {
			spy.mockRestore();
		}
	});
});
