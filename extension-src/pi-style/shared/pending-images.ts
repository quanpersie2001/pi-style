// Pending clipboard-image registry (ADR 0009): markers ↔ image bytes.
//
// Shared state between the editor feature (allocates/discards markers at
// keystroke time — instant feedback, image bytes arrive later) and the
// messages feature (fills entries from artifacts, resolves markers at
// submit). Lives in shared/ so both features can use it without
// cross-feature imports.
//
// Lifecycle: entries are created by allocatePendingImage() when a paste
// keystroke inserts an `[Image #N] ` marker; filled asynchronously by
// fillPendingImageFromPath() once the bytes exist (editor artifact read or
// fallback); consumed one-shot by resolvePendingImagesForSubmit() (markers
// present in the submitted text attach, removed markers discard); discarded
// by discardPendingImage() when the user backspaces a whole marker or a
// rollback removes it. Session boundaries reset everything.

import { readFile, stat } from "node:fs/promises";
import { clipboardImageMarker } from "./clipboard-path.js";

/** Mirrors image-paste's guard; larger files never register. */
const MAX_ATTACHABLE_BYTES = 20 * 1024 * 1024;

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
});

interface PendingEntry {
	/** Resolves once fill completes (success or failure); submit awaits it. */
	readonly fill: Promise<void>;
	data?: string;
	mimeType?: string;
	settled: boolean;
}

const pendingImages = new Map<number, PendingEntry>();
let nextPendingIndex = 1;

/** Reset the registry and marker counter (session start/shutdown). */
export function resetPendingImageRegistry(): void {
	pendingImages.clear();
	nextPendingIndex = 1;
}

/** Allocate the next marker index (marker text: `[Image #N] `). */
export function allocatePendingImage(): { index: number; marker: string } {
	const index = nextPendingIndex++;
	let resolveFill: () => void = () => {};
	const entry: PendingEntry = {
		fill: new Promise<void>((resolve) => {
			resolveFill = resolve;
		}),
		settled: false,
	};
	pendingImages.set(index, entry);
	(entry as { resolveFill?: () => void }).resolveFill = resolveFill;
	return { index, marker: `${clipboardImageMarker(index)} ` };
}

/** Fill an allocated entry from a clipboard artifact file (stat + read + base64).
 *  Guards: missing/empty/oversized/unknown-extension → entry stays unfilled
 *  (marker resolves to plain text at submit — nothing is lost). */
export async function fillPendingImageFromPath(
	index: number,
	path: string,
	deps: {
		readFile?: (path: string) => Promise<Uint8Array>;
		statSize?: (path: string) => Promise<number | undefined>;
	} = {},
): Promise<void> {
	const entry = pendingImages.get(index);
	if (!entry || entry.settled) return;
	const extension = path.split(".").pop() ?? "";
	const mimeType = MIME_BY_EXTENSION[extension];
	if (!mimeType) {
		settle(entry);
		return;
	}
	const readFileImpl = deps.readFile ?? ((p: string) => readFile(p));
	const statSizeImpl =
		deps.statSize ??
		(async (p: string) => {
			try {
				return (await stat(p)).size;
			} catch {
				return undefined;
			}
		});
	try {
		const size = await statSizeImpl(path);
		if (size === undefined || size <= 0 || size > MAX_ATTACHABLE_BYTES) {
			settle(entry);
			return;
		}
		const bytes = await readFileImpl(path);
		if (bytes.length === 0 || bytes.length > MAX_ATTACHABLE_BYTES) {
			settle(entry);
			return;
		}
		// Zero-copy view (offset+length explicit so Uint8Array views over a larger
		// backing buffer encode exactly their own range — Buffer.from(bytes)
		// would copy the whole clipboard screenshot again).
		entry.data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
		entry.mimeType = mimeType;
	} catch {
		// Unreadable artifact: marker stays plain text.
	}
	settle(entry);
}

/** Fill an allocated entry directly from in-memory bytes. */
export function fillPendingImageBytes(index: number, data: string, mimeType: string): void {
	const entry = pendingImages.get(index);
	if (!entry || entry.settled) return;
	if (data.length > 0) {
		entry.data = data;
		entry.mimeType = mimeType;
	}
	settle(entry);
}

/** Discard a pending entry (whole-marker backspace, rollback, user removal). */
export function discardPendingImage(index: number): void {
	const entry = pendingImages.get(index);
	if (!entry) return;
	settle(entry);
	pendingImages.delete(index);
}

/** Marker text for an allocated index (editor rollback surgery). */
export function pendingImageMarker(index: number): string | undefined {
	return pendingImages.has(index) ? `${clipboardImageMarker(index)} ` : undefined;
}

/** True when `index` has an allocated (not yet consumed/discarded) entry. */
export function isPendingMarkerIndex(index: number): boolean {
	return pendingImages.has(index);
}

/** Discard by marker index (atomic backspace / rollback). */
export function discardPendingMarkerIndex(index: number): void {
	discardPendingImage(index);
}

/** True when the entry for `index` was successfully filled with bytes. */
export function isPendingImageFilled(index: number): boolean {
	const entry = pendingImages.get(index);
	return entry !== undefined && entry.data !== undefined && entry.mimeType !== undefined;
}

function settle(entry: PendingEntry): void {
	entry.settled = true;
	(entry as { resolveFill?: () => void }).resolveFill?.();
}

export interface PendingImageAttachment {
	readonly type: "image";
	readonly data: string;
	readonly mimeType: string;
}

/**
 * Resolve `[Image #N]` markers in a submitted text against the registry:
 * awaits pending fills (a fast submit racing a slow artifact read), attaches
 * filled images in ascending index order, keeps the text verbatim, and
 * consumes the registry one-shot per submit — markers removed from the text
 * discard their images (image-paste semantics: the pending queue never
 * outlives the submit after the paste).
 */
export async function resolvePendingImagesForSubmit(
	text: string,
): Promise<{ images: PendingImageAttachment[] } | undefined> {
	if (pendingImages.size === 0) return undefined;
	const markerRe = /\[Image #([0-9]+)\]/g;
	const found: number[] = [];
	for (const match of text.matchAll(markerRe)) {
		const index = Number(match[1]);
		if (Number.isInteger(index) && pendingImages.has(index)) found.push(index);
	}
	const matched = new Set(found);
	// Wait for in-flight fills so a submit right after a paste still attaches.
	await Promise.all(
		[...pendingImages.entries()].filter(([index]) => matched.has(index)).map(([, entry]) => entry.fill),
	);
	const images: PendingImageAttachment[] = [];
	for (const index of [...matched].sort((a, b) => a - b)) {
		const entry = pendingImages.get(index);
		if (entry?.data && entry.mimeType) {
			images.push({ type: "image", data: entry.data, mimeType: entry.mimeType });
		}
	}
	// One-shot consume: every pending entry is spent by this submit — matched
	// (attached or discarded) and unmatched (their markers were removed).
	for (const index of [...pendingImages.keys()]) discardPendingImage(index);
	return images.length > 0 ? { images } : undefined;
}
