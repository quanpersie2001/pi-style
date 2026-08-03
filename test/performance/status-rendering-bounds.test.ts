import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../../extension-src/pi-style/domain/config-normalization.js";
import { createBuiltinSegments } from "../../extension-src/pi-style/domain/status.js";
import { renderStatus } from "../../extension-src/pi-style/domain/status-renderer.js";
import { resolveTheme } from "../../extension-src/pi-style/domain/theme.js";
import { visibleWidth } from "../../extension-src/pi-style/shared/ansi.js";

const theme = resolveTheme(undefined, normalizeConfig({ theme: { nerdFonts: "off" } }));

describe("status rendering bounds", () => {
	it("keeps status output bounded at documented widths and missing data", () => {
		for (const width of [40, 60, 80, 120, 160, 1]) {
			const result = renderStatus(
				{ left: ["model", "path", "git", "context_pct"], right: [], secondary: [] },
				{ model: "a-very-long-model-name", cwd: "/a/very/long/path/that/may/need/truncation" },
				width,
				{ segments: createBuiltinSegments(), theme },
			);
			// ANSI must stay invisible to width accounting, and styled lines must end with a reset.
			expect(result.lines.every((line) => visibleWidth(line) <= width)).toBe(true);
			expect(result.lines.every((line) => (line.includes("\u001b[") ? line.includes("\u001b[0m") : true))).toBe(true);
		}
	});

	it("invokes each configured segment once per render", () => {
		const calls = new Map<string, number>();
		const segments = new Map(
			["a", "b", "c", "d", "e", "f"].map((id) => [
				id,
				{
					id,
					defaultPriority: 1,
					render: () => {
						calls.set(id, (calls.get(id) ?? 0) + 1);
						return { visible: true, content: id };
					},
				},
			]),
		);
		renderStatus({ left: [...segments.keys()], right: [], secondary: [] }, {}, 160, {
			segments,
			theme,
			separator: "|",
		});
		expect([...calls.values()]).toEqual([1, 1, 1, 1, 1, 1]);
	});
});
