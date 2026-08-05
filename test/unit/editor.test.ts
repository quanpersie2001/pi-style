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
		// The dropdown is re-framed INSIDE the rounded input box (default frame):
		// rounded top border, prompt row wrapped with side borders, rounded bottom
		// border. The prompt keeps the normal left margin.
		expect(plain(lines[0] ?? "")).toBe(`╭${"─".repeat(78)}╮`);
		expect(plain(lines[1] ?? "")).toContain("❯ @pi-style/input-sample");
		expect(plain(lines[lines.length - 1] ?? "")).toBe(`╰${"─".repeat(78)}╯`);
		expect(plain(lines[1] ?? "").startsWith("│")).toBe(true);
		expect(plain(lines[1] ?? "").endsWith("│")).toBe(true);
		expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
	});

	it("renders the rounded frame with side borders when frame is rounded", () => {
		const editor = new StyledEditor(fakeTui(), fakeTheme(), fakeKeys(), {
			config: normalizeConfig({ editor: { style: "dock", frame: "rounded" } }),
			snapshot: {},
			theme: fakeTheme(),
			onSnapshot: () => {},
		});
		editor.setText("one two three four five");
		const lines = editor.render(80);
		const plain = (line: string) => line.replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");
		expect(plain(lines[0] ?? "")).toBe(`╭${"─".repeat(78)}╮`);
		expect(plain(lines[lines.length - 1] ?? "")).toBe(`╰${"─".repeat(78)}╯`);
		const body = lines.slice(1, -1);
		expect(body.length).toBeGreaterThan(0);
		for (const line of body) {
			expect(plain(line).startsWith("│")).toBe(true);
			expect(plain(line).endsWith("│")).toBe(true);
		}
		expect(plain(body[0] ?? "")).toContain("❯ one two three four five");
		expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
	});

	it("keeps outline frame without side borders (backwards compatible)", () => {
		const editor = new StyledEditor(fakeTui(), fakeTheme(), fakeKeys(), {
			config: normalizeConfig({ editor: { style: "dock", frame: "outline" } }),
			snapshot: {},
			theme: fakeTheme(),
			onSnapshot: () => {},
		});
		editor.setText("outline sample");
		const lines = editor.render(80);
		const plain = (line: string) => line.replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");
		expect(plain(lines[0] ?? "")).toBe(`┌${"─".repeat(78)}┐`);
		expect(plain(lines[lines.length - 1] ?? "")).toBe(`└${"─".repeat(78)}┘`);
		// Body lines are not wrapped with vertical side borders in outline mode.
		for (const line of lines.slice(1, -1)) expect(plain(line).startsWith("│")).toBe(false);
	});

	it("shows the configured hint in dim when the input is empty and hides it on typing", () => {
		const editor = new StyledEditor(fakeTui(), fakeTheme(), fakeKeys(), {
			config: normalizeConfig({ editor: { hint: "Ask Pi anything" } }),
			snapshot: {},
			theme: fakeTheme(),
			onSnapshot: () => {},
		});
		const empty = editor.render(80);
		const plain = (line: string) => line.replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");
		expect(plain(empty.join("\n")).includes("Ask Pi anything")).toBe(true);
		// The hint is styled (dim ANSI present), not plain text.
		expect(empty.join("\n").includes("\x1b[38;2;")).toBe(true);

		editor.handleInput("h");
		const typed = editor.render(80);
		expect(plain(typed.join("\n")).includes("Ask Pi anything")).toBe(false);
		expect(plain(typed.join("\n")).includes("❯ h")).toBe(true);
	});

	it("keeps the hint inside the rounded box and width-safe", () => {
		const editor = new StyledEditor(fakeTui(), fakeTheme(), fakeKeys(), {
			config: normalizeConfig({ editor: { style: "dock", frame: "rounded", hint: "Ask Pi anything" } }),
			snapshot: {},
			theme: fakeTheme(),
			onSnapshot: () => {},
		});
		const lines = editor.render(60);
		const plain = (line: string) => line.replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");
		expect(plain(lines[0] ?? "")).toBe(`╭${"─".repeat(58)}╮`);
		expect(plain(lines[lines.length - 1] ?? "")).toBe(`╰${"─".repeat(58)}╯`);
		expect(plain(lines.join("\n")).includes("Ask Pi anything")).toBe(true);
		expect(lines.every((line) => visibleWidth(line) <= 60)).toBe(true);
	});
});
