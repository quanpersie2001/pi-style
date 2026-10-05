import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../../extension-src/pi-style/domain/config-normalization.js";
import { resolveTheme } from "../../extension-src/pi-style/domain/theme.js";
import {
	compactLogoHeader,
	PI_LOGO_LINES,
	styledLogoLines,
} from "../../extension-src/pi-style/features/startup/logo.js";
import { parseAnsiFgToRgb, stripAnsi, visibleWidth } from "../../extension-src/pi-style/shared/ansi.js";

function resolved(colors: Record<string, string> = {}, env: Record<string, string | undefined> = {}) {
	const config = normalizeConfig({ preset: "default", theme: { colors } });
	return resolveTheme({ fg: (_token: string) => "" }, config, env);
}

const DETAILS: readonly string[] = ["π ~/Workspace/pi-style", "/ commands", "! bash", "● ready"];

describe("startup logo", () => {
	it("defines the eight-line block-art Pi logo", () => {
		expect(PI_LOGO_LINES).toHaveLength(8);
		expect(PI_LOGO_LINES[0]).toContain("█");
	});

	it("colors the cap and dot coral, the P blue, and the i stem gold", () => {
		const coral = "\u001b[38;2;240;144;130m";
		const blue = "\u001b[38;2;80;155;185m";
		const gold = "\u001b[38;2;240;192;85m";
		const reset = "\u001b[0m";
		expect(styledLogoLines(resolved())).toEqual([
			`${coral}████████████${reset}`,
			`${coral}████████████${reset}`,
			`${blue}████${reset}    ${coral}████${reset}`,
			`${blue}████${reset}    ${coral}████${reset}`,
			`${blue}████████${reset}    ${gold}████${reset}`,
			`${blue}████████${reset}    ${gold}████${reset}`,
			`${blue}████${reset}        ${gold}████${reset}`,
			`${blue}████${reset}        ${gold}████${reset}`,
		]);
	});

	it("preserves the logo silhouette and widths", () => {
		const lines = styledLogoLines(resolved());
		expect(lines.map(stripAnsi)).toEqual([...PI_LOGO_LINES]);
		expect(lines.map(visibleWidth)).toEqual(PI_LOGO_LINES.map(visibleWidth));
	});

	it("keeps brand colors independent of the active theme accent", () => {
		const lines = styledLogoLines(resolved());
		expect(styledLogoLines(resolved({ accent: "#5098ff" }))).toEqual(lines);
		expect(styledLogoLines(resolved({ accent: "#ff0000" }))).toEqual(lines);
	});

	it("keeps the logo plain under NO_COLOR and restores colors afterward", () => {
		const colored = styledLogoLines(resolved());
		expect(styledLogoLines(resolved({ accent: "#5098ff" }, { NO_COLOR: "1" }))).toEqual([...PI_LOGO_LINES]);
		expect(styledLogoLines(resolved())).toEqual(colored);
	});

	it("honors the explicit color override under NO_COLOR", () => {
		expect(styledLogoLines(resolved({ colorOverride: "on" }, { NO_COLOR: "1" }))).toEqual(styledLogoLines(resolved()));
	});

	it("renders side details beside the logo on wide widths", () => {
		const lines = compactLogoHeader(resolved(), DETAILS, 120);
		expect(lines).toHaveLength(8);
		expect(lines.join("\n")).toContain("π ~/Workspace/pi-style");
		expect(lines.join("\n")).toContain("/ commands");
		expect(lines.every((line) => visibleWidth(line) <= 120)).toBe(true);
	});

	it("stacks the logo above details on narrow widths", () => {
		const lines = compactLogoHeader(resolved(), DETAILS, 20);
		expect(lines).toHaveLength(12);
		expect(lines.slice(0, 8).map(stripAnsi)).toEqual([...PI_LOGO_LINES]);
		expect(lines.every((line) => visibleWidth(line) <= 20)).toBe(true);
	});

	it("collapses to title and status on very narrow widths", () => {
		const lines = compactLogoHeader(resolved(), DETAILS, 1);
		expect(lines).toHaveLength(2);
		expect(lines.every((line) => visibleWidth(line) <= 1)).toBe(true);
	});
});

describe("ANSI foreground parsing", () => {
	it("parses 24-bit prefixes", () => {
		expect(parseAnsiFgToRgb("\u001b[38;2;1;2;3m")).toEqual({ r: 1, g: 2, b: 3 });
	});

	it("parses 256-color prefixes through the cube mapping", () => {
		// 39 = cube index 23 → r=0 (floor(23/36)), g=3, b=5 → 0,175,255
		expect(parseAnsiFgToRgb("\u001b[38;5;39m")).toEqual({ r: 0, g: 175, b: 255 });
	});

	it("returns undefined for empty or non-fg prefixes", () => {
		expect(parseAnsiFgToRgb("")).toBeUndefined();
		expect(parseAnsiFgToRgb("\u001b[48;5;39m")).toBeUndefined();
	});
});
