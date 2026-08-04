import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../../extension-src/pi-style/domain/config-normalization.js";
import { createBuiltinSegments } from "../../extension-src/pi-style/domain/status.js";
import { renderStatus } from "../../extension-src/pi-style/domain/status-renderer.js";
import { resolveTheme } from "../../extension-src/pi-style/domain/theme.js";
import { StyledEditor } from "../../extension-src/pi-style/features/editor/index.js";
import { decorateMessageRender } from "../../extension-src/pi-style/features/messages/index.js";
import { renderStartup } from "../../extension-src/pi-style/features/startup/index.js";
import { createToolDecorationOwner } from "../../extension-src/pi-style/features/tools/index.js";
import { visibleWidth } from "../../extension-src/pi-style/shared/ansi.js";

const widths = [0, 1, 20, 40, 60, 80, 120, 160];
const config = normalizeConfig({ theme: { nerdFonts: "off" }, startup: { mode: "compact" } });
const theme = resolveTheme(undefined, config);
function assertSafe(lines: readonly string[], width: number) {
	expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
	for (const line of lines) expect(line.includes("\x1b[") ? line.includes("\x1b[0m") : true).toBe(true);
}
function editor() {
	return new StyledEditor(
		{ requestRender() {}, terminal: { rows: 24 } } as never,
		{ borderColor: (value: string) => `\x1b[34m${value}\x1b[0m`, selectList: {} } as never,
		{ matches: () => false } as never,
		{
			config,
			snapshot: { model: "long-model", cwd: "/a/very/long/path", thinkingLevel: "high" },
			theme: {} as never,
			onSnapshot: () => {},
		},
	);
}

describe("surface rendering width matrix", () => {
	it("covers status and startup at every required width with missing and long data", () => {
		for (const width of widths) {
			const status = renderStatus(
				{ left: ["model", "path", "git", "context_pct"], right: [], secondary: [] },
				{
					model: "model-name-that-is-deliberately-long",
					cwd: "/a/very/long/path/with/a/branch/status",
				},
				width,
				{ segments: createBuiltinSegments(), theme },
			);
			assertSafe(status.lines, width);
			assertSafe(
				renderStartup(
					{
						reason: "startup",
						model: "long-model",
						cwd: "/long/project/path",
						provider: "provider",
						compatibility: "native fallback",
					},
					config,
					{},
					width,
				),
				width,
			);
			assertSafe(renderStartup({ reason: "startup" }, config, {}, width), width);
		}
	});

	it("covers editor, message, and tool adapters without changing certified markers", () => {
		const styled = editor();
		styled.setText("long editable Unicode text Ω");
		for (const width of widths) assertSafe(styled.render(width), width);
		let nativeCalls = 0;
		const message = decorateMessageRender(
			(width: number) => {
				nativeCalls++;
				return width >= 20 ? [`\x1b]133;A\x07answer\x1b]133;B\x07\x1b]133;C\x07`] : ["answer"];
			},
			{},
			[80],
		);
		expect(nativeCalls).toBe(1);
		expect(message).toBeDefined();
		for (const width of widths) {
			const rendered = decorateMessageRender(
				(nativeWidth: number) => [nativeWidth > 2 ? "\x1b]133;A\x07answer\x1b]133;B\x07\x1b]133;C\x07" : ""],
				{},
				[width],
			) as string[];
			assertSafe(rendered, width);
			if (width > 20) {
				expect(rendered.join("\n")).toContain("\x1b]133;");
				expect(rendered.join("\n")).toContain("\x07");
			}
		}
		const context = {
			args: {},
			toolCallId: "id",
			invalidate() {},
			lastComponent: undefined,
			state: {},
			cwd: "/fake",
			executionStarted: true,
			argsComplete: true,
			isPartial: true,
			expanded: false,
			showImages: false,
			isError: false,
		};
		const owner = createToolDecorationOwner();
		const selected = owner.decorateToolRendererSelection(
			"tool-call-renderer",
			() => () => ({ render: (width: number) => [`command at ${width}`] }),
			{},
			[{}, {}, context],
		) as ((...args: unknown[]) => { render(width: number): string[] }) | undefined;
		expect(selected).toBeTypeOf("function");
		const toolComponent = selected?.({}, {}, context);
		expect(toolComponent).toBeDefined();
		const toolLines = toolComponent?.render(80) ?? [];
		assertSafe(toolLines, 80);
		expect(toolLines.join("\n")).toContain("[tool:running]");
		owner.dispose();
	});
});
