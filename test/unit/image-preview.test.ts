// User-prompt image preview contracts (ADR 0008).
//
// Stage/flush split (ordering below the user message), entry-data filtering,
// and the preview renderer: `#N · WxH` labels, stacked image anchors with
// per-image width caps, stacked fallback on non-image terminals, zero lines
// on malformed data. CustomEntry is display-only by host contract — nothing
// here may leak base64 into a rendered line.

import {
	type Component,
	getCellDimensions,
	getImageDimensions,
	Image,
	resetCapabilitiesCache,
	setCapabilities,
	setCellDimensions,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import {
	flushImagePreviewEntry,
	IMAGE_PREVIEW_ENTRY_TYPE,
	registerImagePreviewSurface,
	renderImagePreviewEntry as renderEntry,
	stageImagePreviewData,
} from "../../extension-src/pi-style/features/messages/image-preview.js";
import { createImagePreviewPreparation } from "../../extension-src/pi-style/features/messages/image-preview-preparation.js";
import {
	resetMessagesRenderConfig,
	setMessagesRenderConfig,
} from "../../extension-src/pi-style/features/messages/render-config.js";
import { stripAnsi } from "../../extension-src/pi-style/shared/ansi.js";
import { createFakeTheme } from "../helpers/fake-theme.js";

// Trusted processor seam for geometry/cache tests only, not decoder validation.
const trustedProcessor = async (source: { data: string; mimeType: string }) => {
	const originalDimensions = getImageDimensions(source.data, source.mimeType);
	assert(originalDimensions);
	const scale = Math.min(1, 960 / Math.max(originalDimensions.widthPx, originalDimensions.heightPx));
	const dimensions = {
		widthPx: Math.max(1, Math.round(originalDimensions.widthPx * scale)),
		heightPx: Math.max(1, Math.round(originalDimensions.heightPx * scale)),
	};
	return {
		data: pngDimensions(dimensions.widthPx, dimensions.heightPx),
		mimeType: "image/png" as const,
		dimensions,
		originalDimensions,
	};
};
let preparation = createImagePreviewPreparation({ enabled: true, process: trustedProcessor });
async function prepare(component: Component | undefined, width = 100) {
	assert(component);
	component.render(width);
	for (let i = 0; i < 16; i++) await Promise.resolve();
}
const renderImagePreviewEntry = (entry: unknown, options: unknown, theme: unknown) =>
	renderEntry(entry, options, theme, preparation);

const { CustomEntryComponent } = await import(
	new URL("./modes/interactive/components/custom-entry.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href
);
const defaultCells = { ...getCellDimensions() };

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// Header-only geometry fixtures below are not decoder validation.
function pngDimensions(width: number, height: number): string {
	const bytes = Buffer.alloc(24);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	bytes.writeUInt32BE(13, 8);
	bytes.write("IHDR", 12);
	bytes.writeUInt32BE(width, 16);
	bytes.writeUInt32BE(height, 20);
	return bytes.toString("base64");
}

const theme = createFakeTheme();

function entry(data: unknown): { data?: unknown } {
	return { data };
}

function imageContent(data = PNG_1X1, mimeType = "image/png") {
	return { type: "image" as const, data, mimeType };
}

/** Host fake capturing renderer registrations and appended entries. */
function fakeHost() {
	const renderers = new Map<string, (entry: unknown, options: unknown, theme: unknown) => unknown>();
	const appended: Array<{ customType: string; data?: unknown }> = [];
	return {
		renderers,
		appended,
		registerEntryRenderer(customType: string, renderer: (entry: unknown, options: unknown, theme: unknown) => unknown) {
			renderers.set(customType, renderer);
		},
		appendEntry(customType: string, data?: unknown) {
			appended.push({ customType, data });
		},
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	setCellDimensions(defaultCells);
	resetMessagesRenderConfig();
	resetCapabilitiesCache();
	preparation.dispose();
	preparation = createImagePreviewPreparation({ enabled: true, process: trustedProcessor });
});

describe("stage/flush split (ordering below the user message)", () => {
	it("stage builds filtered data; flush appends exactly once per staged payload", () => {
		const host = fakeHost();
		const staged = stageImagePreviewData([imageContent(), { type: "image", data: "", mimeType: "image/png" }]);
		expect(staged?.images).toHaveLength(1);
		if (staged) flushImagePreviewEntry(host, staged);
		expect(host.appended).toHaveLength(1);
		expect(host.appended[0]?.customType).toBe(IMAGE_PREVIEW_ENTRY_TYPE);
	});

	it("stage returns undefined for no images, malformed images, or config off", () => {
		expect(stageImagePreviewData([])).toBeUndefined();
		expect(stageImagePreviewData(["x", null, { data: 1 }])).toBeUndefined();
		setMessagesRenderConfig({ showImagePreviews: false });
		expect(stageImagePreviewData([imageContent()])).toBeUndefined();
	});

	it("flush is config-gated too (off → no entry even with staged data)", () => {
		setMessagesRenderConfig({ showImagePreviews: false });
		const host = fakeHost();
		flushImagePreviewEntry(host, { images: [{ data: PNG_1X1, mimeType: "image/png" }] });
		expect(host.appended).toHaveLength(0);
	});
});

describe("entry renderer (fail-closed shapes)", () => {
	it("renders nothing for malformed entry data", () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		expect(renderImagePreviewEntry(entry(undefined), { expanded: false }, theme)).toBeUndefined();
		expect(renderImagePreviewEntry(entry({}), { expanded: false }, theme)).toBeUndefined();
		expect(renderImagePreviewEntry(entry({ images: "no" }), { expanded: false }, theme)).toBeUndefined();
		expect(renderImagePreviewEntry(entry({ images: [] }), { expanded: false }, theme)).toBeUndefined();
		expect(
			renderImagePreviewEntry(entry({ images: [{ data: "", mimeType: "image/png" }] }), { expanded: false }, theme),
		).toBeUndefined();
		expect(renderImagePreviewEntry(null, { expanded: false }, theme)).toBeUndefined();
	});

	it("renders nothing without a theme fg", () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		expect(
			renderImagePreviewEntry(entry({ images: [{ data: PNG_1X1, mimeType: "image/png" }] }), {}, {}),
		).toBeUndefined();
		expect(
			renderImagePreviewEntry(entry({ images: [{ data: PNG_1X1, mimeType: "image/png" }] }), {}, undefined),
		).toBeUndefined();
	});

	it("renders nothing when disabled", () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		setMessagesRenderConfig({ showImagePreviews: false });
		const component = renderImagePreviewEntry(
			entry({ images: [{ data: PNG_1X1, mimeType: "image/png" }] }),
			{ expanded: false },
			theme,
		);
		assert(component);
		expect(component.render(100)).toEqual([]);
	});
});

describe("single-image layout (label + capped width)", () => {
	it("renders a #1 label line then the image at the configured cap", async () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		setMessagesRenderConfig({ previewMaxWidth: 30 });
		const component = renderImagePreviewEntry(
			entry({ images: [{ data: PNG_1X1, mimeType: "image/png" }] }),
			{ expanded: false },
			theme,
		);
		await prepare(component);
		const lines = component?.render(100) ?? [];
		expect(lines.length).toBeGreaterThan(1);
		const label = stripAnsi(lines[0] ?? "");
		expect(label).toMatch(/^#1( · \d+×\d+)?$/);
		// Kitty payload starts on the line after the label.
		expect(lines[1]?.startsWith("\x1b_G")).toBe(true);
	});

	it("fallback terminals get a label + single ANSI-safe line, never base64", () => {
		setCapabilities({ images: null, trueColor: true, hyperlinks: true });
		const component = renderImagePreviewEntry(
			entry({ images: [{ data: PNG_1X1, mimeType: "image/png" }] }),
			{ expanded: false },
			theme,
		);
		const lines = component?.render(80) ?? [];
		expect(lines).toHaveLength(2);
		expect(stripAnsi(lines[0] ?? "")).toMatch(/^#1/);
		const plain = stripAnsi(lines[1] ?? "");
		expect(plain).toContain("image/");
		expect(plain).not.toContain(PNG_1X1.slice(0, 16));
	});
});

it.each([true, false])("bounds ANSI metadata and labels at narrow widths (manager=%s)", (bound) => {
	setCapabilities({ images: null, trueColor: true, hyperlinks: true });
	const e = entry({ images: [{ data: pngDimensions(16000, 1000), mimeType: "image/png" }] });
	const component = bound ? renderImagePreviewEntry(e, {}, theme) : renderEntry(e, {}, theme);
	assert(component);
	for (const width of [1, 2, 4, 8]) {
		const lines = component.render(width);
		expect(lines).toHaveLength(2);
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
	}
});

describe("multi-image stacked layout", () => {
	const TWO = {
		images: [
			{ data: PNG_1X1, mimeType: "image/png" },
			{ data: PNG_1X1, mimeType: "image/png" },
		],
	};

	it.each([2, 3])("keeps %i kitty images on distinct anchor lines at wide widths", async (count) => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		const component = renderImagePreviewEntry(
			entry({ images: Array.from({ length: count }, () => ({ data: PNG_1X1, mimeType: "image/png" })) }),
			{ expanded: false },
			theme,
		);
		await prepare(component);
		const lines = component?.render(160) ?? [];
		const labels = lines.map(stripAnsi).filter((line) => /^#\d/.test(line));
		expect(labels).toEqual(Array.from({ length: count }, (_, i) => `#${i + 1} · 1×1`));
		const anchors = lines.filter((line) => line.startsWith("\x1b_G"));
		expect(anchors).toHaveLength(count);
		for (const line of anchors) expect(line.split("a=T")).toHaveLength(2);
		expect(new Set(anchors.map((line) => line.match(/i=(\d+)/)?.[1])).size).toBe(count);
	});

	it("stacks images whose rendered heights differ substantially", async () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		const component = renderImagePreviewEntry(
			entry({
				images: [
					{ data: pngDimensions(674, 924), mimeType: "image/png" },
					{ data: pngDimensions(1600, 600), mimeType: "image/png" },
				],
			}),
			{ expanded: false },
			theme,
		);
		await prepare(component);
		const lines = component?.render(100) ?? [];
		const labels = lines.map((line) => stripAnsi(line)).filter((line) => /^#\d/.test(line.trim()));
		expect(labels).toHaveLength(2);
		// Unequal heights also keep one image per anchor line.
		expect(lines.some((line) => line.split("\x1b_G").length - 1 > 1)).toBe(false);
	});

	it("stacks labels above images at narrow widths", async () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		const component = renderImagePreviewEntry(entry(TWO), { expanded: false }, theme);
		await prepare(component);
		const lines = component?.render(24) ?? [];
		const labels = lines.map((line) => stripAnsi(line)).filter((line) => /^#\d/.test(line));
		expect(labels).toHaveLength(2);
		// Stacked: each payload sits alone on its own row.
		for (const line of lines) {
			if (line.includes("\x1b_G")) expect(line.split("\x1b_G").length - 1).toBe(1);
		}
	});

	it("non-kitty terminals always stack (no side-by-side)", async () => {
		setCapabilities({ images: "iterm2", trueColor: true, hyperlinks: true });
		const component = renderImagePreviewEntry(entry(TWO), { expanded: false }, theme);
		await prepare(component);
		const lines = component?.render(100) ?? [];
		const labels = lines.map((line) => stripAnsi(line)).filter((line) => /^#\d/.test(line));
		expect(labels).toHaveLength(2);
		expect(lines.some((line) => line.includes("]1337;File="))).toBe(true);
	});

	it("expanded (Ctrl+O) lifts the width cap to 60", async () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		setMessagesRenderConfig({ previewMaxWidth: 20 });
		const collapsed = renderImagePreviewEntry(
			entry({ images: [{ data: PNG_1X1, mimeType: "image/png" }] }),
			{ expanded: false },
			theme,
		);
		const expanded = renderImagePreviewEntry(
			entry({ images: [{ data: PNG_1X1, mimeType: "image/png" }] }),
			{ expanded: true },
			theme,
		);
		// The 1×1 fixture fills any cap; taller fixtures would differ — here we
		// assert both paths render and the expanded render is at least as tall.
		await prepare(collapsed);
		await prepare(expanded);
		expect((expanded?.render(100) ?? []).length).toBeGreaterThanOrEqual((collapsed?.render(100) ?? []).length);
	});
});

describe("performance: render memoization and entry reuse", () => {
	const png = (data = PNG_1X1) => ({ data, mimeType: "image/png" });

	it("preserves encoded image caches through real CustomEntry invalidation and rebuild", async () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		const invalidate = vi.spyOn(Image.prototype, "invalidate");
		const render = vi.spyOn(Image.prototype, "render");
		const host = new CustomEntryComponent(entry({ images: [png(), png()] }), (e: unknown, options: unknown) =>
			renderImagePreviewEntry(e, options, theme),
		);
		await prepare(host);
		const first = host.render(100);
		const initialPayloads = render.mock.results.map((result) => result.value);
		const initialInvalidations = invalidate.mock.calls.length;
		for (let i = 0; i < 5; i++) {
			host.invalidate();
			expect(host.render(100)).toEqual(first);
			expect(render.mock.results.at(-2)?.value).toBe(initialPayloads[0]);
			expect(render.mock.results.at(-1)?.value).toBe(initialPayloads[1]);
		}
		expect(invalidate).toHaveBeenCalledTimes(initialInvalidations);
		host.setExpanded(true);
		host.render(100);
		expect(render.mock.results.at(-1)?.value).not.toBe(initialPayloads[1]);
		expect(render.mock.calls.at(-1)?.[0]).toBe(62);
		host.setExpanded(false);
		host.render(18);
		expect(render.mock.calls.at(-1)?.[0]).toBe(18);
	});

	it("refreshes exact protocol and cell geometry without explicit invalidation", async () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		setCellDimensions({ widthPx: 9, heightPx: 18 });
		const component = renderImagePreviewEntry(entry({ images: [png(pngDimensions(674, 924))] }), {}, theme);
		assert(component);
		await prepare(component);
		const before = component.render(100);
		setCellDimensions({ widthPx: 12, heightPx: 18 });
		const resized = component.render(100);
		expect(resized.length).not.toBe(before.length);
		setCapabilities({ images: "iterm2", trueColor: true, hyperlinks: true });
		expect(component.render(100).some((line) => line.includes("]1337;File="))).toBe(true);
		setCapabilities({ images: null, trueColor: true, hyperlinks: true });
		const fallback = component.render(100);
		expect(fallback).toHaveLength(2);
		expect(fallback.join("\n")).not.toContain("]1337;File=");
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		expect(component.render(100)[1]?.startsWith("\x1b_G")).toBe(true);
	});

	it("keeps 30/60 cell caps and invalidates exact height geometry while reusing native PNG at unchanged geometry", async () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		setCellDimensions({ widthPx: 9, heightPx: 18 });
		const e = entry({ images: [png()] });
		const render = vi.spyOn(Image.prototype, "render");
		const collapsed = renderImagePreviewEntry(e, {}, theme);
		const expanded = renderImagePreviewEntry(e, { expanded: true }, theme);
		await prepare(collapsed);
		collapsed?.render(100);
		expect(render.mock.calls.at(-1)?.[0]).toBe(32);
		const encoded = render.mock.results.at(-1)?.value;
		collapsed?.invalidate();
		collapsed?.render(100);
		expect(render.mock.results.at(-1)?.value).toBe(encoded);
		setCellDimensions({ widthPx: 9, heightPx: 19 });
		collapsed?.render(100);
		expect(render.mock.results.at(-1)?.value).not.toBe(encoded);
		expanded?.render(100);
		expect(render.mock.calls.at(-1)?.[0]).toBe(62);
		collapsed?.render(15);
		expect(render.mock.calls.at(-1)?.[0]).toBe(15);
	});

	it("refreshes labels and text fallbacks on mutable theme invalidation and theme replacement", () => {
		setCapabilities({ images: null, trueColor: true, hyperlinks: true });
		let color = "old:";
		const mutableTheme = { fg: (_color: string, text: string) => color + text };
		const e = entry({ images: [png()] });
		const component = renderImagePreviewEntry(e, {}, mutableTheme);
		assert(component);
		expect(component.render(100).every((line) => line.startsWith("old:"))).toBe(true);
		color = "new:";
		component.invalidate();
		expect(component.render(100).every((line) => line.startsWith("new:"))).toBe(true);
		const rebuilt = renderImagePreviewEntry(e, {}, { fg: (_color: string, text: string) => `replacement:${text}` });
		assert(rebuilt);
		expect(rebuilt.render(100).every((line) => line.startsWith("replacement:"))).toBe(true);
	});

	it("hides an existing component when config turns OFF and restores it when ON", async () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		const component = renderImagePreviewEntry(entry({ images: [png()] }), {}, theme);
		assert(component);
		await prepare(component);
		const initial = component.render(100);
		setMessagesRenderConfig({ showImagePreviews: false });
		expect(component.render(100)).toEqual([]);
		setMessagesRenderConfig({ showImagePreviews: true, previewMaxWidth: 20 });
		const restored = component.render(100);
		expect(restored[1]).toContain("c=20");
		expect(restored).not.toEqual(initial);
	});

	it("dimension parsing via base64 prefix still yields #1 · 1×1", () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		const component = renderImagePreviewEntry(entry({ images: [png()] }), { expanded: false }, theme);
		const lines = component?.render(100) ?? [];
		expect(stripAnsi(lines[0] ?? "")).toBe("#1 · 1×1");
	});

	it("stacked kitty payloads retain their ESC \\ terminator", async () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		setMessagesRenderConfig({ previewMaxWidth: 30 });
		const component = renderImagePreviewEntry(entry({ images: [png(), png()] }), { expanded: false }, theme);
		await prepare(component);
		const lines = component?.render(100) ?? [];
		const kittyRow = lines.find((line) => line.includes("\x1b\\"));
		expect(kittyRow).toBeDefined();
		expect(kittyRow?.endsWith("\x1b\\")).toBe(true);
		expect(kittyRow?.endsWith(" ")).toBe(false);
	});
});

describe("host wiring", () => {
	it("registers the renderer under the documented custom type", () => {
		const host = fakeHost();
		registerImagePreviewSurface(host);
		expect(host.renderers.has(IMAGE_PREVIEW_ENTRY_TYPE)).toBe(true);
		expect(host.renderers.size).toBe(1);
	});
});
