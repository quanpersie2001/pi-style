// Sync clipboard-image presence probe (ADR 0009 instant-marker surface).
//
// Pi's built-in paste reads the clipboard asynchronously (native module,
// ~90ms for a screenshot) before it can tell whether the clipboard even holds
// an image. The native module also exposes a synchronous hasImage() poll —
// resolving it through Pi's own install lets the editor insert the
// `[Image #N] ` marker at keystroke time (zero-latency feedback) instead of
// after the read, while text pastes stay untouched (no marker flash).
//
// Resolution mirrors Pi's clipboard-native.js: require "@mariozechner/clipboard"
// relative to the pi-coding-agent package, where the module is installed.
// Unresolvable (bundled/aliased hosts, Termux) → null → caller falls back to
// the artifact-time marker path.

import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";

interface ClipboardPresenceModule {
	hasImage(): boolean;
	getImageBinary?(): Promise<Array<number> | Uint8Array>;
}

let cachedModule: ClipboardPresenceModule | null | undefined;

/** Resolution roots, ordered: the running pi process's own module graph first
 *  (process.argv[1] is pi's cli — its install carries @mariozechner/clipboard
 *  as an optionalDependency, possibly nested and NOT visible from the
 *  extension project's node_modules), then the extension's own graph.
 *  argv[1] may be a symlink (bin/pi) — realpath it first so the require root
 *  lands inside the real install. */
function clipboardResolutionRoots(): string[] {
	const roots: string[] = [];
	const argvMain = process.argv[1];
	if (typeof argvMain === "string" && argvMain.startsWith("/")) {
		try {
			roots.push(dirname(realpathSync(argvMain)));
		} catch {
			roots.push(dirname(argvMain));
		}
	}
	roots.push(import.meta.url);
	return roots;
}

function loadClipboardModule(): ClipboardPresenceModule | null {
	if (cachedModule !== undefined) return cachedModule;
	if (process.env.TERMUX_VERSION) {
		cachedModule = null;
		return cachedModule;
	}
	for (const root of clipboardResolutionRoots()) {
		try {
			const require = createRequire(root);
			const resolved = require("@mariozechner/clipboard") as ClipboardPresenceModule;
			if (resolved && typeof resolved.hasImage === "function") {
				cachedModule = resolved;
				return cachedModule;
			}
		} catch {
			// Try the next resolution root.
		}
	}
	cachedModule = null;
	return cachedModule;
}

/**
 * True when the system clipboard currently holds an image; null when the
 * native clipboard module is unavailable (caller must not use the result to
 * gate instant feedback — fall back to the async path instead).
 */
export function clipboardHasImageSync(): boolean | null {
	const clipboard = loadClipboardModule();
	if (!clipboard || typeof clipboard.hasImage !== "function") return null;
	try {
		return clipboard.hasImage() === true;
	} catch {
		return null;
	}
}

/**
 * Read the clipboard image bytes directly through the native module (PNG on
 * platforms where the module reports images). Null when unavailable or the
 * clipboard holds no image — callers fall back to artifact-time handling.
 * `skipPresenceProbe`: for callers that already confirmed presence via
 * hasImage() (the owned-paste path probes at keystroke time) — skips the
 * redundant second native probe. Default behavior is unchanged.
 */
export async function readClipboardImageBinary(options: { skipPresenceProbe?: boolean } = {}): Promise<{
	bytes: Uint8Array;
} | null> {
	const clipboard = loadClipboardModule();
	if (!clipboard || typeof clipboard.hasImage !== "function" || typeof clipboard.getImageBinary !== "function") {
		return null;
	}
	try {
		if (!options.skipPresenceProbe && !clipboard.hasImage()) return null;
		const imageData = await clipboard.getImageBinary();
		if (!imageData || imageData.length === 0) return null;
		const bytes = imageData instanceof Uint8Array ? imageData : Uint8Array.from(imageData);
		return bytes.length > 0 ? { bytes } : null;
	} catch {
		return null;
	}
}

/** Test seam: forget the cached module resolution. */
export function resetClipboardPresenceCache(): void {
	cachedModule = undefined;
}
