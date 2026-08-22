// StyledEditor clipboard-image paste contracts (ADR 0009): instant markers at
// keystroke time, atomic whole-marker backspace, and the artifact fallback.
//
// The real surface (features/messages) is exercised separately; here a fake
// surface drives the editor paths: owning the paste keystroke when the
// clipboard holds an image, passing through when it doesn't, deleting a
// registered marker as one unit, and falling back to native behavior on
// every failure.

import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeConfig } from "../../extension-src/pi-style/domain/config-normalization.js";
import { StyledEditor } from "../../extension-src/pi-style/features/editor/index.js";
import { createClipboardImagePasteSurface } from "../../extension-src/pi-style/features/messages/image-input.js";
import { resetPendingImageRegistry } from "../../extension-src/pi-style/shared/pending-images.js";

function fakeTui() {
	return { requestRender() {}, terminal: { rows: 24 } } as never;
}
function fakeTheme() {
	return { borderColor: (t: string) => t } as never;
}

const PASTE_KEY = "\x06"; // arbitrary byte the fake matcher maps to the paste binding
const BACKSPACE = "\x7f";
const LEFT = "\x1b[D";

function fakeKeys() {
	return {
		matches(data: string, keybinding: string) {
			return keybinding === "app.clipboard.pasteImage" && data === PASTE_KEY;
		},
	} as never;
}

type SurfaceOverrides = {
	enabled?: () => boolean;
	clipboardHasImage?: () => boolean | null;
	markerFromClipboard?: () => string;
	markerFromArtifact?: (path: string) => Promise<string>;
	isMarkerIndexRegistered?: (index: number) => boolean;
	discardMarkerIndex?: (index: number) => void;
};

function fakeSurface(overrides: SurfaceOverrides = {}) {
	const calls = { markerFromClipboard: 0, discard: [] as number[], registered: [] as number[] };
	const surface = {
		enabled: overrides.enabled ?? (() => true),
		clipboardHasImage: overrides.clipboardHasImage ?? (() => true),
		markerFromClipboard:
			overrides.markerFromClipboard ??
			(() => {
				calls.markerFromClipboard++;
				return "[Image #1] ";
			}),
		markerFromArtifact: overrides.markerFromArtifact ?? ((p: string) => Promise.resolve(p)),
		isMarkerIndexRegistered: overrides.isMarkerIndexRegistered ?? ((index: number) => index === 1),
		discardMarkerIndex:
			overrides.discardMarkerIndex ??
			((index: number) => {
				calls.discard.push(index);
			}),
	};
	const inner = surface.isMarkerIndexRegistered;
	surface.isMarkerIndexRegistered = (index: number) => {
		calls.registered.push(index);
		return inner(index);
	};
	return { surface, calls };
}

function editor(surface?: unknown) {
	return new StyledEditor(fakeTui(), fakeTheme(), fakeKeys(), {
		config: normalizeConfig({}),
		snapshot: { model: "m", thinkingLevel: "off", cwd: "/work" },
		theme: fakeTheme(),
		onSnapshot: () => {},
		...(surface ? { clipboardImagePaste: surface } : {}),
	});
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
	resetPendingImageRegistry();
});

describe("paste keystroke ownership (instant marker)", () => {
	it("owns the paste keystroke and inserts the marker synchronously when the clipboard has an image", () => {
		const { surface, calls } = fakeSurface();
		const e = editor(surface);
		e.handleInput(PASTE_KEY);
		expect(e.getText()).toBe("[Image #1] "); // instant — no await, no flash
		expect(calls.markerFromClipboard).toBe(1);
	});

	it("passes text pastes through untouched (no image in clipboard)", () => {
		const { surface, calls } = fakeSurface({ clipboardHasImage: () => false });
		const e = editor(surface);
		e.handleInput(PASTE_KEY);
		expect(calls.markerFromClipboard).toBe(0);
		expect(e.getText()).toBe("");
	});

	it("passes through when the presence probe is unavailable (null)", () => {
		const { surface, calls } = fakeSurface({ clipboardHasImage: () => null });
		const e = editor(surface);
		e.handleInput(PASTE_KEY);
		expect(calls.markerFromClipboard).toBe(0);
	});

	it("passes through when disabled", () => {
		const { surface, calls } = fakeSurface({ enabled: () => false });
		const e = editor(surface);
		e.handleInput(PASTE_KEY);
		expect(calls.markerFromClipboard).toBe(0);
	});

	it("regular typing still works with the surface wired", () => {
		const { surface } = fakeSurface();
		const e = editor(surface);
		e.handleInput("h");
		e.handleInput("i");
		expect(e.getText()).toBe("hi");
	});
});

describe("atomic marker backspace", () => {
	it("deletes the whole marker when backspacing right after it", () => {
		const { surface, calls } = fakeSurface();
		const e = editor(surface);
		e.insertTextAtCursor("[Image #1] ");
		expect(e.getText()).toBe("[Image #1] ");
		e.handleInput(BACKSPACE);
		expect(e.getText()).toBe("");
		expect(calls.discard).toEqual([1]);
	});

	it("deletes the marker mid-text and keeps the cursor at the deletion point", () => {
		const { surface } = fakeSurface();
		const e = editor(surface);
		e.setText("A[Image #1] B");
		// Cursor starts at end (after "B"); one left → right after the marker's
		// trailing space. Backspace there deletes the whole marker atomically.
		e.handleInput(LEFT);
		const before = e.getCursor();
		e.handleInput(BACKSPACE);
		expect(e.getText()).toBe("AB");
		const after = e.getCursor();
		expect(after.line).toBe(before.line);
		expect(after.col).toBe(before.col - "[Image #1] ".length);
	});

	it("normal backspace still deletes single characters outside markers", () => {
		const { surface } = fakeSurface();
		const e = editor(surface);
		e.insertTextAtCursor("hello");
		e.handleInput(BACKSPACE);
		expect(e.getText()).toBe("hell");
	});

	it("markers without a registry entry backspace character-by-character (history/paste text)", () => {
		const { surface } = fakeSurface({ isMarkerIndexRegistered: () => false });
		const e = editor(surface);
		e.insertTextAtCursor("[Image #1] ");
		e.handleInput(BACKSPACE); // deletes just the trailing space
		expect(e.getText()).toBe("[Image #1]");
	});

	it("backspaces marker-looking text character-by-character when the surface is disabled", () => {
		const { surface, calls } = fakeSurface({ enabled: () => false });
		const e = editor(surface);
		e.insertTextAtCursor("[Image #1] ");
		e.handleInput(BACKSPACE); // native path: deletes just the trailing space
		expect(e.getText()).toBe("[Image #1]");
		expect(calls.discard).toEqual([]);
		expect(calls.registered).toEqual([]); // the gate short-circuits before registry checks
		e.handleInput(BACKSPACE);
		expect(e.getText()).toBe("[Image #1");
	});

	it("editor state stays consistent for typing after an atomic marker backspace", () => {
		const { surface } = fakeSurface();
		const e = editor(surface);
		e.setText("A[Image #1] ");
		e.handleInput(BACKSPACE); // deletes the whole marker; cursor after "A"
		expect(e.getText()).toBe("A");
		expect(e.getCursor()).toEqual({ line: 0, col: 1 });
		e.handleInput("b");
		e.handleInput("c");
		expect(e.getText()).toBe("Abc");
		expect(e.getCursor()).toEqual({ line: 0, col: 3 });
	});

	it("fires onChange exactly once with the post-deletion text during the atomic backspace", () => {
		const { surface } = fakeSurface();
		const e = editor(surface);
		e.setText("A[Image #1] B");
		e.handleInput(LEFT);
		const seen: string[] = [];
		(e as unknown as { onChange?: (text: string) => void }).onChange = (text) => seen.push(text);
		e.handleInput(BACKSPACE);
		expect(seen).toEqual(["AB"]);
	});

	it("undo regression: an atomic marker backspace does not corrupt earlier paste-marker atomicity", () => {
		const { surface } = fakeSurface();
		const e = editor(surface);
		// Register a real `[paste #1]` entry through the native large-paste path
		// (>10 lines -> marker + registry entry).
		const pasted = Array.from({ length: 11 }, (_, i) => `line ${i}`).join("\n");
		e.handleInput(`\x1b[200~${pasted}\x1b[201~`);
		expect(e.getText()).toBe("[paste #1 +11 lines]");
		// Marker insertion after the paste, then atomic image-marker backspace.
		e.insertTextAtCursor("[Image #1] ");
		expect(e.getText()).toBe("[paste #1 +11 lines][Image #1] ");
		e.handleInput(BACKSPACE);
		expect(e.getText()).toBe("[paste #1 +11 lines]");
		// Undo (ctrl+-) restores the pre-marker snapshot: no dangling image marker
		// is resurrected (the old setText surgery pushed its own undo snapshot, so
		// undo restored the already-discarded `[Image #1] ` as inert text). The
		// pastes registry survives either way (UndoStack clones on push), so the
		// restored `[paste #1 ...]` marker must still delete as ONE atomic unit.
		e.handleInput("\x1f");
		expect(e.getText()).toBe("[paste #1 +11 lines]");
		e.handleInput(BACKSPACE);
		expect(e.getText()).toBe("");
	});
});

describe("artifact fallback (insertTextAtCursor)", () => {
	it("inserts plain text verbatim without a surface", () => {
		const e = editor();
		e.insertTextAtCursor("hello world");
		expect(e.getText()).toBe("hello world");
	});

	it("inserts non-path text verbatim even with a surface wired", async () => {
		const { surface } = fakeSurface();
		const e = editor(surface);
		e.insertTextAtCursor("just text");
		await tick();
		expect(e.getText()).toBe("just text");
	});

	it("routes a single clipboard artifact path through markerFromArtifact", async () => {
		const real = join(tmpdir(), `pi-clipboard-${randomUUID()}.png`);
		const { surface } = fakeSurface({ markerFromArtifact: async () => "[Image #1] " });
		const e = editor(surface);
		e.insertTextAtCursor(real);
		await tick();
		expect(e.getText()).toBe("[Image #1] ");
	});

	it("falls back to the original path when the artifact read fails", async () => {
		const real = join(tmpdir(), `pi-clipboard-${randomUUID()}.png`);
		const { surface } = fakeSurface({ markerFromArtifact: async (p) => p });
		const e = editor(surface);
		e.insertTextAtCursor(real);
		await tick();
		expect(e.getText()).toBe(real);
	});

	it("falls back to the original path when the surface throws", async () => {
		const real = join(tmpdir(), `pi-clipboard-${randomUUID()}.png`);
		const { surface } = fakeSurface({
			markerFromArtifact: async () => {
				throw new Error("boom");
			},
		});
		const e = editor(surface);
		e.insertTextAtCursor(real);
		await tick();
		expect(e.getText()).toBe(real);
	});

	it("end-to-end: keystroke → instant marker → submit resolution", async () => {
		const surface = createClipboardImagePasteSurface({
			hasImage: () => true,
			readBinary: async () => ({ bytes: Buffer.from("png!") }),
		});
		const e = editor(surface);
		e.handleInput(PASTE_KEY);
		expect(e.getText()).toBe("[Image #1] ");
		const { resolvePendingImageMarkers } = await import(
			"../../extension-src/pi-style/features/messages/image-input.js"
		);
		const resolved = await resolvePendingImageMarkers(`${e.getText()}describe this`);
		expect(resolved?.images).toEqual([
			{ type: "image", data: Buffer.from("png!").toString("base64"), mimeType: "image/png" },
		]);
	});
});
