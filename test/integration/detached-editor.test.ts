import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../../extension-src/pi-style/domain/config-normalization.js";
import { StyledEditor } from "../../extension-src/pi-style/features/editor/index.js";
import {
	DETACHED_EDITOR_KEY,
	type DetachedEditorRegistry,
	registerDetachedEditor,
} from "../../extension-src/pi-style/pi/detached-editor.js";
import piStyleExtension from "../../extension-src/pi-style/pi/index.js";
import { FakePiHost } from "../helpers/fake-pi-host.js";

const globals = globalThis as Record<symbol, unknown>;
const tui = { requestRender() {}, terminal: { rows: 24 } } as never;
const theme = {
	fg: (color: string, text: string) => `[${color}]${text}`,
	bg: (color: string, text: string) => `[${color}]${text}`,
	getColorMode: () => "truecolor",
} as never;
const mainTheme = { borderColor: (text: string) => text, selectList: {} } as never;
const keys = { matches: () => false } as never;

describe("detached editor integration", () => {
	it("registers for a TUI session without inheriting Main identity or draft", async () => {
		const host = new FakePiHost({ flags: { color: "#abc" } });
		Object.assign(host.extensionApi, { getSessionName: () => "Main secret" });
		piStyleExtension(host.extensionApi);
		await host.sessionStart();
		const registry = globals[DETACHED_EDITOR_KEY] as DetachedEditorRegistry;
		const detached = registry.create(tui, theme, keys, { sessionName: "Child task", editorBorderColor: "#123456" });
		const main = host.extensionContext.ui.getEditorComponent()?.(tui, mainTheme, keys);
		expect(detached).toBeInstanceOf(StyledEditor);
		expect(detached?.borderColor("rule")).toBe("[borderMuted]rule");
		expect(detached?.render(80)[0]).toContain("Child task");
		expect(detached?.render(80)[0]).toContain("\x1b[38;2;18;52;86m");
		expect(detached?.render(80)[0]).not.toContain("Main secret");
		detached?.setText("child draft");
		expect(main?.getText()).toBe("");
		await host.emit("session_info_changed", { type: "session_info_changed", name: "Changed Main" });
		expect(detached?.render(80)[0]).toContain("Child task");
		await host.sessionShutdown();
		expect(globals[DETACHED_EDITOR_KEY]).toBeUndefined();
		expect(registry.create(tui, theme, keys, {})).toBeUndefined();
		detached?.handleInput("x");
		expect(detached?.getText()).toBe("child draftx");
		detached?.dispose();
	});

	it("replaces live child metadata while preserving identity, draft and live configuration", () => {
		let config = { ...DEFAULT_CONFIG, editor: { ...DEFAULT_CONFIG.editor, showMetadata: true } };
		const installation = registerDetachedEditor(() => config);
		const registry = globals[DETACHED_EDITOR_KEY] as DetachedEditorRegistry;
		const editor = registry.create(tui, theme, keys, { sessionName: "@scout", editorBorderColor: "#123456" });
		expect(editor).toBeDefined();
		if (!editor) throw new Error("detached editor unavailable");
		try {
			editor?.setText("child draft");
			registry.update?.(editor, { context: { currentTokens: 12000, windowTokens: 100000 } });
			expect(editor?.render(100).join("\n")).toContain("ctx 12%");
			registry.update?.(editor, { sessionName: "Main", context: { percent: 45 } });
			expect(editor?.render(100).join("\n")).toContain("ctx 45%");
			expect(editor?.render(100).join("\n")).toContain("@scout");
			expect(editor?.render(100).join("\n")).toContain("\x1b[38;2;18;52;86m");
			expect(editor?.getText()).toBe("child draft");
			config = { ...config, editor: { ...config.editor, showMetadata: false } };
			installation.configure(config);
			registry.update?.(editor, { context: { percent: 80 } });
			expect(editor?.render(100).join("\n")).not.toContain("ctx");
			config = { ...config, editor: { ...config.editor, showMetadata: true } };
			installation.configure(config);
			expect(editor?.render(100).join("\n")).toContain("ctx 80%");
			registry.update?.(editor, {});
			expect(editor?.render(100).join("\n")).not.toContain("ctx");
			expect(editor?.render(100).join("\n")).toContain("@scout");
			expect(editor?.getText()).toBe("child draft");
		} finally {
			editor?.dispose();
			installation.dispose();
		}
	});

	it("renders detached status using live config and child data, independently of editor styling", () => {
		let config = {
			...DEFAULT_CONFIG,
			editor: { ...DEFAULT_CONFIG.editor, enabled: false },
			statusLine: {
				...DEFAULT_CONFIG.statusLine,
				layout: { left: ["model", "thinking", "token_in", "context_total", "path"], right: [], secondary: [] },
			},
		};
		const installation = registerDetachedEditor(() => config);
		const registry = globals[DETACHED_EDITOR_KEY] as DetachedEditorRegistry;
		const snapshot = {
			model: "child-model",
			thinkingLevel: "high" as const,
			cwd: "/child",
			context: { currentTokens: 24000, windowTokens: 200000, percent: 12 },
			usage: { inputTokens: 12400, outputTokens: 3200, cacheReadTokens: 0, cacheWriteTokens: 0, streaming: false },
		};
		try {
			expect(registry.create(tui, theme, keys, {})).toBeUndefined();
			const rendered = stripTerminalSequences(registry.renderStatus(theme, 180, snapshot)?.join("\n") ?? "");
			expect(rendered).toContain("child-model");
			expect(rendered).toContain("high");
			expect(rendered).toContain("child");
			expect(rendered).toContain("in:12400");
			expect(rendered).toContain("24000/200000");
			config = { ...config, statusLine: { ...config.statusLine, enabled: false } };
			expect(registry.renderStatus(theme, 180, snapshot)).toBeUndefined();
		} finally {
			installation.dispose();
		}
		expect(registry.renderStatus(theme, 180, snapshot)).toBeUndefined();
	});

	it("does not request another frame for unchanged metadata during detached rendering", () => {
		const installation = registerDetachedEditor(() => DEFAULT_CONFIG);
		const registry = globals[DETACHED_EDITOR_KEY] as DetachedEditorRegistry;
		const requestRender = vi.fn();
		const editor = registry.create({ requestRender, terminal: { rows: 24 } } as never, theme, keys, {
			sessionName: "Child",
		});
		if (!editor) throw new Error("Missing detached editor");
		const snapshot = { model: "child-model", context: { currentTokens: 12000, windowTokens: 100000, percent: 12 } };
		try {
			registry.update?.(editor, snapshot);
			editor.render(100);
			requestRender.mockClear();
			for (let i = 0; i < 5; i++) {
				registry.update?.(editor, { ...snapshot, context: { ...snapshot.context } });
				editor.render(100);
			}
			expect(requestRender).not.toHaveBeenCalled();
			registry.update?.(editor, { ...snapshot, context: { ...snapshot.context, percent: 45 } });
			expect(requestRender).toHaveBeenCalledOnce();
		} finally {
			editor.dispose();
			installation.dispose();
		}
	});

	it("keeps registrations independent and applies live config without changing identity", () => {
		const previous = { create: () => undefined };
		globals[DETACHED_EDITOR_KEY] = previous;
		let config = DEFAULT_CONFIG;
		const first = registerDetachedEditor(() => config);
		const second = registerDetachedEditor(() => config);
		const registry = globals[DETACHED_EDITOR_KEY] as DetachedEditorRegistry;
		const editor = registry.create(tui, theme, keys, { sessionName: "Mine" });
		expect(editor).toBeDefined();
		first.dispose();
		expect(registry.create(tui, theme, keys, { sessionName: "Other" })).toBeDefined();
		config = { ...config, editor: { ...config.editor, hint: "detached hint" } };
		second.configure(config);
		expect(editor?.render(80).join("\n")).toContain("detached hint");
		config = { ...config, enabled: false };
		expect(registry.create(tui, theme, keys, {})).toBeUndefined();
		second.dispose();
		expect(registry.create(tui, theme, keys, {})).toBeUndefined();
		expect(globals[DETACHED_EDITOR_KEY]).toBe(previous);
		delete globals[DETACHED_EDITOR_KEY];
	});
});
