import { describe, expect, it } from "vitest";
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
