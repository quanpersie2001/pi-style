import type { ExtensionAPI, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { resetBatchRegistry } from "../../extension-src/pi-style/features/tools/boxed/batch.js";
import { renderBoxedToolCall } from "../../extension-src/pi-style/features/tools/boxed/index.js";
import { registerPublicToolRenderers } from "../../extension-src/pi-style/pi/tool-renderers.js";
import { stripAnsi } from "../../extension-src/pi-style/shared/ansi.js";
import { createFakeTheme } from "../helpers/fake-theme.js";

const key = Symbol.for("pi-style.detached-tool-renderers.v1");
const host = globalThis as unknown as Record<
	symbol,
	{ revision: unknown; resolve(name: string): ToolRenderers | undefined }
>;

it("registers a lifetime/config-aware optional display port without tool execution registration", () => {
	const registerTool = vi.fn();
	const registerToolRenderer = vi.fn();
	const provider = registerPublicToolRenderers({ registerTool, registerToolRenderer } as unknown as ExtensionAPI);
	try {
		expect(host[key]?.resolve("read")).toBeUndefined();
		const revision = host[key]?.revision;
		provider.configure(true);
		expect(host[key]?.revision).not.toBe(revision);
		expect(host[key]?.resolve("read")?.renderShell).toBe("self");
		expect(host[key]?.resolve("bash")).toBeUndefined();
		expect(host[key]?.resolve("unknown")).toBeUndefined();
		provider.configure(false);
		expect(host[key]?.resolve("read")).toBeUndefined();
		expect(registerToolRenderer).toHaveBeenCalledOnce();
		expect(registerTool).not.toHaveBeenCalled();
	} finally {
		provider.clear();
	}
	expect(host[key]).toBeUndefined();
});

it("republishes the same owner after session clear without letting a superseded owner steal the port", () => {
	const owner = registerPublicToolRenderers({} as ExtensionAPI);
	owner.configure(true);
	const port = host[key];
	owner.clear();
	owner.configure(true);
	expect(host[key]).toBe(port);
	expect(host[key]?.resolve("read")).toBeDefined();
	const replacement = registerPublicToolRenderers({} as ExtensionAPI);
	replacement.configure(true);
	const newer = host[key];
	owner.clear();
	owner.configure(true);
	expect(host[key]).toBe(newer);
	replacement.clear();
	owner.configure(true);
	expect(host[key]).toBeUndefined();
	owner.clear();
});

it.each(["text", "diff"])("sanitizes untrusted %s before theme styling", (source) => {
	const provider = registerPublicToolRenderers({} as ExtensionAPI);
	provider.configure(true);
	try {
		const renderer = host[key]?.resolve("read");
		const theme = createFakeTheme();
		const malicious = "safe\x1b]52;c;Y2xpcA==\x07\x1b[2J\x1b[H\x00\x08\x0d\x7f\x9b2Jend";
		const context = {
			args: {},
			toolCallId: "security",
			state: {},
			cwd: "/child",
			invalidate() {},
			executionStarted: false,
			argsComplete: true,
			isPartial: false,
			expanded: false,
			showImages: false,
			isError: false,
		};
		const component = renderer?.renderResult?.(
			source === "text"
				? { content: [{ type: "text", text: malicious }] }
				: { content: [], details: { diff: malicious } },
			{ expanded: false, isPartial: false },
			theme,
			context,
		);
		const raw = component?.render(100).join("\n") ?? "";
		expect(raw).not.toContain("\x1b]52");
		expect(raw).not.toContain("\x1b[2J");
		expect(raw).not.toContain("\x1b[H");
		for (const code of [0, 7, 8, 13, 127, 155]) expect(raw).not.toContain(String.fromCharCode(code));
		expect(stripAnsi(raw)).toContain("safe");
		expect(stripAnsi(raw)).toContain("end");
	} finally {
		provider.clear();
	}
});

describe("detached row state isolation", () => {
	it("does not mutate Main's existing batch with the same call id or install elapsed timers", () => {
		vi.useFakeTimers();
		resetBatchRegistry();
		const theme = createFakeTheme();
		const mainContext = {
			args: { path: "main.ts" },
			toolCallId: "same-id",
			state: {},
			cwd: "/main",
			invalidate() {},
			executionStarted: false,
			argsComplete: true,
			isPartial: false,
			expanded: false,
			showImages: false,
			isError: false,
		};
		const main = renderBoxedToolCall("read", mainContext.args, theme, mainContext);
		const before = main.render(100).map(stripAnsi);
		const provider = registerPublicToolRenderers({} as ExtensionAPI); // Older Pi: display port is still usable.
		provider.configure(true);
		try {
			const renderer = host[key]?.resolve("read");
			const ctx = {
				...mainContext,
				cwd: "/child",
				args: { path: "child.ts" },
				state: {},
				executionStarted: true,
				isPartial: true,
			};
			const call = renderer?.renderCall?.(ctx.args, theme, ctx);
			expect(call?.render(100).map(stripAnsi).join("\n")).toContain("child.ts");
			const result = renderer?.renderResult?.(
				{ content: [], details: { diff: "+child diff", truncation: { truncated: true } } },
				{ expanded: false, isPartial: false },
				theme,
				{ ...ctx, isPartial: false },
			);
			const output = result?.render(100).map(stripAnsi).join("\n");
			expect(output).toContain("+child diff");
			expect(output).toContain("native tool output truncated");
			expect(main.render(100).map(stripAnsi)).toEqual(before);
			expect(vi.getTimerCount()).toBe(0);
			expect(mainContext.state).toEqual({});
		} finally {
			provider.clear();
			resetBatchRegistry();
			vi.useRealTimers();
		}
	});
});
