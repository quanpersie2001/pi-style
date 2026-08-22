// Clipboard image input (ADR 0009): submit-side wiring.
//
// The editor surface (StyledEditor) owns the keystroke-time behavior:
// instant `[Image #N] ` markers via the shared pending registry. This module
// owns what happens at submit: resolve markers against the registry
// (one-shot; removed markers discard their images), then upgrade any raw
// clipboard artifact path tokens that bypassed the editor (native editor
// style, config toggled after paste, non-pi-style surfaces) to `[image]` +
// attachments. Fail-safe at every step: missing/oversized files keep their
// text, nothing is lost. Filesystem reads happen on the input path only —
// renderers stay I/O-free (TOOL-007).

import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { clipboardPathRegex, extractClipboardImageTokens as sharedExtractTokens } from "../../shared/clipboard-path.js";
import { clipboardHasImageSync, readClipboardImageBinary } from "../../shared/clipboard-presence.js";
import {
	allocatePendingImage,
	discardPendingMarkerIndex,
	fillPendingImageBytes,
	fillPendingImageFromPath,
	isPendingImageFilled,
	isPendingMarkerIndex,
	type PendingImageAttachment,
	resolvePendingImagesForSubmit as sharedResolve,
} from "../../shared/pending-images.js";
import { getMessagesRenderConfig } from "./render-config.js";

/** Replacement token for an attached clipboard image (marker vocabulary). */
export const IMAGE_TOKEN = "[image]";

/** Mirrors image-paste's guard; larger files keep the path. */
const MAX_ATTACHABLE_BYTES = 20 * 1024 * 1024;

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
});

export { extractClipboardImageTokens, isSingleClipboardImagePath } from "../../shared/clipboard-path.js";
export {
	type PendingImageAttachment,
	resetPendingImageRegistry,
	resolvePendingImagesForSubmit,
} from "../../shared/pending-images.js";

// ── Clipboard image paste surface (editor wiring; ADR 0009) ─────────────

/** Structural surface the editor consumes (kept structural so the editor
 *  feature needs no cross-feature import; app/runtime passes the instance). */
export interface ClipboardImagePasteSurface {
	/** Config gate (`messages.clipboardImages`). */
	enabled(): boolean;
	/** Sync clipboard image presence; null when the probe is unavailable. */
	clipboardHasImage(): boolean | null;
	/** Instant marker: allocate + insert-time text; the bytes fill
	 *  asynchronously from the clipboard. */
	markerFromClipboard(): string;
	/** Marker (or the original path on failure) from a clipboard artifact
	 *  file — the fallback when the keystroke wasn't owned. */
	markerFromArtifact(path: string): Promise<string>;
	isMarkerIndexRegistered(index: number): boolean;
	discardMarkerIndex(index: number): void;
}

/** Test seam for the native clipboard probes. */
export interface ClipboardImagePasteDeps {
	hasImage?: () => boolean | null;
	readBinary?: () => Promise<{ bytes: Uint8Array } | null>;
}

export function createClipboardImagePasteSurface(deps: ClipboardImagePasteDeps = {}): ClipboardImagePasteSurface {
	const hasImage = deps.hasImage ?? clipboardHasImageSync;
	// Owned-paste path: markerFromClipboard runs only after clipboardHasImage()
	// returned true (editor keystroke handler), so the default binary read
	// skips the redundant second native presence probe.
	const readBinary = deps.readBinary ?? (() => readClipboardImageBinary({ skipPresenceProbe: true }));
	return {
		enabled: () => getMessagesRenderConfig().clipboardImages,
		clipboardHasImage: () => {
			try {
				return hasImage();
			} catch {
				return null;
			}
		},
		markerFromClipboard() {
			const { index, marker } = allocatePendingImage();
			// Async fill: bytes land in the registry entry before submit resolves.
			void (async () => {
				try {
					const image = await readBinary();
					if (image) {
						// Zero-copy view (offset+length explicit so Uint8Array views over a
						// larger backing buffer encode exactly their own range — avoids a
						// second full copy of a ~1.3MB screenshot per paste).
						fillPendingImageBytes(
							index,
							Buffer.from(image.bytes.buffer, image.bytes.byteOffset, image.bytes.byteLength).toString("base64"),
							"image/png",
						);
						return;
					}
				} catch {
					// Read failure below discards the entry.
				}
				// No bytes: discard so a submit never dangles on this entry (the
				// marker stays plain text — documented degradation, nothing lost).
				discardPendingMarkerIndex(index);
			})();
			return marker;
		},
		async markerFromArtifact(path: string) {
			const { index, marker } = allocatePendingImage();
			await fillPendingImageFromPath(index, path);
			return isPendingImageFilled(index) ? marker : path;
		},
		isMarkerIndexRegistered: (index) => isPendingMarkerIndex(index),
		discardMarkerIndex: (index) => discardPendingMarkerIndex(index),
	};
}

/**
 * Resolve `[Image #N]` markers for a submit (delegates to the shared
 * registry; one-shot per submit). Config-gated.
 */
export async function resolvePendingImageMarkers(
	text: string,
): Promise<{ images: PendingImageAttachment[] } | undefined> {
	if (!getMessagesRenderConfig().clipboardImages) return undefined;
	return sharedResolve(text);
}

// ── Submit transform (raw artifact tokens) ─────────────────────────────────

/**
 * Input transform for raw clipboard-paste path tokens that bypassed the
 * editor interception: read each token, attach the bytes as ImageContent,
 * rewrite the token to `[image]`. Tokens whose file is missing/unreadable or
 * over the size guard keep their original text. Returns undefined when
 * nothing changed (caller keeps `action: "continue"`).
 */
export async function transformClipboardImages(
	text: string,
	deps: {
		readFile?: (path: string) => Promise<Uint8Array>;
		statSize?: (path: string) => Promise<number | undefined>;
		tmpRoot?: string;
	} = {},
): Promise<{ text: string; images: PendingImageAttachment[] } | undefined> {
	if (!getMessagesRenderConfig().clipboardImages) return undefined;
	const tokens = sharedExtractTokens(text, deps.tmpRoot);
	if (tokens.length === 0) return undefined;

	const attached: PendingImageAttachment[] = [];
	const rewritten = new Map<string, string>();
	for (const token of tokens) {
		const image = await readAttachable(token, deps);
		if (!image) continue;
		attached.push({ type: "image", data: image.data, mimeType: image.mimeType });
		rewritten.set(token, IMAGE_TOKEN);
	}
	if (attached.length === 0) return undefined;
	return { text: rewriteTokens(text, rewritten, deps.tmpRoot), images: attached };
}

async function readAttachable(
	path: string,
	deps:
		| { readFile?: (path: string) => Promise<Uint8Array>; statSize?: (path: string) => Promise<number | undefined> }
		| undefined,
): Promise<{ data: string; mimeType: string } | undefined> {
	const extension = path.split(".").pop() ?? "";
	const mimeType = MIME_BY_EXTENSION[extension];
	if (!mimeType) return undefined;
	const readFileImpl = deps?.readFile ?? ((p: string) => readFile(p));
	const statSizeImpl =
		deps?.statSize ??
		(async (p: string) => {
			try {
				return (await stat(p)).size;
			} catch {
				return undefined;
			}
		});
	try {
		const size = await statSizeImpl(path);
		if (size === undefined || size <= 0 || size > MAX_ATTACHABLE_BYTES) return undefined;
		const bytes = await readFileImpl(path);
		if (bytes.length === 0 || bytes.length > MAX_ATTACHABLE_BYTES) return undefined;
		return { data: Buffer.from(bytes).toString("base64"), mimeType };
	} catch {
		return undefined;
	}
}

function rewriteTokens(text: string, rewritten: Map<string, string>, tmpRoot?: string): string {
	if (rewritten.size === 0) return text;
	return text.replace(clipboardPathRegex(tmpRoot ?? tmpdir()), (match, token: string) =>
		rewritten.has(token) ? IMAGE_TOKEN : match,
	);
}
