import { describe, expect, it } from "vitest";
import {
	CachedGitProvider,
	InMemoryContextProvider,
	InMemoryUsageProvider,
	parseGitStatus,
} from "../../extension-src/pi-style/app/providers.js";
import { createSnapshot, replaceSnapshot } from "../../extension-src/pi-style/app/snapshot.js";
import { normalizeConfig } from "../../extension-src/pi-style/domain/config-normalization.js";
import {
	contextPercent,
	contextState,
	createBuiltinSegments,
	type SegmentRenderResult,
	type StatusSegment,
} from "../../extension-src/pi-style/domain/status.js";
import { normalizeStatusLayout } from "../../extension-src/pi-style/domain/status-presets.js";
import { renderStatus } from "../../extension-src/pi-style/domain/status-renderer.js";
import { resolveTheme } from "../../extension-src/pi-style/domain/theme.js";

const theme = resolveTheme(undefined, normalizeConfig({ theme: { nerdFonts: "off" } }));
function segment(
	id: string,
	content: string,
	compactContent?: string,
	priority = 10,
	overflow: StatusSegment["overflow"] = "secondary",
): StatusSegment {
	const result: SegmentRenderResult = { visible: true, content, ...(compactContent ? { compactContent } : {}) };
	return { id, defaultPriority: priority, overflow, render: () => result };
}

describe("status contracts", () => {
	it("normalizes presets, explicit empty groups, and duplicates", () => {
		expect(
			normalizeStatusLayout("default", { left: ["model", "model"], right: [], secondary: ["git", "git"] }),
		).toEqual({
			left: ["model"],
			right: [],
			secondary: ["git"],
		});
		expect(normalizeConfig({ preset: "minimal" }).statusLine.layout.left).toEqual(["path", "git"]);
	});
	it("supports every thinking label and clamps context percentages", () => {
		const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
		for (const level of levels) {
			const result = renderStatus({ left: ["thinking"], right: [], secondary: [] }, { thinkingLevel: level }, 80, {
				segments: createBuiltinSegments(),
				theme,
			});
			expect(result.primary).toContain(
				level === "minimal" ? "think:min" : level === "medium" ? "think:med" : `think:${level}`,
			);
		}
		expect(contextPercent({ percent: -10 })).toBe(0);
		expect(contextPercent({ percent: 140 })).toBe(100);
	});

	it("normalizes context thresholds and snapshot status values", () => {
		expect(contextState(49)).toBe("low");
		expect(contextState(90)).toBe("critical");
		expect(contextPercent({ currentTokens: 50, windowTokens: 100 })).toBe(50);
		const initial = createSnapshot(2, 0, { thinkingLevel: "off", context: { percent: 20 } });
		const next = replaceSnapshot(initial, 2, { thinkingLevel: "high", context: { percent: 80 } });
		expect(next.revision).toBe(1);
		expect(next.thinkingLevel).toBe("high");
	});
});

describe("responsive status renderer", () => {
	it("fits every documented width without exceeding it", () => {
		const segments = new Map([
			["model", segment("model", "model-name", "m", 1, "primary")],
			["path", segment("path", "/very/long/path", "~/path", 3)],
			["git", segment("git", "main +2", "main", 4)],
			["extension_statuses", segment("extension_statuses", "extension status", "status", 20)],
		]);
		for (const width of [1, 20, 40, 60, 80, 120, 160]) {
			const result = renderStatus(
				{ left: ["model", "path", "git"], right: [], secondary: ["extension_statuses"] },
				{ model: "model-name" },
				width,
				{ segments, theme, separator: "|" },
			);
			expect(result.lines.every((line) => [...line].length <= width)).toBe(true);
		}
	});

	it("drops disabled, unknown, throwing, and duplicate segments safely", () => {
		const throwing: StatusSegment = {
			id: "bad",
			defaultPriority: 1,
			render: () => {
				throw new Error("bad");
			},
		};
		const result = renderStatus(
			{ left: ["model", "model", "unknown", "bad"], right: [], secondary: [] },
			{ model: "model" },
			20,
			{
				segments: new Map([
					["model", segment("model", "model", undefined, 100, "primary")],
					["bad", throwing],
				]),
				theme,
				options: { model: { disabled: true } },
			},
		);
		expect(result.lines).toEqual([]);
	});
});

describe("cached providers", () => {
	it("parses git porcelain counts", () => {
		const value = parseGitStatus("## main...origin/main [ahead 2]\nM  staged.ts\n M work.ts\n?? new.ts\n");
		expect(value).toMatchObject({ available: true, branch: "main", staged: 1, unstaged: 1, untracked: 1, ahead: 2 });
	});
	it("deduplicates cached git refreshes and finalizes usage once", async () => {
		let calls = 0;
		const provider = new CachedGitProvider(
			{
				run: async () => {
					calls++;
					return { stdout: "## main\n", stderr: "", code: 0 };
				},
			},
			1000,
		);
		await Promise.all([provider.get("/repo"), provider.get("/repo")]);
		expect(calls).toBe(1);
		const usage = new InMemoryUsageProvider();
		usage.record("s", { inputTokens: 2, outputTokens: 3, streaming: true }, { eventId: "e" });
		usage.record("s", { inputTokens: 20, outputTokens: 4 }, { eventId: "e", finalized: true });
		usage.record("s", { inputTokens: 99 }, { eventId: "e" });
		expect(usage.get("s").inputTokens).toBe(20);
		expect(usage.get("s").streaming).toBe(false);
		const context = new InMemoryContextProvider();
		context.set("s", { percent: 40 });
		expect(context.get("s")?.percent).toBe(40);
	});
});
