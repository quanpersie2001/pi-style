// Clipboard-paste path pattern (ADR 0009).
//
// Pi's built-in Ctrl+V (app.clipboard.pasteImage) materializes clipboard
// images as `<os.tmpdir()>/pi-clipboard-<uuid>.<ext>` files and inserts that
// absolute path into the editor as text. This module owns the shape of those
// artifacts so the editor feature (marker interception) and the messages
// feature (submit transform) share one definition without cross-feature
// imports (the pattern is a shared primitive).

import { tmpdir } from "node:os";

/** crypto.randomUUID() shape: lowercase v4, 8-4-4-4-12 hex groups. */
export const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Extensions Pi's clipboard paste writes (extensionForImageMimeType / png). */
export const CLIPBOARD_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"] as const;

/** Marker inserted by the editor interception for a pending pasted image. */
export function clipboardImageMarker(index: number): string {
	return `[Image #${index}]`;
}

/** `[Image #N]` marker token (editor interception; ADR 0009 marker surface). */
export const CLIPBOARD_IMAGE_MARKER_PATTERN = /\[Image #([0-9]+)\]/g;

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Memoized regexes keyed by tmp root: tmpdir() call + escapeRegExp + regex
 *  compile happen once per root instead of on every submit/paste probe.
 *  Bounded because tests inject arbitrary roots — past the cap the oldest
 *  entry is evicted. Sharing one global instance per root is safe:
 *  String.matchAll clones the regex into its iterator (original untouched),
 *  and String.match/.replace with /g reset lastIndex themselves. */
const clipboardPathRegexCache = new Map<string, RegExp>();
const CLIPBOARD_PATH_REGEX_CACHE_MAX = 16;

/** Regex matching Pi clipboard-paste paths under the given tmpdir (default: process).
 *  Boundaries are non-alphanumeric (not whitespace-only): users type
 *  punctuation straight after a pasted path (`<path>, đây là...`), so a
 *  whitespace-or-EOL lookahead would miss the most common real shapes.
 *  Alphanumeric neighbors still reject glued text (`x<path>`). */
export function clipboardPathRegex(tmpRoot: string = tmpdir()): RegExp {
	const cached = clipboardPathRegexCache.get(tmpRoot);
	if (cached) return cached;
	const exts = CLIPBOARD_IMAGE_EXTENSIONS.join("|");
	const regex = new RegExp(
		`(?<![a-zA-Z0-9])(${escapeRegExp(tmpRoot)}/pi-clipboard-${UUID_PATTERN}\\.(${exts}))(?![a-zA-Z0-9])`,
		"g",
	);
	if (clipboardPathRegexCache.size >= CLIPBOARD_PATH_REGEX_CACHE_MAX) {
		const oldest = clipboardPathRegexCache.keys().next().value;
		if (oldest !== undefined) clipboardPathRegexCache.delete(oldest);
	}
	clipboardPathRegexCache.set(tmpRoot, regex);
	return regex;
}

/** Test seam: clear the memoization cache (isolation between suites). */
export function resetClipboardPathRegexCache(): void {
	clipboardPathRegexCache.clear();
}

/** Test seam: current memoized-regex count (memoization observability). */
export function __regexCacheSizeForTest(): number {
	return clipboardPathRegexCache.size;
}

/** True when the whole string is exactly one clipboard-paste path token —
 *  the shape Pi's handleClipboardPaste passes to insertTextAtCursor. */
export function isSingleClipboardImagePath(text: string, tmpRoot?: string): boolean {
	if (!text || /\s/.test(text)) return false;
	const match = text.match(clipboardPathRegex(tmpRoot ?? tmpdir()));
	return match !== null && match.length === 1 && match[0] === text;
}

/** All distinct clipboard-paste path tokens in the text (verbatim matches).
 *  `tmpRoot` defaults to the process tmpdir; tests inject a fixed root. */
export function extractClipboardImageTokens(text: string, tmpRoot?: string): string[] {
	const tokens = new Set<string>();
	for (const match of text.matchAll(clipboardPathRegex(tmpRoot ?? tmpdir()))) {
		const token = match[1];
		if (token) tokens.add(token);
	}
	return [...tokens];
}

const MARKER_AT_END_PATTERN = /\[Image #([0-9]+)\]( ?)$/;

/** When `text` ends with a clipboard image marker, return its index and total
 *  length (including the trailing space when present). Used by the editor's
 *  atomic backspace: the marker directly before the cursor deletes as a unit. */
export function clipboardMarkerAtEnd(text: string): { index: number; length: number } | undefined {
	const match = MARKER_AT_END_PATTERN.exec(text);
	if (!match) return undefined;
	return { index: Number(match[1]), length: match[0].length };
}
