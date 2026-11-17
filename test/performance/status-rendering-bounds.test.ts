import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../../extension-src/pi-style/domain/config-normalization.js";
import { createBuiltinSegments } from "../../extension-src/pi-style/domain/status.js";
import { renderStatus } from "../../extension-src/pi-style/domain/status-renderer.js";
import { resolveTheme } from "../../extension-src/pi-style/domain/theme.js";
import {
	installStatusLine,
	PRIMARY_WIDGET_KEY,
	SECONDARY_WIDGET_KEY,
} from "../../extension-src/pi-style/features/status-line/index.js";
import { visibleWidth } from "../../extension-src/pi-style/shared/ansi.js";

const theme = resolveTheme(undefined, normalizeConfig({ theme: { nerdFonts: "off" } }));

describe("status rendering bounds", () => {
	it.each([false, true])("shares one full layout across both widgets (secondary=%s)", (secondary) => {
		let reads = 0;
		let model = "first";
		const snapshot = {
			get model() {
				reads++;
				return model;
			},
			cwd: "/repo",
		};
		const widgets = new Map<string, { render(width: number): string[]; invalidate(): void }>();
		const activeTheme = { fg: (_token: string, text: string) => text };
		const installation = installStatusLine({
			host: {
				setWidget(key, content) {
					if (typeof content === "function") widgets.set(key, content({}, activeTheme));
				},
				setFooter() {},
			},
			config: normalizeConfig({
				statusLine: {
					bottomMargin: 0,
					layout: { left: ["model"], right: [], secondary: secondary ? ["path"] : [] },
				},
			}),
			generation: 1,
			initialSnapshot: snapshot,
		});
		const primary = widgets.get(PRIMARY_WIDGET_KEY);
		const other = widgets.get(SECONDARY_WIDGET_KEY);
		try {
			primary?.render(80);
			other?.render(80);
			expect(reads).toBe(3);
			for (let frame = 0; frame < 100; frame++) {
				primary?.render(80);
				other?.render(80);
			}
			expect(reads).toBe(3);
			// update must invalidate even when the same mutable snapshot is reused.
			model = "changed";
			installation.update(snapshot);
			other?.render(80);
			expect(primary?.render(80).join("")).toContain("changed");
			expect(reads).toBe(6);
			// Each widget can have a different effective width without cache thrashing.
			primary?.render(40);
			expect(reads).toBe(9);
			other?.render(80);
			primary?.render(40);
			expect(reads).toBe(9);
		} finally {
			installation.dispose();
		}
	});
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
