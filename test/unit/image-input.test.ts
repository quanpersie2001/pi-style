// Clipboard image input contracts (ADR 0009): surface + submit transform.
//
// The surface (editor wiring) provides instant markers (allocate first, fill
// async) and the artifact fallback; the submit transform resolves markers
// one-shot and upgrades raw clipboard artifact tokens. Everything else
// (user-typed paths, missing/oversized files, other sources, config off)
// must pass through unchanged.

import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
	createClipboardImagePasteSurface,
	extractClipboardImageTokens,
	IMAGE_TOKEN,
	resolvePendingImageMarkers,
	transformClipboardImages,
} from "../../extension-src/pi-style/features/messages/image-input.js";
import {
	resetMessagesRenderConfig,
	setMessagesRenderConfig,
} from "../../extension-src/pi-style/features/messages/render-config.js";
import {
	__regexCacheSizeForTest,
	clipboardMarkerAtEnd,
	clipboardPathRegex,
	resetClipboardPathRegexCache,
} from "../../extension-src/pi-style/shared/clipboard-path.js";
import {
	allocatePendingImage,
	fillPendingImageBytes,
	fillPendingImageFromPath,
	resetPendingImageRegistry,
} from "../../extension-src/pi-style/shared/pending-images.js";

const TMP = "/tmp/test-tmp";
const UUID = randomUUID();
const path = (name = UUID, ext = "png") => `${TMP}/pi-clipboard-${name}.${ext}`;

afterEach(() => {
	resetMessagesRenderConfig();
	resetPendingImageRegistry();
});

describe("token detection", () => {
	it("accepts Pi's clipboard-paste path shape for every written extension", () => {
		for (const ext of ["png", "jpg", "jpeg", "webp", "gif"]) {
			expect(extractClipboardImageTokens(`look ${path(UUID, ext)} please`, TMP)).toEqual([path(UUID, ext)]);
		}
	});

	it("matches tokens at boundaries and all occurrences without duplicates", () => {
		const a = path(randomUUID());
		const b = path(randomUUID());
		expect(extractClipboardImageTokens(`${a} mid ${b} end ${a}`, TMP)).toEqual([a, b]);
	});

	it("matches tokens followed or wrapped by punctuation (real typing shapes)", () => {
		const a = path(randomUUID());
		expect(extractClipboardImageTokens(`${a}, đây là gì?`, TMP)).toEqual([a]);
		expect(extractClipboardImageTokens(`ảnh ${a}.`, TMP)).toEqual([a]);
		expect(extractClipboardImageTokens(`(${a})`, TMP)).toEqual([a]);
		expect(extractClipboardImageTokens(`"${a}"`, TMP)).toEqual([a]);
	});

	it("rejects near-miss shapes (no silent conversion of user-typed paths)", () => {
		const cases = [
			`read ./pi-clipboard-${UUID}.png`,
			`see /tmp/pi-clipboard-not-a-uuid.png`,
			`see ${TMP}/pi-clipboard-${UUID}.txt`,
			`see ${TMP}/other-${UUID}.png`,
			`see ${TMP}/pi-clipboard-${UUID}x.png`,
			`see${TMP}/pi-clipboard-${UUID}.png`, // glued to a word: not a token
			`see${TMP}/pi-clipboard-${UUID}.pngx`, // trailing alphanumeric junk
			"plain text with no paths",
			"",
		];
		for (const text of cases) expect(extractClipboardImageTokens(text, TMP), text).toEqual([]);
	});
});

describe("marker-at-end helper (atomic backspace detection)", () => {
	it("returns index and length including the trailing space", () => {
		expect(clipboardMarkerAtEnd("look [Image #3] ")).toEqual({ index: 3, length: 11 });
		expect(clipboardMarkerAtEnd("[Image #12] ")).toEqual({ index: 12, length: 12 });
	});

	it("matches without the trailing space too (space deleted manually)", () => {
		expect(clipboardMarkerAtEnd("look [Image #3]")).toEqual({ index: 3, length: 10 });
	});

	it("rejects non-ending and malformed shapes", () => {
		expect(clipboardMarkerAtEnd("[Image #3] mid")).toBeUndefined();
		expect(clipboardMarkerAtEnd("[Image] ")).toBeUndefined();
		expect(clipboardMarkerAtEnd("[Image #x] ")).toBeUndefined();
		expect(clipboardMarkerAtEnd("")).toBeUndefined();
	});
});

describe("submit transform (raw artifact tokens)", () => {
	const bytes = (n: number) => new Uint8Array(n).fill(0x61);

	function depsFor(files: Record<string, { bytes?: Uint8Array; size?: number }>) {
		return {
			tmpRoot: TMP,
			readFile: async (p: string) => {
				const file = files[p];
				if (!file || file.bytes === undefined) throw new Error("ENOENT");
				return file.bytes;
			},
			statSize: async (p: string) => {
				const file = files[p];
				if (!file) return undefined;
				return file.size ?? file.bytes?.length;
			},
		};
	}

	it("attaches a readable file and rewrites the token to [image]", async () => {
		const p = path();
		const result = await transformClipboardImages(`what is wrong here? ${p}`, depsFor({ [p]: { bytes: bytes(4) } }));
		expect(result?.text).toBe(`what is wrong here? ${IMAGE_TOKEN}`);
		expect(result?.images).toEqual([
			{ type: "image", data: Buffer.from(bytes(4)).toString("base64"), mimeType: "image/png" },
		]);
	});

	it("maps extensions to mime types", async () => {
		const jpg = path(randomUUID(), "jpg");
		const result = await transformClipboardImages(jpg, depsFor({ [jpg]: { bytes: bytes(2) } }));
		expect(result?.images[0]?.mimeType).toBe("image/jpeg");
	});

	it("attaches multiple tokens and keeps text order", async () => {
		const a = path(randomUUID());
		const b = path(randomUUID(), "webp");
		const result = await transformClipboardImages(
			`first ${a} then ${b}`,
			depsFor({
				[a]: { bytes: bytes(1) },
				[b]: { bytes: bytes(2) },
			}),
		);
		expect(result?.text).toBe(`first ${IMAGE_TOKEN} then ${IMAGE_TOKEN}`);
		expect(result?.images).toHaveLength(2);
		expect(result?.images[0]?.data).toBe(Buffer.from(bytes(1)).toString("base64"));
		expect(result?.images[1]?.mimeType).toBe("image/webp");
	});

	it("keeps missing or oversized tokens verbatim and attaches the rest", async () => {
		const ok = path(randomUUID());
		const missing = path(randomUUID());
		const huge = path(randomUUID());
		const result = await transformClipboardImages(
			`${ok}, ${missing} ${huge}!`,
			depsFor({
				[ok]: { bytes: bytes(3) },
				[huge]: { size: 21 * 1024 * 1024 },
			}),
		);
		expect(result?.text).toBe(`${IMAGE_TOKEN}, ${missing} ${huge}!`);
		expect(result?.images).toHaveLength(1);
	});

	it("returns undefined when nothing is attachable or nothing matched", async () => {
		const p = path();
		expect(await transformClipboardImages(`no tokens here`, depsFor({}))).toBeUndefined();
		expect(await transformClipboardImages(`${p}`, depsFor({}))).toBeUndefined();
		expect(await transformClipboardImages(`${p}`, depsFor({ [p]: { size: 0 } }))).toBeUndefined();
	});

	it("never produces empty text (token replaced, not deleted)", async () => {
		const p = path();
		const result = await transformClipboardImages(p, depsFor({ [p]: { bytes: bytes(1) } }));
		expect(result?.text).toBe(IMAGE_TOKEN);
	});

	it("is disabled by config (messages.clipboardImages: false)", async () => {
		setMessagesRenderConfig({ clipboardImages: false });
		const p = path();
		expect(await transformClipboardImages(`${p}`, depsFor({ [p]: { bytes: bytes(1) } }))).toBeUndefined();
	});
});

describe("paste surface", () => {
	it("markerFromClipboard returns the marker synchronously and fills async", async () => {
		const surface = createClipboardImagePasteSurface({
			hasImage: () => true,
			readBinary: async () => ({ bytes: new Uint8Array([9, 9, 9]) }),
		});
		const marker = surface.markerFromClipboard(); // ← synchronous, instant
		expect(marker).toBe("[Image #1] ");
		// Submit awaits the fill even when it races.
		const resolved = await resolvePendingImageMarkers(`${marker}describe`);
		expect(resolved?.images).toEqual([
			{ type: "image", data: Buffer.from([9, 9, 9]).toString("base64"), mimeType: "image/png" },
		]);
	});

	it("markerFromClipboard with a failed read leaves the marker as plain text", async () => {
		const surface = createClipboardImagePasteSurface({
			hasImage: () => true,
			readBinary: async () => null,
		});
		const marker = surface.markerFromClipboard();
		expect(await resolvePendingImageMarkers(`${marker}what`)).toBeUndefined();
	});

	it("markerFromArtifact converts a real artifact and passes failures through", async () => {
		const { writeFile, rm } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		const real = join(tmpdir(), `pi-clipboard-${randomUUID()}.png`);
		await writeFile(real, Buffer.from("art"));
		const surface = createClipboardImagePasteSurface();
		try {
			expect(await surface.markerFromArtifact(real)).toBe("[Image #1] ");
		} finally {
			await rm(real, { force: true });
		}
		// Missing artifact: the original path comes back (native fallback).
		const missing = join(tmpdir(), `pi-clipboard-${randomUUID()}.png`);
		expect(await surface.markerFromArtifact(missing)).toBe(missing);
	});

	it("disabled surface reports enabled=false", () => {
		setMessagesRenderConfig({ clipboardImages: false });
		const surface = createClipboardImagePasteSurface();
		expect(surface.enabled()).toBe(false);
	});
});

describe("regex memoization (I1)", () => {
	afterEach(() => resetClipboardPathRegexCache());

	it("compiles one regex per tmp root and reuses it across calls", () => {
		resetClipboardPathRegexCache();
		expect(__regexCacheSizeForTest()).toBe(0);
		const p = path();
		expect(extractClipboardImageTokens(`a ${p}`, TMP)).toEqual([p]);
		expect(__regexCacheSizeForTest()).toBe(1);
		// Same root again: no new compile — the cached instance comes back.
		expect(extractClipboardImageTokens(`b ${p}`, TMP)).toEqual([p]);
		expect(clipboardPathRegex(TMP)).toBe(clipboardPathRegex(TMP));
		expect(__regexCacheSizeForTest()).toBe(1);
	});

	it("shares the memoized instance safely (matchAll clone + /g replace reset lastIndex)", () => {
		resetClipboardPathRegexCache();
		const a = path(randomUUID());
		const b = path(randomUUID(), "jpg");
		// Interleave every consumer shape against the same shared instance.
		expect(extractClipboardImageTokens(`${a} ${b}`, TMP)).toEqual([a, b]);
		expect(extractClipboardImageTokens(`${a} again`, TMP)).toEqual([a]);
		expect([`${a} x`].map((t) => t.replace(clipboardPathRegex(TMP), "REPL"))).toEqual(["REPL x"]);
		// After replace consumed the shared /g instance, matchAll still matches.
		expect(extractClipboardImageTokens(`${b}`, TMP)).toEqual([b]);
	});

	it("bounds the cache (oldest root evicted past the cap)", () => {
		resetClipboardPathRegexCache();
		for (let i = 0; i < 32; i++) {
			void extractClipboardImageTokens("", `${TMP}-root-${i}`);
		}
		expect(__regexCacheSizeForTest()).toBeLessThanOrEqual(16);
		// The most recent root is still cached (re-lookup hits).
		expect(clipboardPathRegex(`${TMP}-root-31`)).toBe(clipboardPathRegex(`${TMP}-root-31`));
		expect(__regexCacheSizeForTest()).toBeLessThanOrEqual(16);
	});
});

describe("zero-copy fills (I2: Uint8Array views over larger buffers)", () => {
	it("markerFromClipboard encodes exactly the view range (non-zero byteOffset)", async () => {
		const backing = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
		const view = new Uint8Array(backing.buffer, 2, 6); // bytes 2..7, not 0..9
		expect(view.byteOffset).toBe(2);
		expect(view.byteLength).toBe(6);
		const surface = createClipboardImagePasteSurface({ readBinary: async () => ({ bytes: view }) });
		const marker = surface.markerFromClipboard();
		const resolved = await resolvePendingImageMarkers(marker);
		expect(resolved?.images).toEqual([
			{ type: "image", data: Buffer.from([2, 3, 4, 5, 6, 7]).toString("base64"), mimeType: "image/png" },
		]);
	});

	it("fillPendingImageFromPath encodes exactly the view range (non-zero byteOffset)", async () => {
		const backing = new Uint8Array([9, 8, 7, 6, 5, 4]);
		const view = new Uint8Array(backing.buffer, 1, 4); // bytes 8,7,6,5
		const { index, marker } = allocatePendingImage();
		await fillPendingImageFromPath(index, `${TMP}/pi-clipboard-${UUID}.png`, {
			readFile: async () => view,
			statSize: async () => view.byteLength,
		});
		const resolved = await resolvePendingImageMarkers(marker);
		expect(resolved?.images).toEqual([
			{ type: "image", data: Buffer.from([8, 7, 6, 5]).toString("base64"), mimeType: "image/png" },
		]);
	});
});

describe("submit marker resolution", () => {
	it("attaches filled markers in ascending order and keeps text verbatim", async () => {
		const a = allocatePendingImage();
		fillPendingImageBytes(a.index, Buffer.from("one").toString("base64"), "image/png");
		const b = allocatePendingImage();
		fillPendingImageBytes(b.index, Buffer.from("two").toString("base64"), "image/jpeg");
		const text = `check ${b.marker} and ${a.marker} please`;
		const result = await resolvePendingImageMarkers(text);
		expect(result?.images).toHaveLength(2);
		expect(result?.images[0]?.data).toBe(Buffer.from("one").toString("base64"));
		expect(result?.images[1]?.mimeType).toBe("image/jpeg");
		// One-shot: a second submit resolves nothing.
		expect(await resolvePendingImageMarkers(text)).toBeUndefined();
	});

	it("discards removed markers (image-paste semantics) and ignores unknown ones", async () => {
		expect(await resolvePendingImageMarkers("what is [Image #1] here?")).toBeUndefined();
		const a = allocatePendingImage();
		fillPendingImageBytes(a.index, Buffer.from("x").toString("base64"), "image/png");
		// Marker removed from the submitted text: image discarded, one-shot.
		expect(await resolvePendingImageMarkers("no marker")).toBeUndefined();
		expect(await resolvePendingImageMarkers(a.marker)).toBeUndefined();
	});
});

describe("input handler semantics (any submit source consumes markers)", () => {
	/** Mirrors the pi/index.ts `input` handler logic after the fix. */
	const inputHandler = async (event: { text: string; source: "interactive" | "rpc" | "extension" }) => {
		if (event.source === "interactive") {
			const trimmed = event.text.trimStart();
			if (trimmed.startsWith("!")) {
				const bangLength = trimmed.startsWith("!!") ? 2 : 1;
				if (trimmed.slice(bangLength).trim() === "") return { action: "handled" as const };
			}
		}
		const markerResult = await resolvePendingImageMarkers(event.text);
		const pathResult = event.source === "interactive" ? await transformClipboardImages(event.text) : undefined;
		if (markerResult || pathResult) {
			return {
				action: "transform" as const,
				text: pathResult?.text ?? event.text,
				images: [...(markerResult?.images ?? []), ...(pathResult?.images ?? [])],
			};
		}
		return undefined;
	};

	it("rpc submit with a pending marker attaches the image (no dangling)", async () => {
		const surface = createClipboardImagePasteSurface({
			hasImage: () => true,
			readBinary: async () => ({ bytes: new Uint8Array([1, 2, 3]) }),
		});
		const marker = surface.markerFromClipboard();
		const result = await inputHandler({ text: `${marker}sent via rpc`, source: "rpc" });
		expect(result?.action).toBe("transform");
		expect(result?.images).toEqual([
			{ type: "image", data: Buffer.from([1, 2, 3]).toString("base64"), mimeType: "image/png" },
		]);
	});

	it("rpc submit without the marker still consumes the registry", async () => {
		const a = allocatePendingImage();
		fillPendingImageBytes(a.index, Buffer.from("x").toString("base64"), "image/png");
		// An unrelated rpc prompt submits first: the pasted image must not dangle.
		expect(await inputHandler({ text: "unrelated rpc prompt", source: "rpc" })).toBeUndefined();
		// Registry was consumed — a later submit never sees the stale image.
		expect(await resolvePendingImageMarkers(a.marker)).toBeUndefined();
	});

	it("extension submit with a pending marker attaches; path tokens stay interactive-only", async () => {
		const a = allocatePendingImage();
		fillPendingImageBytes(a.index, Buffer.from("e").toString("base64"), "image/png");
		// Raw artifact path token in a non-interactive submit is NOT upgraded.
		const p = path();
		const result = await inputHandler({ text: `${a.marker}${p}`, source: "extension" });
		expect(result?.action).toBe("transform");
		expect(result?.text).toBe(`${a.marker}${p}`);
		expect(result?.images).toEqual([
			{ type: "image", data: Buffer.from("e").toString("base64"), mimeType: "image/png" },
		]);
	});
});

describe("live filesystem (pattern against the real tmpdir)", () => {
	it("matches a real file created with the exact built-in paste naming", async () => {
		const { writeFile, rm } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		const real = join(tmpdir(), `pi-clipboard-${randomUUID()}.png`);
		await writeFile(real, Buffer.from("png-bytes"));
		try {
			const result = await transformClipboardImages(`check ${real}`);
			expect(result?.text).toBe(`check ${IMAGE_TOKEN}`);
			expect(result?.images[0]?.data).toBe(Buffer.from("png-bytes").toString("base64"));
		} finally {
			await rm(real, { force: true });
		}
	});

	it("regression: real-world submit shape (path + comma + question, session 20-09-44)", async () => {
		const { writeFile, rm } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		const real = join(tmpdir(), `pi-clipboard-${randomUUID()}.png`);
		await writeFile(real, Buffer.from("shot"));
		try {
			// Exact shape from the failed manual test: pasted path, comma, question.
			const result = await transformClipboardImages(`${real}, Đây là hình ảnh gì?`);
			expect(result?.text).toBe(`${IMAGE_TOKEN}, Đây là hình ảnh gì?`);
			expect(result?.images).toHaveLength(1);
		} finally {
			await rm(real, { force: true });
		}
	});
});
