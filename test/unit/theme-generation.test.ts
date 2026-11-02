import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../../extension-src/pi-style/domain/config-normalization.js";
import { resolveTheme } from "../../extension-src/pi-style/domain/theme.js";
import { StyledEditor } from "../../extension-src/pi-style/features/editor/index.js";
import { installStatusLine } from "../../extension-src/pi-style/features/status-line/index.js";
import { getRenderCacheKey } from "../../extension-src/pi-style/features/tools/boxed/shared.js";
import { themeCacheKey } from "../../extension-src/pi-style/shared/box.js";
import {
	getThemeExtra,
	resetThemeExtrasCache,
	setFullTheme,
} from "../../extension-src/pi-style/shared/theme-extras.js";

function proxyTheme() {
	let backing = make("31");
	function make(color: string) {
		return {
			colors: {},
			name: "same",
			sourcePath: "",
			fg: (_token: string, text: string) => `\x1b[${color}m${text}\x1b[39m`,
		};
	}
	return {
		theme: new Proxy({} as ReturnType<typeof make>, { get: (_target, key) => Reflect.get(backing, key) }),
		reload(color: string, sourcePath = "") {
			backing = { ...make(color), sourcePath };
		},
	};
}

describe("stable Pi theme proxy", () => {
	it("refreshes semantic prefixes and boxed render keys on same-name reload", () => {
		const { theme, reload } = proxyTheme();
		const resolved = resolveTheme(theme, normalizeConfig({}));
		const old = resolved.apply("accent", "x");
		const key = themeCacheKey(theme);
		const renderKey = getRenderCacheKey("test", theme, 80);
		expect(themeCacheKey(theme)).toBe(key);
		reload("32");
		expect(resolved.apply("accent", "x")).not.toBe(old);
		expect(themeCacheKey(theme)).not.toBe(key);
		expect(getRenderCacheKey("test", theme, 80)).not.toBe(renderKey);
	});

	it("refreshes cached status lines and separators without remounting factories", () => {
		const { theme, reload } = proxyTheme();
		const components: Array<{ render(width: number): string[]; invalidate(): void }> = [];
		installStatusLine({
			host: {
				setWidget(_key, content) {
					if (typeof content === "function") components.push(content({}, theme));
				},
				setFooter() {},
			},
			config: normalizeConfig({ statusLine: { layout: { left: ["model", "path"], right: [], secondary: [] } } }),
			generation: 1,
			initialSnapshot: { model: "test", cwd: "/test" },
		});
		const before = components[0]?.render(100);
		reload("32");
		components[0]?.invalidate();
		const after = components[0]?.render(100);
		expect(after).not.toEqual(before);
		expect(after?.join("")).toContain("\x1b[32m");
		expect(after?.join("")).not.toContain("\x1b[31m");
		expect(components).toHaveLength(2);
	});

	it("rereads extras on same-file reload even when colors are unchanged", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-style-theme-"));
		try {
			const path = join(dir, "same.json");
			const { theme, reload } = proxyTheme();
			writeFileSync(path, JSON.stringify({ extras: { dividerChar: "a" } }));
			reload("31", path);
			setFullTheme(theme);
			expect(getThemeExtra(theme, "dividerChar")).toBe("a");
			writeFileSync(path, JSON.stringify({ extras: { dividerChar: "b" } }));
			reload("31", path);
			setFullTheme(theme);
			expect(getThemeExtra(theme, "dividerChar")).toBe("b");
		} finally {
			resetThemeExtrasCache();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

it("refreshes editor adapter prefixes on host invalidation", () => {
	let color = "31";
	const theme = { borderColor: (text: string) => `\x1b[${color}m${text}\x1b[39m` };
	const editor = new StyledEditor(
		{ requestRender() {}, terminal: { rows: 24 } } as never,
		theme as never,
		{ matches: () => false } as never,
		{
			config: normalizeConfig({ editor: { hint: "hint" }, theme: { colors: { hint: "thinkingLow" } } }),
			snapshot: {},
			theme: theme as never,
			onSnapshot() {},
		},
	);
	expect(editor.render(80).join("")).toContain("\x1b[31mhint");
	color = "32";
	editor.invalidate();
	expect(editor.render(80).join("")).toContain("\x1b[32mhint");
});
