import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { createPiStyleRuntime } from "../../extension-src/pi-style/app/runtime.js";
import { THEME_REFRESH_WIDGET_KEY } from "../../extension-src/pi-style/app/theme-refresh.js";
import { normalizeConfig } from "../../extension-src/pi-style/domain/config-normalization.js";
import { getRenderCacheKey, memoizedStateComponent } from "../../extension-src/pi-style/features/tools/boxed/shared.js";
import { getThemeExtra, resetThemeExtrasCache } from "../../extension-src/pi-style/shared/theme-extras.js";

// Exercise Pi's real forwarding reference, not a stable-method fake TUI.
const { createInteractiveTuiReference } = await import(
	new URL("./modes/interactive/tui-renderer.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href
);

interface Component {
	render(width: number): string[];
	invalidate(): void;
	dispose?(): void;
}

function hostFixture(path: string) {
	let backing = { name: "same", sourcePath: path, colors: {}, fg: (_token: string, text: string) => text };
	const theme = new Proxy(backing, { get: (_target, key) => Reflect.get(backing, key) });
	const widgets = new Map<string, Component>();
	const state = {};
	let transcriptExtra = "";
	const makeTui = () => ({
		invalidations: 0,
		renders: 0,
		invalidate() {
			this.invalidations++;
			// ToolExecution.invalidate rebuilds memoized tool components before widgets.
			const component = memoizedStateComponent(state, "tool", getRenderCacheKey("tool", theme), () => {
				const captured = getThemeExtra(theme, "dividerChar");
				return { render: () => [captured], invalidate() {} };
			});
			transcriptExtra = component.render(80)[0] ?? "";
			for (const widget of widgets.values()) widget.invalidate();
		},
		requestRender() {
			this.renders++;
		},
	});
	let current = makeTui();
	const tui = createInteractiveTuiReference(() => current) as ReturnType<typeof makeTui>;
	const ui = {
		theme,
		setWidget(key: string, factory: ((tui: unknown, theme: unknown) => Component) | undefined) {
			widgets.get(key)?.dispose?.();
			widgets.delete(key);
			if (factory) widgets.set(key, factory(tui, theme));
		},
		getEditorComponent: () => () => {},
		setEditorComponent() {
			throw new Error("must preserve existing editor");
		},
	} as unknown as ExtensionUIContext;
	return {
		ui,
		tui,
		widgets,
		reload() {
			backing = { ...backing, colors: {} };
		},
		swapRenderer() {
			current = makeTui();
		},
		get rawTui() {
			return current;
		},
		get transcriptExtra() {
			return transcriptExtra;
		},
	};
}

const configFor = (preserved = false) =>
	normalizeConfig({
		statusLine: { enabled: false },
		editor: { enabled: preserved },
		compatibility: { preferExistingEditor: true },
		startup: { mode: "off" },
	});
const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));
afterEach(resetThemeExtrasCache);

describe("independent theme extras refresh through real Pi TUI reference", () => {
	it.each([false, true])("refreshes transcript caches with status off and preserved editor=%s", async (preserved) => {
		const dir = mkdtempSync(join(tmpdir(), "pi-style-theme-refresh-"));
		const path = join(dir, "same.json");
		const write = (value: string) => writeFileSync(path, JSON.stringify({ extras: { dividerChar: value } }));
		write("a");
		const host = hostFixture(path);
		const original = host.rawTui.invalidate;
		const config = configFor(preserved);
		const runtime = createPiStyleRuntime({ mode: "tui", hasUI: true, ui: host.ui, config }, 1);
		try {
			expect(host.tui.invalidate).not.toBe(host.tui.invalidate);
			expect(host.rawTui.invalidate).toBe(original);
			expect(runtime.installationState.editor).toBe(preserved ? "preserved" : "disabled");
			expect([...host.widgets.keys()]).toEqual([THEME_REFRESH_WIDGET_KEY]);
			host.tui.invalidate();
			expect(host.transcriptExtra).toBe("a");
			write("b");
			host.reload();
			// No file read or refresh during rendering.
			expect(host.widgets.get(THEME_REFRESH_WIDGET_KEY)?.render(80)).toEqual([]);
			expect(getThemeExtra(host.ui.theme, "dividerChar")).toBe("a");
			host.tui.invalidate();
			expect(host.transcriptExtra).toBe("a");
			await flush();
			expect(host.transcriptExtra).toBe("b");
			expect(host.rawTui.invalidations).toBe(3);
			expect(host.rawTui.renders).toBe(1);
			// The queued callback must target the CURRENT renderer, not a captured method.
			write("c");
			host.reload();
			host.tui.invalidate();
			host.swapRenderer();
			const swappedOriginal = host.rawTui.invalidate;
			await flush();
			expect(host.transcriptExtra).toBe("c");
			expect(host.rawTui.invalidations).toBe(1);
			expect(host.rawTui.renders).toBe(1);
			expect(host.rawTui.invalidate).toBe(swappedOriginal);
			runtime.configure(normalizeConfig({ ...config, enabled: false }));
			expect(host.widgets.size).toBe(0);
			runtime.configure(config);
			expect(host.widgets.size).toBe(1);
			write("d");
			host.reload();
			host.tui.invalidate();
			const count = host.rawTui.invalidations;
			runtime.dispose();
			await flush();
			expect(host.rawTui.invalidations).toBe(count);
			expect(host.rawTui.invalidate).toBe(swappedOriginal);
		} finally {
			runtime.dispose();
			expect(host.widgets.size).toBe(0);
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("coalesces refreshes and does not queue indefinitely", async () => {
		const host = hostFixture("");
		const runtime = createPiStyleRuntime({ mode: "tui", hasUI: true, ui: host.ui, config: configFor() }, 1);
		try {
			host.reload();
			host.tui.invalidate();
			host.reload();
			host.tui.invalidate();
			await flush();
			expect(host.rawTui.invalidations).toBe(3);
			expect(host.rawTui.renders).toBe(1);
			await flush();
			expect(host.rawTui.invalidations).toBe(3);
		} finally {
			runtime.dispose();
		}
	});
});

it.each([
	{ mode: "tui" as const, hasUI: true, enabled: false },
	{ mode: "tui" as const, hasUI: false, enabled: true },
	{ mode: "rpc" as const, hasUI: true, enabled: true },
])("does not mount a theme bridge for %j", ({ mode, hasUI, enabled }) => {
	const host = hostFixture("");
	const original = host.rawTui.invalidate;
	const runtime = createPiStyleRuntime(
		{ mode, hasUI, ui: host.ui, config: normalizeConfig({ ...configFor(), enabled }) },
		1,
	);
	expect(host.widgets.size).toBe(0);
	expect(host.rawTui.invalidate).toBe(original);
	runtime.dispose();
});
