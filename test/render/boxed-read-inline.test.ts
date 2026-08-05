// Contract: a lone `read` call renders as a single inline line
// (`➔ Read <path>`), never as the header + tree panel. Batched reads keep the
// header + tree. Errors keep their inline error text.

import { beforeEach, describe, expect, it } from "vitest";
import {
	closeActiveBatch,
	EMPTY_BATCH_COMPONENT,
	registerBatchCall,
	registerBatchResult,
	renderBatchAwareCall,
	resetBatchRegistry,
} from "../../extension-src/pi-style/features/tools/boxed/batch.js";
import { stripAnsi } from "../../extension-src/pi-style/shared/ansi.js";

const READ_META = { toolName: "read", label: "Read" };
// No-color theme: fg/bold pass text through; structural ANSI is stripped below.
const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as never;

function context(toolCallId: string) {
	return {
		toolCallId,
		args: {},
		invalidate() {},
		state: {},
		cwd: "/proj",
		executionStarted: true,
		argsComplete: true,
		isPartial: false,
		expanded: false,
		showImages: false,
		isError: false,
	} as never;
}

function render(callId: string, detail: string, width = 120): string[] {
	const { batch } = registerBatchCall(READ_META, detail, context(callId));
	return renderBatchAwareCall(theme, batch).render(width);
}

describe("boxed read inline rendering", () => {
	beforeEach(() => {
		closeActiveBatch();
		resetBatchRegistry();
	});

	it("renders a lone read as one inline line without count or tree", () => {
		const lines = render("c1", "extension-src/pi-style/features/tools/boxed/read.ts");
		expect(lines).toHaveLength(1);
		const text = stripAnsi(lines[0]);
		expect(text).toContain("Read");
		expect(text).toContain("extension-src/pi-style/features/tools/boxed/read.ts");
		expect(text).not.toContain("(1)");
		expect(text).not.toContain("└─");
		expect(text).not.toContain("├─");
	});

	it("shows a pending glyph before the path while the call runs", () => {
		const text = stripAnsi(render("c1", "src/a.ts")[0]);
		expect(text).toContain("◌");
	});

	it("drops the pending glyph once the lone read settles", () => {
		render("c1", "src/a.ts");
		registerBatchResult(READ_META, { isPartial: false, isError: false, errorText: undefined }, context("c1"));
		const lines = render("c1", "src/a.ts");
		expect(lines).toHaveLength(1);
		const text = stripAnsi(lines[0]);
		expect(text).toBe("➔ Read src/a.ts");
		expect(text).not.toContain("◌");
	});

	it("keeps the path range detail inline", () => {
		render("c1", "src/a.ts:5-20");
		registerBatchResult(READ_META, { isPartial: false, isError: false, errorText: undefined }, context("c1"));
		expect(stripAnsi(render("c1", "src/a.ts:5-20")[0])).toBe("➔ Read src/a.ts:5-20");
	});

	it("keeps the error glyph and error text visible inline", () => {
		render("c1", "src/secret.ts");
		registerBatchResult(
			READ_META,
			{ isPartial: false, isError: true, errorText: "EACCES: permission denied" },
			context("c1"),
		);
		const lines = render("c1", "src/secret.ts");
		expect(lines.length).toBeGreaterThan(1);
		const joined = stripAnsi(lines.join("\n"));
		expect(joined).toContain("✗");
		expect(joined).toContain("permission denied");
	});

	it("keeps the header + tree panel for batched reads", () => {
		render("c1", "src/a.ts");
		const { batch: batch2, isLeader } = registerBatchCall(READ_META, "src/b.ts", context("c2"));
		expect(isLeader).toBe(false);
		expect(batch2.members).toHaveLength(2);
		const lines = stripAnsi(renderBatchAwareCall(theme, batch2).render(120).join("\n"));
		expect(lines).toContain("Read (2)");
		expect(lines).toContain("src/a.ts");
		expect(lines).toContain("src/b.ts");
		expect(lines).toContain("├─");
		// Non-leader members render zero lines.
		expect(EMPTY_BATCH_COMPONENT.render(120)).toEqual([]);
	});
});
