import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../../extension-src/pi-style/domain/config-normalization.js";
import { resolveTheme } from "../../extension-src/pi-style/domain/theme.js";
import {
	compactLogoHeader,
	PI_LOGO_LINES,
	styledLogoLines,
} from "../../extension-src/pi-style/features/startup/logo.js";
import { parseAnsiFgToRgb, visibleWidth } from "../../extension-src/pi-style/shared/ansi.js";

function resolved(colors: Record<string, string> = {}) {
	const config = normalizeConfig({ preset: "default", theme: { colors } });
	return resolveTheme({ fg: (_token: string) => "" }, config);
}

const DETAILS: readonly [string, string, string] = ["π pi-style", "/ commands · ! bash", "● ready"];

describe("startup logo", () => {
	it("defines the nine-line block-art Pi logo", () => {
		expect(PI_LOGO_LINES).toHaveLength(9);
		expect(PI_LOGO_LINES[0]).toContain("█");
	});

	it("applies an accent gradient when a hex accent is resolvable", () => {
		const lines = styledLogoLines(resolved({ accent: "#5098ff" }));
		expect(lines).toHaveLength(9);
		expect(lines.join("")).toContain("\u001b[38;2;");
		// every gradient color stays on the accent hue (blue-ish) and forms a real gradient
		const output = lines.join("");
		expect(output).toContain("\u001b[38;2;");
		const colors = new Set<string>();
		for (const segment of output.split("\u001b[38;2;").slice(1)) {
			const channels = segment.slice(0, segment.indexOf("m")).split(";").map(Number);
			if (channels.length !== 3) continue;
			colors.add(segment.slice(0, segment.indexOf("m")));
			expect(channels[2] ?? 0).toBeGreaterThan(channels[0] ?? 0);
		}
		expect(colors.size).toBeGreaterThan(1);
	});

	it("keeps the logo plain when no color is resolvable", () => {
		expect(styledLogoLines(resolved())).toEqual([...PI_LOGO_LINES]);
	});

	it("renders side details beside the logo on wide widths", () => {
		const lines = compactLogoHeader(resolved(), DETAILS, 120);
		expect(lines).toHaveLength(9);
		expect(lines.join("\n")).toContain("π pi-style");
		expect(lines.join("\n")).toContain("/ commands");
		expect(lines.every((line) => visibleWidth(line) <= 120)).toBe(true);
	});

	it("stacks the logo above details on narrow widths", () => {
		const lines = compactLogoHeader(resolved(), DETAILS, 20);
		expect(lines).toHaveLength(12);
		expect(lines.slice(0, 9)).toEqual([...PI_LOGO_LINES]);
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
