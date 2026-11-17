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
// multiple images stack with one image anchor per line: Pi's fullscreen
// placement/cropping metadata recognizes only the first image on each line.
// Width is capped by `messages.previewMaxWidth` (default 30); Pi's global
// expansion (Ctrl+O) lifts the cap for a closer look.
//
// Fail-closed rules: unknown/malformed entry data renders zero lines (never
// an error box, never base64 leakage); a theme without fg disables the
// surface; the config leaf gates both the stage and the render side.

import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import { type ImagePreviewPreparation, previewDimensions, previewMetadata } from "./image-preview-preparation.js";
import { getMessagesRenderConfig } from "./render-config.js";

/** Session-entry customType for user-prompt image previews. */
export const IMAGE_PREVIEW_ENTRY_TYPE = "pi-style-image-preview";

/** Expanded-state (Ctrl+O) width cap — closer look without config changes. */
export const IMAGE_PREVIEW_EXPANDED_MAX_WIDTH_CELLS = 60;

/** Hard bounds for the `messages.previewMaxWidth` leaf. */
export const IMAGE_PREVIEW_MIN_WIDTH_CELLS = 8;
export const IMAGE_PREVIEW_MAX_WIDTH_CELLS = 60;

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

/** Live components retain sources only, never native artifacts or encoded output. */
export function renderImagePreviewEntry(
	entry: unknown,
	options: unknown,
	theme: unknown,
	preparation?: ImagePreviewPreparation,
): Component | undefined {
	// Pi omits CustomEntries whose renderer returns undefined at admission.
	// Keep valid disabled entries mounted so ON can hydrate them later. Their
	// content is zero lines while OFF; Pi retains its own one-line spacer.
	const images = previewImagesFromEntryData((entry as { data?: unknown } | null | undefined)?.data);
	if (!images) return undefined;
	const fg = (theme as { fg?: FgColor } | null | undefined)?.fg;
	if (typeof fg !== "function") return undefined;
	const expanded = (options as { expanded?: boolean } | null | undefined)?.expanded === true;
	const themed = { fg: (token: string, text: string) => (theme as { fg: FgColor }).fg(token, text) };
	return {
		invalidate() {},
		render(width) {
			const config = getMessagesRenderConfig();
			if (!config.showImagePreviews || width <= 0) return [];
			const cap = expanded
				? IMAGE_PREVIEW_EXPANDED_MAX_WIDTH_CELLS
				: Math.min(config.previewMaxWidth, IMAGE_PREVIEW_MAX_WIDTH_CELLS);
			const lines: string[] = [];
			for (const [index, image] of images.entries()) {
				const prepared = preparation?.render(image, Math.min(width, Math.max(1, cap + 2)), themed);
				const dims = prepared?.originalDimensions ?? previewDimensions(image);
				if (index > 0) lines.push("");
				lines.push(
					truncateToWidth(themed.fg("dim", `#${index + 1}${dims ? ` · ${dims.widthPx}×${dims.heightPx}` : ""}`), width),
				);
				lines.push(
					...(prepared?.lines ?? previewMetadata(image, themed, dims).map((line) => truncateToWidth(line, width))),
				);
			}
			return lines;
		},
	};
}

/** Register before persisted entries render; the manager can bind later. */
export function registerImagePreviewSurface(pi: ImagePreviewHostPort, preparation?: ImagePreviewPreparation): void {
	pi.registerEntryRenderer(IMAGE_PREVIEW_ENTRY_TYPE, (entry, options, theme) =>
		renderImagePreviewEntry(entry, options, theme, preparation),
	);
}
