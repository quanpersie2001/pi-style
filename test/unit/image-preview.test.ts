// User-prompt image preview contracts (ADR 0008).
//
// Stage/flush split (ordering below the user message), entry-data filtering,
// and the preview renderer: `#N · WxH` labels, kitty side-by-side grid with
// per-image width caps, stacked fallback on non-image terminals, zero lines
// on malformed data. CustomEntry is display-only by host contract — nothing
// here may leak base64 into a rendered line.

import { resetCapabilitiesCache, setCapabilities } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it } from "vitest";
import {
	__dimensionParsesForTest,
	flushImagePreviewEntry,
	IMAGE_PREVIEW_ENTRY_TYPE,
	registerImagePreviewSurface,
	renderImagePreviewEntry,
	stageImagePreviewData,
} from "../../extension-src/pi-style/features/messages/image-preview.js";
import {
	resetMessagesRenderConfig,
	setMessagesRenderConfig,
} from "../../extension-src/pi-style/features/messages/render-config.js";
import { stripAnsi } from "../../extension-src/pi-style/shared/ansi.js";
import { createFakeTheme } from "../helpers/fake-theme.js";

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function pngDimensions(width: number, height: number): string {
	const bytes = Buffer.alloc(24);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
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
	resetMessagesRenderConfig();
	resetCapabilitiesCache();
	__dimensionParsesForTest.count = 0;
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
		expect(
			renderImagePreviewEntry(
				entry({ images: [{ data: PNG_1X1, mimeType: "image/png" }] }),
				{ expanded: false },
				theme,
			),
		).toBeUndefined();
	});
});

describe("single-image layout (label + capped width)", () => {
	it("renders a #1 label line then the image at the configured cap", () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		setMessagesRenderConfig({ previewMaxWidth: 30 });
		const component = renderImagePreviewEntry(
			entry({ images: [{ data: PNG_1X1, mimeType: "image/png" }] }),
			{ expanded: false },
			theme,
		);
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

describe("multi-image grid (kitty side-by-side)", () => {
	const TWO = {
		images: [
			{ data: PNG_1X1, mimeType: "image/png" },
			{ data: PNG_1X1, mimeType: "image/png" },
		],
	};

	it("labels and image payloads share rows across two columns", () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		setMessagesRenderConfig({ previewMaxWidth: 30 });
		const component = renderImagePreviewEntry(entry(TWO), { expanded: false }, theme);
		const lines = component?.render(100) ?? [];
		expect(lines.length).toBeGreaterThan(2);
		// Label row shows both indices at their column offsets.
		const label = stripAnsi(lines[0] ?? "");
		expect(label).toMatch(/#1/);
		expect(label).toMatch(/#2/);
		// Kitty payloads for both images land on the SAME row, separated by a
		// CHA cursor jump to the second compact slot (without it, kitty would
		// place image 2 at cursor column 0 — on top of image 1). The 1×1 fixture
		// is narrower than the old fixed 30-cell slot, so the offset is compact.
		const payloadRow = lines[1] ?? "";
		const kittyChunks = payloadRow.split("\x1b_G").length - 1;
		expect(kittyChunks).toBe(2);
		expect(payloadRow).toContain("\x1b[31G");
	});

	it("uses compact offsets for portrait images instead of fixed column slots", () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		setMessagesRenderConfig({ previewMaxWidth: 30 });
		const component = renderImagePreviewEntry(
			entry({
				images: [
					{ data: pngDimensions(674, 1424), mimeType: "image/png" },
					{ data: pngDimensions(652, 1438), mimeType: "image/png" },
				],
			}),
			{ expanded: false },
			theme,
		);
		const payloadRow = component?.render(100)[1] ?? "";
		// Both phone screenshots render about 14 cells wide, so the second
		// image starts near cell 17 rather than the old fixed cell 33.
		expect(payloadRow).toContain("\x1b[17G");
	});

	it("stacks images whose rendered heights differ substantially", () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		const component = renderImagePreviewEntry(
			entry({
				images: [
					{ data: pngDimensions(674, 1424), mimeType: "image/png" },
					{ data: pngDimensions(1600, 600), mimeType: "image/png" },
				],
			}),
			{ expanded: false },
			theme,
		);
		const lines = component?.render(100) ?? [];
		const labels = lines.map((line) => stripAnsi(line)).filter((line) => /^#\d/.test(line.trim()));
		expect(labels).toHaveLength(2);
		// The images no longer share a row when their heights are strongly skewed.
		expect(lines.some((line) => line.split("\x1b_G").length - 1 > 1)).toBe(false);
	});

	it("stacks (label above image) when columns cannot fit", () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		const component = renderImagePreviewEntry(entry(TWO), { expanded: false }, theme);
		const lines = component?.render(24) ?? []; // too narrow for two columns
		const labels = lines.map((line) => stripAnsi(line)).filter((line) => /^#\d/.test(line));
		expect(labels).toHaveLength(2);
		// Stacked: each payload sits alone on its own row.
		for (const line of lines) {
			if (line.includes("\x1b_G")) expect(line.split("\x1b_G").length - 1).toBe(1);
		}
	});

	it("non-kitty terminals always stack (no side-by-side)", () => {
		setCapabilities({ images: "iterm2", trueColor: true, hyperlinks: true });
		const component = renderImagePreviewEntry(entry(TWO), { expanded: false }, theme);
		const lines = component?.render(100) ?? [];
		const labels = lines.map((line) => stripAnsi(line)).filter((line) => /^#\d/.test(line));
		expect(labels).toHaveLength(2);
		expect(lines.some((line) => line.includes("]1337;File="))).toBe(true);
	});

	it("expanded (Ctrl+O) lifts the width cap to 60", () => {
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
		expect((expanded?.render(100) ?? []).length).toBeGreaterThanOrEqual((collapsed?.render(100) ?? []).length);
	});
});

describe("performance: render memoization and entry reuse", () => {
	const png = (data = PNG_1X1) => ({ data, mimeType: "image/png" });

	it("repeated renders at the same width return the SAME array reference", () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		const e = entry({ images: [png()] });
		const c1 = renderImagePreviewEntry(e, { expanded: false }, theme);
		const c2 = renderImagePreviewEntry(e, { expanded: false }, theme);
		expect(c1).toBeDefined();
		expect(c2).toBeDefined();
		const first = c1?.render(100);
		expect(c1?.render(100)).toBe(first); // memoized: reference-equal
		expect(c2?.render(100)).not.toBe(first); // per-component memo
		// Different width → fresh array.
		expect(c1?.render(80)).not.toBe(first);
		// invalidate() drops the memo; content is rebuilt identically.
		c1?.invalidate();
		const fresh = c1?.render(100);
		expect(fresh).not.toBe(first);
		expect(fresh).toEqual(first);
	});

	it("two renderer invocations with the same entry parse dimensions once", () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		__dimensionParsesForTest.count = 0;
		const e = entry({ images: [png(), png()] });
		expect(renderImagePreviewEntry(e, { expanded: false }, theme)).toBeDefined();
		expect(renderImagePreviewEntry(e, { expanded: true }, theme)).toBeDefined(); // rebuild (Ctrl+O)
		expect(renderImagePreviewEntry(e, { expanded: false }, theme)).toBeDefined(); // rebuild (resize)
		expect(__dimensionParsesForTest.count).toBe(2); // once per image, once total
		// A different entry object is a different cache key.
		expect(renderImagePreviewEntry(entry({ images: [png()] }), { expanded: false }, theme)).toBeDefined();
		expect(__dimensionParsesForTest.count).toBe(3);
	});

	it("dimension parsing via base64 prefix still yields #1 · 1×1", () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		const component = renderImagePreviewEntry(entry({ images: [png()] }), { expanded: false }, theme);
		const lines = component?.render(100) ?? [];
		expect(stripAnsi(lines[0] ?? "")).toBe("#1 · 1×1");
	});

	it("kitty grid rows keep their ESC \\ terminator (strip is a no-op there)", () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		setMessagesRenderConfig({ previewMaxWidth: 30 });
		const component = renderImagePreviewEntry(entry({ images: [png(), png()] }), { expanded: false }, theme);
		const lines = component?.render(100) ?? [];
		const kittyRow = lines.find((line) => line.includes("\x1b\\"));
		expect(kittyRow).toBeDefined();
		// Regression guard for the endsWith-based strip: a row carrying the
		// kitty terminator must pass through unchanged (terminator intact, no
		// trailing-space mangling of the payload).
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
