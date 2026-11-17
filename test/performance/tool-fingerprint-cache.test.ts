import { afterEach, describe, expect, it, vi } from "vitest";
import { renderBoxedToolResult } from "../../extension-src/pi-style/features/tools/boxed/index.js";
import { setToolsRenderConfig } from "../../extension-src/pi-style/features/tools/boxed/session-config.js";
import type { BoxedToolContext } from "../../extension-src/pi-style/features/tools/boxed/shared.js";
import { getRenderCacheKey, getStateRenderCacheKey } from "../../extension-src/pi-style/features/tools/boxed/shared.js";
import * as splitDiff from "../../extension-src/pi-style/shared/split-diff.js";
import { createFakeTheme } from "../helpers/fake-theme.js";

const theme = createFakeTheme();
function context(args: Record<string, unknown> = {}): BoxedToolContext {
	return {
		args,
		toolCallId: "fingerprint-fixture",
		state: {},
		invalidate() {},
		cwd: "/fake",
		executionStarted: true,
		argsComplete: true,
		isPartial: false,
		expanded: false,
		showImages: false,
		isError: false,
		lastComponent: undefined,
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	setToolsRenderConfig({ collapseAfterTurn: true, dimOutput: false });
});

describe("per-tool fingerprint memo", () => {
	it("preserves key format and hashes unchanged long text once per state", () => {
		const text = "large output ".repeat(100);
		const expected = getRenderCacheKey("fixture", theme, text, true, 12);
		const state = {};
		const hashes = vi.spyOn(Math, "imul");
		const key = () => getStateRenderCacheKey("fixture", theme, state, text, true, 12);
		expect(key()).toBe(expected);
		expect(hashes).toHaveBeenCalledTimes(text.length);
		for (let i = 0; i < 20; i++) expect(key()).toBe(expected);
		expect(hashes).toHaveBeenCalledTimes(text.length);
		getStateRenderCacheKey("fixture", theme, {}, text, true, 12);
		expect(hashes).toHaveBeenCalledTimes(text.length * 2);
	});

	it("retains at most four texts and rehashes evicted text", () => {
		const texts = Array.from({ length: 5 }, (_, i) => `${i}${"x".repeat(100)}`);
		const state = {};
		const hashes = vi.spyOn(Math, "imul");
		for (const text of texts) getStateRenderCacheKey("fixture", theme, state, text);
		expect(hashes).toHaveBeenCalledTimes(505);
		for (const text of texts.slice(1)) getStateRenderCacheKey("fixture", theme, state, text);
		expect(hashes).toHaveBeenCalledTimes(505);
		getStateRenderCacheKey("fixture", theme, state, texts[0]);
		expect(hashes).toHaveBeenCalledTimes(606);
	});

	it("does not hash short parts or retain fingerprints without a state", () => {
		const text = "x".repeat(100);
		const hashes = vi.spyOn(Math, "imul");
		getStateRenderCacheKey("fixture", theme, {}, "x".repeat(64), true, 1);
		expect(hashes).not.toHaveBeenCalled();
		for (let i = 0; i < 2; i++) getStateRenderCacheKey("fixture", theme, undefined, text);
		expect(hashes).toHaveBeenCalledTimes(200);
	});

	it("skips hashing warm bash results while preserving non-text freshness", () => {
		setToolsRenderConfig({ collapseAfterTurn: false });
		const ctx = context({ command: "printf x" });
		const result = { content: [{ type: "text", text: "output line\n".repeat(100) }], details: {} };
		const render = (expanded = false, activeTheme = theme) =>
			renderBoxedToolResult("bash", result, { expanded, isPartial: false }, activeTheme, ctx);
		let previous = render();
		const hashes = vi.spyOn(Math, "imul");
		for (let i = 0; i < 20; i++) expect(render()).toBe(previous);
		expect(hashes).not.toHaveBeenCalled();
		for (const change of [
			() => render(true),
			() => {
				ctx.isError = true;
				return render();
			},
			() => {
				ctx.args.command = "printf y";
				return render();
			},
			() => {
				ctx.state.__piStyleStartedAt = 0;
				ctx.state.__piStyleEndedAt = 100;
				return render();
			},
			() => {
				setToolsRenderConfig({ dimOutput: true });
				return render();
			},
			() => render(false, createFakeTheme({ name: "replacement" })),
		]) {
			const next = change();
			expect(next).not.toBe(previous);
			previous = next;
		}
		expect(hashes).not.toHaveBeenCalled();
		previous = render();
		result.content[0].text = "changed line\n".repeat(100);
		const changed = render();
		expect(changed).not.toBe(previous);
		expect(render()).toBe(changed);
		expect(hashes).toHaveBeenCalledTimes(result.content[0].text.length);
		ctx.state = {};
		render();
		expect(hashes).toHaveBeenCalledTimes(result.content[0].text.length * 2);
	});

	it("memoizes edit stats and fingerprints but detects same-object diff changes", () => {
		setToolsRenderConfig({ collapseAfterTurn: false });
		const ctx = context({ path: "/fake/file.txt" });
		const result = { content: [], details: { diff: "- 1 old line\n+ 1 new line\n".repeat(20) } };
		const stats = vi.spyOn(splitDiff, "countDiffStats");
		const render = () => renderBoxedToolResult("edit", result, { expanded: false, isPartial: false }, theme, ctx);
		const first = render();
		expect(stats).toHaveBeenCalledTimes(1);
		const hashes = vi.spyOn(Math, "imul");
		for (let i = 0; i < 20; i++) expect(render()).toBe(first);
		expect(stats).toHaveBeenCalledTimes(1);
		expect(hashes).not.toHaveBeenCalled();
		result.details.diff = result.details.diff.replaceAll("new", "NEW");
		expect(render()).not.toBe(first);
		expect(stats).toHaveBeenCalledTimes(2);
		expect(hashes).toHaveBeenCalledTimes(result.details.diff.length);
	});
});
