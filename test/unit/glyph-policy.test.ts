import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeConfig } from "../../extension-src/pi-style/domain/config-normalization.js";
import { GLYPHS, resolveTheme } from "../../extension-src/pi-style/domain/theme.js";
import { resetBashTreeRegistry } from "../../extension-src/pi-style/features/tools/boxed/bash.js";
import { resetBatchRegistry } from "../../extension-src/pi-style/features/tools/boxed/batch.js";
import { resetGrepRegistry } from "../../extension-src/pi-style/features/tools/boxed/grep.js";
import { renderBoxedToolCall, renderBoxedToolResult } from "../../extension-src/pi-style/features/tools/boxed/index.js";
import {
	getToolsRenderConfig,
	setToolsRenderConfig,
	teamEventGlyph,
} from "../../extension-src/pi-style/features/tools/boxed/session-config.js";
import type { BoxedToolContext } from "../../extension-src/pi-style/features/tools/boxed/shared.js";
import { stripAnsi } from "../../extension-src/pi-style/shared/ansi.js";
import { createFakeTheme } from "../helpers/fake-theme.js";

const environments = [
	{},
	{ PI_STYLE_NERD_FONTS: "1" },
	{ PI_STYLE_NERD_FONTS: "0" },
	{ GHOSTTY_RESOURCES_DIR: "/Applications/Ghostty.app/resources" },
	...["iTerm.app", "WezTerm", "kitty", "ghostty", "Alacritty", "Warp"].map((TERM_PROGRAM) => ({ TERM_PROGRAM })),
];
const privateUse = /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/u;

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
	});
}

describe("portable built-in glyph policy", () => {
	it.each(["auto", "on", "off"])("ignores legacy font setting %s and terminal heuristics", (nerdFonts) => {
		for (const env of environments) {
			const theme = resolveTheme(undefined, normalizeConfig({ theme: { nerdFonts } }), env);
			expect(theme.mode).toBe("unicode");
			for (const name of Object.keys(GLYPHS.unicode) as (keyof typeof GLYPHS.unicode)[]) {
				expect(theme.glyph(name)).toBe(GLYPHS.unicode[name]);
			}
			const ascii = resolveTheme(undefined, normalizeConfig({ preset: "ascii", theme: { nerdFonts } }), env);
			expect(ascii.mode).toBe("ascii");
			expect(ascii.glyph("eventSettled")).toBe("*");
		}
	});

	it("preserves explicit user glyph overrides", () => {
		const theme = resolveTheme(undefined, normalizeConfig({ theme: { glyphs: { git: "branch" } } }));
		expect(theme.glyph("git")).toBe("branch");
	});

	it("keeps decorative headers distinct from state and expansion glyphs", () => {
		expect(GLYPHS.unicode.toolHeader).toBe("●");
		expect(GLYPHS.ascii.toolHeader).toBe(">");
		expect(GLYPHS.ascii.batchOpen).toBe("v");
		expect(GLYPHS.unicode.eventRunning).toBe("◌");
		expect(GLYPHS.unicode.eventFailed).toBe("✗");
	});

	it("contains no built-in private-use glyphs, including escaped code points", () => {
		const root = fileURLToPath(new URL("../../extension-src/", import.meta.url));
		for (const path of sourceFiles(root)) {
			const decoded = readFileSync(path, "utf8").replace(/\\u(?:\{([\da-f]+)\}|([\da-f]{4}))/gi, (_, braced, plain) =>
				String.fromCodePoint(Number.parseInt(braced ?? plain, 16)),
			);
			expect(decoded, path).not.toMatch(privateUse);
		}
	});
});

describe("decorative tool headers", () => {
	const original = { ...getToolsRenderConfig() };
	const theme = createFakeTheme();

	beforeEach(() => {
		initTheme("dark", false);
		resetBatchRegistry();
		resetGrepRegistry();
		resetBashTreeRegistry();
	});

	afterEach(() => {
		resetBatchRegistry();
		resetGrepRegistry();
		resetBashTreeRegistry();
		setToolsRenderConfig(original);
	});

	it.each([
		{ preset: "default", override: undefined, marker: "●" },
		{ preset: "ascii", override: undefined, marker: ">" },
		{ preset: "default", override: "custom", marker: "custom" },
		{ preset: "ascii", override: "custom", marker: "custom" },
	])("uses $marker for $preset tool headers (override=$override)", ({ preset, override, marker }) => {
		const resolved = resolveTheme(
			undefined,
			normalizeConfig({ preset, theme: { glyphs: override ? { toolHeader: override } : {} } }),
		);
		expect(resolved.glyph("toolHeader")).toBe(marker);
		setToolsRenderConfig({ glyphMode: resolved.mode, toolHeaderGlyph: resolved.glyph("toolHeader") });
		for (const [name, label, args, output] of [
			["read", "Read", { path: "/fake/a.ts" }, "hello"],
			["write", "Write", { path: "/fake/a.ts", content: "hello" }, "written"],
			["edit", "Edit", { path: "/fake/a.ts" }, "edited"],
			["bash", "Bash", { command: "echo hello" }, "hello"],
			["grep", "Grep:", { pattern: "hello", path: "/fake" }, "a.ts:1: hello"],
			["find", "Find", { pattern: "*.ts", path: "/fake" }, "a.ts"],
			["ls", "List", { path: "/fake" }, "a.ts"],
			["glob", "Glob", { pattern: "*.ts" }, "a.ts"],
			["custom_tool", "Custom Tool", {}, "hello"],
		] as const) {
			resetBatchRegistry();
			const context: BoxedToolContext = {
				args,
				toolCallId: name,
				invalidate() {},
				state: {},
				cwd: "/fake",
				executionStarted: true,
				argsComplete: true,
				isPartial: false,
				expanded: false,
				showImages: false,
				isError: false,
				lastComponent: undefined,
			};
			const call = renderBoxedToolCall(name, args, theme, context);
			expect(stripAnsi(call.render(120)[0]), `${name} pending`).toContain(`${marker} ${label}`);
			renderBoxedToolResult(
				name,
				{ content: [{ type: "text", text: output }], details: {} },
				{ expanded: false, isPartial: false },
				theme,
				context,
			);
			expect(stripAnsi(call.render(120)[0]), `${name} settled`).toContain(`${marker} ${label}`);
		}
		expect(teamEventGlyph("running")).toBe(GLYPHS[resolved.mode].eventRunning);
		expect(teamEventGlyph("failed")).toBe(GLYPHS[resolved.mode].eventFailed);
	});
});
