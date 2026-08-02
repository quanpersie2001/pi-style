import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, normalizeConfig } from "../../extension-src/pi-style/domain/config-normalization.js";
import { StyledEditor } from "../../extension-src/pi-style/features/editor/index.js";
import { visibleWidth } from "../../extension-src/pi-style/shared/ansi.js";

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

describe("styled editor renderer", () => {
	it("renders each configured style with width-safe framed output", () => {
		const outputs = new Set<string>();
		for (const style of ["compact", "boxed", "dock", "native"] as const) {
			const editor = new StyledEditor(fakeTui(), fakeTheme(), fakeKeys(), {
				config: normalizeConfig({ editor: { style, frame: "auto" } }),
				snapshot: { model: "model", thinkingLevel: "high", cwd: "/work" },
				theme: fakeTheme(),
				onSnapshot: () => {},
			});
			editor.setText("one two three four five");
			const lines = editor.render(80);
			outputs.add(lines.join("\n"));
			expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
		}
		expect(outputs.size).toBeGreaterThan(1);
	});

	it("keeps text editable through native input delegation", () => {
		const editor = new StyledEditor(fakeTui(), fakeTheme(), fakeKeys(), {
			config: DEFAULT_CONFIG,
			snapshot: {},
			theme: fakeTheme(),
			onSnapshot: () => {},
		});
		editor.handleInput("hello");
		expect(editor.getText()).toContain("hello");
	});

	it("falls back to native rendering at very narrow widths", () => {
		const editor = new StyledEditor(fakeTui(), fakeTheme(), fakeKeys(), {
			config: DEFAULT_CONFIG,
			snapshot: {},
			theme: fakeTheme(),
			onSnapshot: () => {},
		});
		editor.setText("long editable text");
		const lines = editor.render(1);
		expect(lines.every((line) => visibleWidth(line) <= 1)).toBe(true);
	});
});
