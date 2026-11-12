import { CustomEditor, InteractiveMode, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, TuiMainScreen } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeConfig } from "../../extension-src/pi-style/domain/config-normalization.js";
import { installEditor, StyledEditor } from "../../extension-src/pi-style/features/editor/index.js";

// Native prototype methods plus real editors/overlay stack, not a running InteractiveMode:
// no terminal input loop, session reload orchestration, provider, or screen rendering.
function nativeCall(target: object, method: string, ...args: unknown[]) {
	return Reflect.apply(Reflect.get(InteractiveMode.prototype, method), target, args);
}

function host() {
	const terminal = { rows: 24, columns: 80, hideCursor() {} };
	const ui = new TuiMainScreen(terminal as never);
	vi.spyOn(ui, "requestRender").mockImplementation(() => {});
	const keybindings = { matches: () => false };
	const defaultEditor = new CustomEditor(ui, { borderColor: (text: string) => text }, keybindings as never);
	const target = {
		ui,
		keybindings,
		defaultEditor,
		editor: defaultEditor,
		editorComponentFactory: undefined,
		editorContainer: new Container(),
		extensionDialogs: [],
		extensionOverlays: new Map(),
		nextBlockingOverlayId: 0,
		programStatus: { setBlocked: vi.fn() },
		disposeActiveSelector() {},
		// Unrelated chrome/reset dependencies intentionally do not run in this structural host.
		clearExtensionTerminalInputListeners() {},
		setExtensionFooter() {},
		setExtensionHeader() {},
		clearExtensionWidgets() {},
		footerDataProvider: { clearExtensionStatuses() {} },
		footer: { invalidate() {} },
		setupAutocompleteProvider() {},
		updateTerminalTitle() {},
		setWorkingIndicator() {},
		setHiddenThinkingLabel() {},
	};
	Object.setPrototypeOf(target, InteractiveMode.prototype);
	const installation = installEditor({
		host: {
			setEditorComponent: (factory) => nativeCall(target, "setCustomEditorComponent", factory),
			getEditorComponent: () => target.editorComponentFactory,
		},
		config: normalizeConfig({}),
		generation: 1,
		initialSnapshot: { model: "m", thinkingLevel: "off", cwd: "/work" },
	});
	if (!installation) throw new Error("pi-style editor installation failed");
	expect(target.editor).toBeInstanceOf(StyledEditor);
	return { target, installation };
}

const pasted = Array.from({ length: 12 }, (_, i) => `large pasted line ${i}`).join("\n");
function paste(editor: CustomEditor) {
	editor.handleInput(`\x1b[200~${pasted}\x1b[201~`);
	expect(editor.getText()).toMatch(/^\[paste #\d+ \+12 lines\]$/);
	expect(editor.getExpandedText()).toBe(pasted);
}
function component() {
	return { render: () => ["custom UI"], invalidate() {}, dispose: vi.fn() };
}

beforeEach(() => initTheme("dark", false));
afterEach(() => vi.restoreAllMocks());

describe("native editor/custom UI lifecycle", () => {
	it("expands large pastes across pi-style/native editor swaps and inline custom UI", async () => {
		const { target, installation } = host();
		try {
			paste(target.editor);
			nativeCall(target, "setCustomEditorComponent", undefined);
			expect(target.editor).toBe(target.defaultEditor);
			expect(target.editor.getText()).toBe(pasted);
			target.editor.setText("");
			paste(target.editor);
			nativeCall(target, "setCustomEditorComponent", installation.installedFactory);
			expect(target.editor).toBeInstanceOf(StyledEditor);
			expect(target.editor.getText()).toBe(pasted);

			target.editor.setText("");
			paste(target.editor);
			const dialog = component();
			let close = (_result: string) => {};
			const result = nativeCall(
				target,
				"showExtensionCustom",
				(_ui: unknown, _theme: unknown, _keys: unknown, done: typeof close) => {
					close = done;
					return dialog;
				},
			);
			await Promise.resolve();
			expect(target.editorContainer.children).toEqual([dialog]);
			// Native also permits editor replacement while a custom dialog owns the slot.
			nativeCall(target, "setCustomEditorComponent", undefined);
			nativeCall(target, "setCustomEditorComponent", installation.installedFactory);
			expect(target.editorContainer.children).toEqual([dialog]);
			close("done");
			await expect(result).resolves.toBe("done");
			expect(target.editorContainer.children).toEqual([target.editor]);
			expect(target.editor.getText()).toBe(pasted);
			expect(target.editor.getExpandedText()).toBe(pasted);
			expect(dialog.dispose).toHaveBeenCalledOnce();
		} finally {
			installation.dispose();
		}
	});

	it("native reset removes every extension overlay, including hidden ones, but preserves Pi-owned overlays", async () => {
		const { target, installation } = host();
		const owned = component();
		const ownedHandle = target.ui.showOverlay(owned);
		const first = component();
		const second = component();
		const third = component();
		const closes: Array<() => void> = [];
		const promises: Promise<unknown>[] = [];
		try {
			paste(target.editor);
			for (const [index, overlay] of [first, second, third].entries()) {
				const promise = nativeCall(
					target,
					"showExtensionCustom",
					(_ui: unknown, _theme: unknown, _keys: unknown, done: () => void) => {
						closes.push(done);
						return overlay;
					},
					{
						overlay: true,
						blocked: { kind: "question", message: `overlay ${index}` },
						onHandle: (handle: { setHidden(hidden: boolean): void }) => {
							if (index === 1) handle.setHidden(true);
						},
					},
				) as Promise<unknown>;
				promises.push(promise);
				await Promise.resolve();
			}
			expect(target.extensionOverlays.size).toBe(3);
			expect(Reflect.get(target.ui, "overlayStack")).toMatchObject([
				{ component: owned },
				{ component: first, hidden: false },
				{ component: second, hidden: true },
				{ component: third, hidden: false },
			]);
			const settled = vi.fn();
			for (const promise of promises) void promise.then(settled);
			nativeCall(target, "resetExtensionUI");
			expect(target.extensionOverlays.size).toBe(0);
			expect(Reflect.get(target.ui, "overlayStack")).toMatchObject([{ component: owned }]);
			expect(owned.dispose).not.toHaveBeenCalled();
			expect(ownedHandle.isHidden()).toBe(false);
			for (const overlay of [first, second, third]) expect(overlay.dispose).toHaveBeenCalledOnce();
			for (let index = 0; index < 3; index++) {
				expect(target.programStatus.setBlocked).toHaveBeenCalledWith(`extension-overlay:${index}`, undefined);
			}
			expect(target.editor).toBe(target.defaultEditor);
			expect(target.editor.getText()).toBe(pasted);
			await Promise.resolve();
			expect(settled).not.toHaveBeenCalled();
			// Late done() callbacks and a second reset must not dispose overlays twice.
			for (const close of closes) close();
			await Promise.all(promises);
			nativeCall(target, "resetExtensionUI");
			for (const overlay of [first, second, third]) expect(overlay.dispose).toHaveBeenCalledOnce();
		} finally {
			ownedHandle.hide();
			installation.dispose();
		}
	});
});
