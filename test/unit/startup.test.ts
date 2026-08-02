import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, normalizeConfig } from "../../extension-src/pi-style/domain/config-normalization.js";
import { renderStartup } from "../../extension-src/pi-style/features/startup/index.js";
import { visibleWidth } from "../../extension-src/pi-style/shared/ansi.js";

const snapshot = {
	reason: "startup" as const,
	model: "provider/very-long-model-name",
	thinkingLevel: "high" as const,
	cwd: "/workspace/pi-style",
	context: { percent: 42 },
	resources: { contextFiles: 2, extensions: 4, skills: 3, tools: 12 },
};

const theme = { fg: (_token: string) => "" };

describe("startup presentation", () => {
	it("renders compact information without invented metadata", () => {
		const lines = renderStartup(snapshot, DEFAULT_CONFIG, theme, 120);
		expect(lines.join("\n")).toContain("very-long-model-name");
		expect(lines.join("\n")).toContain("resources");
		expect(lines.join("\n")).not.toContain("0 extensions");
	});

	it("degrades every line to the requested width", () => {
		for (const width of [0, 1, 20, 40, 60, 80, 120, 160]) {
			const lines = renderStartup(snapshot, DEFAULT_CONFIG, theme, width, true);
			expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
		}
	});

	it("supports off mode and missing optional data", () => {
		const off = normalizeConfig({ startup: { mode: "off" } });
		expect(renderStartup(snapshot, off, theme, 80)).toEqual([]);
		const minimal = renderStartup({ reason: "startup" }, DEFAULT_CONFIG, theme, 80);
		expect(minimal.join("\n")).not.toContain("undefined");
	});

	it("filters non-initial reasons from overlay presentation", () => {
		const reload = renderStartup({ ...snapshot, reason: "reload" }, DEFAULT_CONFIG, theme, 80, true);
		expect(reload.join("\n")).toContain("pi-style");
	});
});
