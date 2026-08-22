// Inline previews for user-prompt images (ADR 0008).
//
// Absorbs the presentation half of @pi-archimedes/image-paste: images attached
// to the user's prompt render inline directly below the user message. The
// channel is a display-only CustomEntry (documented as "not sent to the LLM";
// ignored by buildSessionContext) — unlike image-paste's display-only custom
// *messages*, whose custom_message entries map into the session's context
// message list (sessionEntryToContextMessages) and would ride the context
// pipeline for the rest of the session.
//
// Ordering (verified against Pi 0.84.2): appending at `before_agent_start`
// lands the entry ABOVE the user message — the user message enters the feed
// only when UI listeners process `message_start(user)` and persists at
// `message_end(user)`, both AFTER extension handlers. So the append is staged
// at `before_agent_start` (the only event carrying the prompt's `images`) and
// flushed at the first `message_start(assistant)`: by then the user message is
// in the feed and persisted, and the host inserts the entry below it (spliced
// before the streaming component, or appended at the chat tail).
//
// Layout: `#N · WxH` label rows tie each image to its `[Image #N]` marker;
// multiple images render side-by-side on kitty-capable terminals (kitty
// graphics sequences are zero-width, so line zipping composes them), stacked
// elsewhere. Width is capped by `messages.previewMaxWidth` (default 30);
// Pi's global expansion (Ctrl+O) lifts the cap for a closer look.
//
// Fail-closed rules: unknown/malformed entry data renders zero lines (never
// an error box, never base64 leakage); a theme without fg disables the
// surface; the config leaf gates both the stage and the render side.

import {
	type Component,
	getCapabilities,
	getImageDimensions,
	Image,
	type ImageDimensions,
} from "@earendil-works/pi-tui";
import { visibleWidth } from "../../shared/ansi.js";
import { getMessagesRenderConfig } from "./render-config.js";

/** Session-entry customType for user-prompt image previews. */
export const IMAGE_PREVIEW_ENTRY_TYPE = "pi-style-image-preview";

/** Expanded-state (Ctrl+O) width cap — closer look without config changes. */
export const IMAGE_PREVIEW_EXPANDED_MAX_WIDTH_CELLS = 60;

/** Hard bounds for the `messages.previewMaxWidth` leaf. */
export const IMAGE_PREVIEW_MIN_WIDTH_CELLS = 8;
export const IMAGE_PREVIEW_MAX_WIDTH_CELLS = 60;

/** Grid layout constants (kitty side-by-side). */
const GRID_GAP = 2;
const GRID_MIN_COLUMN = 14;

/** Persisted entry payload: base64 data + mime type per attached image. */
export interface ImagePreviewImage {
	readonly data: string;
	readonly mimeType: string;
}

export interface ImagePreviewEntryData {
	readonly images: readonly ImagePreviewImage[];
}

/**
 * Structural port over the host APIs this surface uses. The pi/ layer passes
 * the ExtensionAPI; tests pass fakes.
 */
export interface ImagePreviewHostPort {
	registerEntryRenderer(
		customType: string,
		renderer: (entry: unknown, options: unknown, theme: unknown) => unknown,
	): void;
	appendEntry(customType: string, data?: unknown): void;
}

function isPreviewableImage(value: unknown): value is ImagePreviewImage {
	if (!value || typeof value !== "object") return false;
	const data = (value as { data?: unknown }).data;
	const mimeType = (value as { mimeType?: unknown }).mimeType;
	return typeof data === "string" && data.length > 0 && typeof mimeType === "string" && mimeType.length > 0;
}

/**
 * Entry-data view of a prompt's attached images: drops malformed blocks,
 * returns undefined when nothing previewable remains (no entry is appended).
 * Config-gated (`messages.showImagePreviews`).
 */
export function stageImagePreviewData(images: readonly unknown[]): ImagePreviewEntryData | undefined {
	if (!getMessagesRenderConfig().showImagePreviews) return undefined;
	const valid = images.filter(isPreviewableImage).map((image) => ({ data: image.data, mimeType: image.mimeType }));
	return valid.length > 0 ? { images: valid } : undefined;
}

/** Flush a staged preview as a session entry (display-only CustomEntry). */
export function flushImagePreviewEntry(pi: ImagePreviewHostPort, data: ImagePreviewEntryData): void {
	if (!getMessagesRenderConfig().showImagePreviews) return;
	pi.appendEntry(IMAGE_PREVIEW_ENTRY_TYPE, data);
}

/** Validated images from a persisted entry's data field; undefined = malformed. */
function previewImagesFromEntryData(data: unknown): readonly ImagePreviewImage[] | undefined {
	if (!data || typeof data !== "object") return undefined;
	const images = (data as { images?: unknown }).images;
	if (!Array.isArray(images) || images.length === 0) return undefined;
	if (!images.every(isPreviewableImage)) return undefined;
	return images;
}

type FgColor = (color: string, text: string) => string;

/** `#N` label for entry position N (1-based — matches `[Image #N]` markers).
 *  Dimensions arrive pre-parsed (parseImageDimensions) — no decode here. */
function imageLabel(theme: { fg: FgColor }, index: number, dims?: ImageDimensions): string {
	const dimsPart = dims ? ` · ${dims.widthPx}×${dims.heightPx}` : "";
	return theme.fg("dim", `#${index}${dimsPart}`);
}

/** Test hook: counts parseImageDimensions invocations (entry-reuse contract). */
export const __dimensionParsesForTest = { count: 0 };

/** Parse image dimensions from a base64 PREFIX first — 256 chars (a whole
 *  number of base64 blocks, ~192 bytes) covers the PNG/GIF/WebP headers and
 *  the usual early JPEG SOF marker. Only when the prefix fails (rare — a
 *  late JPEG SOF) do we decode the full payload. Avoids decoding a ~1.3MB
 *  screenshot just to read ~24 header bytes on every rebuild. */
function parseImageDimensions(image: ImagePreviewImage): ImageDimensions | undefined {
	__dimensionParsesForTest.count++;
	const fromPrefix = getImageDimensions(image.data.slice(0, 256), image.mimeType);
	return fromPrefix ?? getImageDimensions(image.data, image.mimeType) ?? undefined;
}

/** Per-entry render artifacts (components, labels). */
interface PreviewCache {
	readonly images: readonly ImagePreviewImage[];
	readonly components: Image[];
	readonly labels: string[];
}

/** The host's CustomEntryComponent re-invokes the renderer on every resize,
 *  Ctrl+O toggle, and cell-size response — always with the SAME entry object
 *  (rebuild() passes this.entry). Keying on that object lets Image components
 *  keep their internal line caches and kitty image ids (no re-chunking, no id
 *  churn) and labels their parsed dimensions across rebuilds. */
const previewCache = new WeakMap<object, PreviewCache>();

/**
 * Entry renderer for `pi-style-image-preview` entries. Returns undefined
 * (zero-line render) when the surface is disabled, the entry data is
 * malformed, or the theme lacks fg — never throws, never leaks base64 into a
 * rendered line (the pi-tui Image fallback vocabulary is mime + dimensions).
 */
export function renderImagePreviewEntry(entry: unknown, options: unknown, theme: unknown): Component | undefined {
	if (!getMessagesRenderConfig().showImagePreviews) return undefined;
	const images = previewImagesFromEntryData((entry as { data?: unknown } | null | undefined)?.data);
	if (!images) return undefined;
	const fg = (theme as { fg?: FgColor } | null | undefined)?.fg;
	if (typeof fg !== "function") return undefined;
	const expanded = (options as { expanded?: boolean } | null | undefined)?.expanded === true;
	try {
		const themed = { fg: fg.bind(theme) } as { fg: FgColor };
		let cached = previewCache.get(entry as object);
		if (!cached) {
			const dims = images.map(parseImageDimensions);
			const components = images.map(
				(image, index) =>
					new Image(
						image.data,
						image.mimeType,
						{ fallbackColor: (text: string) => themed.fg("toolOutput", text) },
						{},
						dims[index],
					),
			);
			const labels = images.map((_image, index) => imageLabel(themed, index + 1, dims[index]));
			cached = { images, components, labels };
			previewCache.set(entry as object, cached);
		}
		const { components, labels } = cached;
		// Memoized output: render passes tick on every streaming update; the
		// same width/expansion/config/capability key returns the SAME array
		// reference, skipping the grid re-zip and the host's per-line diff.
		let memo: { key: string; lines: string[] } | undefined;
		return {
			invalidate() {
				memo = undefined;
				for (const component of components) component.invalidate();
			},
			render(width: number): string[] {
				const config = getMessagesRenderConfig();
				const kitty = getCapabilities().images === "kitty";
				const key = `${width}|${expanded}|${config.previewMaxWidth}|${config.showImagePreviews}|${kitty}`;
				if (memo && memo.key === key) return memo.lines;
				const maxWidth = expanded
					? IMAGE_PREVIEW_EXPANDED_MAX_WIDTH_CELLS
					: Math.min(config.previewMaxWidth, IMAGE_PREVIEW_MAX_WIDTH_CELLS);
				let lines: string[];
				if (width <= 0) lines = [];
				else if (images.length === 1 || !kitty) lines = renderStacked(width, maxWidth, labels, components);
				else lines = renderGrid(width, maxWidth, labels, components);
				memo = { key, lines };
				return lines;
			},
		};
	} catch {
		return undefined;
	}
}

/** One labeled image per block, a blank line between (also the fallback path). */
function renderStacked(width: number, maxWidth: number, labels: string[], components: Image[]): string[] {
	const lines: string[] = [];
	for (const [index, component] of components.entries()) {
		if (index > 0) lines.push("");
		lines.push(labels[index] ?? "");
		lines.push(...component.render(Math.min(width, Math.max(1, maxWidth + 2))));
	}
	return lines;
}

/** Strip trailing spaces without scanning the whole line: kitty rows always
 *  end with the `ESC \` terminator (never trailing spaces), so the fast path
 *  is one endsWith check; only space-padded rows pay for the strip. */
function stripTrailingSpaces(line: string): string {
	if (!line.endsWith(" ")) return line;
	let end = line.length;
	while (end > 0 && line.charCodeAt(end - 1) === 0x20) end--;
	return line.slice(0, end);
}

/**
 * Side-by-side grid (kitty graphics only — sequences are zero-width so
 * per-row line zipping composes columns). Columns shrink to fit the width;
 * when fewer than two usable columns fit, this degrades to stacked.
 */
function renderGrid(width: number, maxWidth: number, labels: string[], components: Image[]): string[] {
	const usable = Math.max(1, width - 2);
	const maxColumns = Math.floor((usable + GRID_GAP) / (GRID_MIN_COLUMN + GRID_GAP));
	const columns = Math.max(1, Math.min(components.length, maxColumns, 3));
	if (columns < 2) return renderStacked(width, maxWidth, labels, components);
	const columnWidth = Math.min(maxWidth, Math.floor((usable - (columns - 1) * GRID_GAP) / columns));
	if (columnWidth < GRID_MIN_COLUMN) return renderStacked(width, maxWidth, labels, components);

	const lines: string[] = [];
	for (let start = 0; start < components.length; start += columns) {
		const group = components.slice(start, start + columns);
		const groupLabels = labels.slice(start, start + columns);
		if (start > 0) lines.push("");
		const rendered = group.map((component) => component.render(columnWidth));
		// Label row: each label padded to its column width, gap between.
		const labelRow = groupLabels
			.map((label, _index) => {
				const pad = Math.max(0, columnWidth - visibleWidth(stripFormatting(label)));
				return label + " ".repeat(pad);
			})
			.join(" ".repeat(GRID_GAP))
			.trimEnd();
		lines.push(labelRow);
		// Image rows: zip columns line by line. Kitty places each image at the
		// CURSOR position when its transmission completes, and the sequences are
		// zero-width — so after image 1 the cursor is still at column 0 and the
		// second transmission would land ON TOP of image 1. Each subsequent
		// column therefore starts with a CHA jump (`ESC[<col>G`, 1-based) to its
		// start column; terminal/herdr cursor tracking follows, and both images
		// composite side by side.
		const rows = Math.max(...rendered.map((column) => column.length));
		for (let row = 0; row < rows; row++) {
			let line = "";
			for (let column = 0; column < rendered.length; column++) {
				if (column > 0) {
					const startCol = column * (columnWidth + GRID_GAP);
					line += `\x1b[${startCol + 1}G`;
				}
				line += rendered[column]?.[row] ?? "";
			}
			lines.push(stripTrailingSpaces(line));
		}
	}
	return lines;
}

/** Label text may carry ANSI color; measure only the visible part.
 *  Reuses the shared ANSI-stripping utility (no local control-char regex). */
import { stripAnsi as stripFormatting } from "../../shared/ansi.js";

/** Register the entry renderer (extension load; before any entry can exist). */
export function registerImagePreviewSurface(pi: ImagePreviewHostPort): void {
	pi.registerEntryRenderer(IMAGE_PREVIEW_ENTRY_TYPE, renderImagePreviewEntry);
}
