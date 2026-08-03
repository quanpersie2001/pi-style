import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, normalizeConfig } from "../../extension-src/pi-style/domain/config-normalization.js";
import { StyledEditor } from "../../extension-src/pi-style/features/editor/index.js";
import { visibleWidth } from "../../extension-src/pi-style/shared/ansi.js";

const ESC = "\x1b";

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

	it("keeps the prompt and frame while the native autocomplete dropdown is open", () => {
		const editor = new StyledEditor(fakeTui(), fakeTheme(), fakeKeys(), {
			config: DEFAULT_CONFIG,
			snapshot: {},
			theme: fakeTheme(),
			onSnapshot: () => {},
		});
		(editor as unknown as { autocompleteState?: unknown }).autocompleteState = { active: true };
		editor.setText("@pi-style/input-sample");
		const lines = editor.render(80);
		const plain = (line: string) => line.replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");
		// The dropdown is re-framed INSIDE the input box: styled top border, prompt
		// row, styled bottom border. The prompt keeps the normal left margin.
		expect(plain(lines[0] ?? "")).toBe("─".repeat(80));
		expect(plain(lines[1] ?? "").trim()).toBe("❯ @pi-style/input-sample");
		expect(plain(lines[lines.length - 1] ?? "")).toBe("─".repeat(80));
		expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
	});
});
