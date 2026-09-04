import {
	AssistantMessageComponent,
	CompactionSummaryMessageComponent,
	createReadToolDefinition,
	initTheme,
	ToolExecutionComponent,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { resetBatchRegistry } from "../../extension-src/pi-style/features/tools/boxed/batch.js";
import {
	type CompatibilityProbeReport,
	disposePiCompatibilityProbe,
	probePiCompatibility,
	targetSpecs,
} from "../../extension-src/pi-style/pi/compatibility-probe.js";
import { getCompatibilityRecords } from "../../extension-src/pi-style/pi/compatibility-registry.js";
import piStyleExtension from "../../extension-src/pi-style/pi/index.js";
import { stripAnsi } from "../../extension-src/pi-style/shared/ansi.js";
import { FakePiHost } from "../helpers/fake-pi-host.js";
import { createFakeTheme } from "../helpers/fake-theme.js";

initTheme(createFakeTheme());

// Mirrors interactive-mode renderSessionEntries for a resumed session: a user
// message, an assistant message, a tool call with result, and a compaction block.
function renderRestoredChat() {
	const user = new UserMessageComponent("hello", createFakeTheme());
	const assistant = new AssistantMessageComponent(
		{ content: [{ type: "text", text: "done" }] },
		false,
		createFakeTheme(),
		"hidden",
		1,
	);
	// Pi ≥0.85 resolves built-in renderers only through the registered
	// toolDefinition the interactive mode passes in (the internal
	// builtInToolDefinition fallback is gone), so mirror production here.
	const tool = new ToolExecutionComponent(
		"read",
		"call_1",
		{ path: "x" },
		{},
		createReadToolDefinition("/fake"),
		undefined,
		"/fake",
	);
	tool.updateResult({ content: [{ type: "text", text: "file contents" }], details: {}, isError: false });
	const compaction = new CompactionSummaryMessageComponent(
		{ tokensBefore: 12000, summary: "old stuff" },
		createFakeTheme(),
	);
	return { user, assistant, tool, compaction };
}

function linesOf(component: { render(width: number): string[] }): string[] {
	try {
		return component.render(80);
	} catch {
		return [];
	}
}

const hasBoxedMark = (lines: string[]) =>
	lines.some((line) => line.includes("╭") || line.includes("┌") || line.includes("╰") || line.includes("└"));
const hasPrefixMark = (lines: string[]) =>
	lines.some((line) => line.includes("❯") || line.includes("│ ") || line.includes("[user]"));

describe("resumed-session rendering (renderBeforeBind ordering)", () => {
	let batchReport: CompatibilityProbeReport | undefined;
	afterEach(() => {
		resetBatchRegistry();
		if (batchReport) {
			disposePiCompatibilityProbe(batchReport);
			batchReport = undefined;
		}
		// Session switches retain Tier C patches across session_shutdown; restore the
		// shared prototype registry so the next test starts from native identities.
		for (const spec of targetSpecs) {
			for (const record of getCompatibilityRecords(spec.target)) record.disposer();
		}
	});

	it("decorates tool boxes and special-block boxes rendered in the shutdown→start gap", async () => {
		const host = new FakePiHost({ mode: "tui" });
		piStyleExtension(host.extensionApi);

		// Startup: patches installed before the chat is rendered.
		await host.sessionStart();

		// In-app resume: Pi emits session_shutdown, renders the restored chat
		// (renderBeforeBind) while the retained patches are still active, then emits
		// session_start which restores the previous generation and reinstalls.
		await host.sessionShutdown();
		const renderedDuringGap = renderRestoredChat();
		await host.sessionStart();

		const userLines = linesOf(renderedDuringGap.user);
		const assistantLines = linesOf(renderedDuringGap.assistant);
		const toolLines = linesOf(renderedDuringGap.tool);
		const compactionLines = linesOf(renderedDuringGap.compaction);

		// The user-message `❯` prefix is off by default (it would duplicate the editor
		// prompt glyph); the adapter still installs and survives the gap, rendering the
		// message natively. Assistant prefix (`│`) below confirms message-prefix
		// decoration survives the gap.
		expect(stripAnsi(userLines.join("\n"))).toContain("hello");
		// Single-line assistant replies previously lost their prefix: the native
		// multiline OSC133 envelope puts the only body line last, which the old
		// firstContentIndex logic excluded.
		expect(hasPrefixMark(assistantLines)).toBe(true);
		// Read tools render the boxless inline line (even for a lone call);
		// compaction special blocks stay boxed.
		expect(stripAnsi(toolLines.join("\n"))).toContain("➔ Read x");
		expect(hasBoxedMark(compactionLines)).toBe(true);

		// The boxed output is cached per updateDisplay; a later frame render must
		// keep the decoration after the retained report was restored/reinstalled.
		expect(linesOf(renderedDuringGap.tool).join("\n")).toBe(toolLines.join("\n"));
		expect(stripAnsi(linesOf(renderedDuringGap.tool).join("\n"))).toContain("➔ Read x");

		// Fresh components rendered after reinstall are decorated too.
		const afterReinstall = renderRestoredChat();
		expect(stripAnsi(linesOf(afterReinstall.tool).join("\n"))).toContain("➔ Read x");
		expect(hasBoxedMark(linesOf(afterReinstall.compaction))).toBe(true);

		await host.sessionShutdown();
	});

	it("batch members render zero lines through real ToolExecutionComponents (no blank margin)", () => {
		batchReport = probePiCompatibility("0.83.0", { toolSnapshot: { style: "compact-box" } });
		const tools: ToolExecutionComponent[] = [];
		for (let i = 1; i <= 10; i++) {
			tools.push(
				new ToolExecutionComponent(
					"read",
					`call_${i}`,
					{ path: `file${i}.ts` },
					{},
					createReadToolDefinition("/fake"),
					undefined,
					"/fake",
				),
			);
		}
		for (const tool of tools) {
			tool.updateResult({ content: [{ type: "text", text: "ok" }], details: {}, isError: false });
		}

		const stacked: string[] = [];
		for (const tool of tools) stacked.push(...linesOf(tool));
		// Pi adds a hardcoded Spacer child to every ToolExecutionComponent; hidden
		// batch members must still contribute zero lines (leader keeps its spacer).
		let trailingBlanks = 0;
		for (let i = stacked.length - 1; i >= 0; i--) {
			if (stripAnsi(stacked[i] ?? "").trim() === "") trailingBlanks++;
			else break;
		}
		const joined = stripAnsi(stacked.join("\n"));
		expect(joined).toContain("Read (10)");
		expect(joined).toContain("└─ 5 more");
		expect(trailingBlanks).toBeLessThan(3);
		// The panel is a single boxless block: header + 5 members + "5 more".
		const [, second, , , , , , , , last] = tools;
		expect(second?.render(80)).toHaveLength(0); // second member: fully hidden
		expect(last?.render(80)).toHaveLength(0); // last member: fully hidden
		expect(tools[0]?.render(80)).toHaveLength(8); // leader: spacer + header + 5 + more
	});
});
