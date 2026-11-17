import { EventEmitter } from "node:events";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { deflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPreviewImageProcessor } from "../../extension-src/pi-style/pi/image-preview-processor.js";

const workerUrl = new URL("../../extension-src/pi-style/pi/image-preview-worker.mjs", import.meta.url);
const moduleUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
const signal = () => new AbortController().signal;

// Real decoder input: RGB scanlines, zlib and PNG chunk CRCs (not header-only fixtures).
function chunk(type: string, data: Buffer) {
	const payload = Buffer.concat([Buffer.from(type), data]);
	let crc = 0xffffffff;
	for (const byte of payload) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	const result = Buffer.alloc(data.length + 12);
	result.writeUInt32BE(data.length);
	payload.copy(result, 4);
	result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
	return result;
}

function validPng(width: number, height: number) {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 2;
	const pixels = Buffer.alloc((width * 3 + 1) * height);
	let state = 123456;
	for (let y = 0; y < height; y++) {
		for (let x = 1; x <= width * 3; x++) {
			state ^= state << 13;
			state ^= state >>> 17;
			state ^= state << 5;
			pixels[y * (width * 3 + 1) + x] = state & 255;
		}
	}
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(pixels)),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

let directory: string;
let png: Buffer;
let jpeg: string;
beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), "pi-thumbnail-worker-"));
	png = validPng(1200, 600);
	// Public API only: produce an actual JPEG fixture through real decoding/encoding.
	const api = await import(moduleUrl);
	const encoded = await api.resizeImage(png, "image/png", {
		maxWidth: 1200,
		maxHeight: 600,
		maxBytes: 2 * 1024 * 1024,
	});
	expect(encoded?.mimeType).toBe("image/jpeg");
	jpeg = encoded.data;
}, 20_000);
afterAll(async () => {
	await rm(directory, { recursive: true, force: true });
});

function processor(url = workerUrl, root = moduleUrl) {
	return createPreviewImageProcessor({ workerUrl: url, resolveModuleUrl: () => root });
}

async function assertRealImages(url: URL) {
	for (const source of [
		{ data: png.toString("base64"), mimeType: "image/png" },
		{ data: jpeg, mimeType: "image/jpeg" },
	]) {
		const original = { ...source };
		const result = await processor(url)(source, signal());
		expect(source).toEqual(original);
		expect(result?.mimeType).toBe("image/png");
		expect(result?.originalDimensions).toEqual({ widthPx: 1200, heightPx: 600 });
		expect(result?.dimensions).toEqual({ widthPx: 960, heightPx: 480 });
		expect(result?.data.length).toBeLessThanOrEqual(4 * 1024 * 1024);
		const bytes = Buffer.from(result?.data ?? "", "base64");
		expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
		expect(bytes.readUInt32BE(16)).toBe(960);
	}
}

describe("isolated public image preview worker", () => {
	it("decodes/resizes real PNG and JPEG in the source layout", async () => {
		await assertRealImages(workerUrl);
	}, 20_000);

	it("decodes a real still WebP and rejects its animated container flag", async () => {
		const data = "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA";
		const result = await processor()({ data, mimeType: "image/webp" }, signal());
		expect(result?.mimeType).toBe("image/png");
		expect(result?.originalDimensions).toEqual({ widthPx: 1, heightPx: 1 });
		const extended = Buffer.alloc(18);
		extended.write("VP8X");
		extended.writeUInt32LE(10, 4);
		extended[8] = 2;
		const bytes = Buffer.from(data, "base64");
		const animated = Buffer.concat([bytes.subarray(0, 12), extended, bytes.subarray(12)]);
		animated.writeUInt32LE(animated.length - 8, 4);
		expect(await processor()({ data: animated.toString("base64"), mimeType: "image/webp" }, signal())).toBeUndefined();
	});

	it("runs the shipped worker in npm packed-source layout", async () => {
		// npm's files allowlist ships extension-src; no private package-layout assumptions.
		const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
		expect(manifest.files).toContain("extension-src");
		const packed = join(directory, "package/extension-src/pi-style/pi/image-preview-worker.mjs");
		await cp(fileURLToPath(workerUrl), packed, { recursive: true });
		await assertRealImages(pathToFileURL(packed));
	}, 20_000);

	it("resolves the public host manifest for alias-only managed installs", async () => {
		const host = join(directory, "host");
		await cp(fileURLToPath(workerUrl), join(host, "unused.mjs"), { recursive: true });
		await writeFile(
			join(host, "package.json"),
			JSON.stringify({ exports: { ".": { types: "./ignored.d.ts", import: "./public.mjs" } } }),
		);
		await writeFile(join(host, "public.mjs"), `export {resizeImage,convertToPng} from ${JSON.stringify(moduleUrl)};`);
		const process = createPreviewImageProcessor({ hostPackageDir: () => host });
		const result = await process({ data: png.toString("base64"), mimeType: "image/png" }, signal());
		expect(result?.dimensions.widthPx).toBe(960);
	}, 20_000);

	it("has no resolution or workers until demand; rejects unavailable roots and worker creation", async () => {
		const resolve = vi.fn(() => {
			throw new Error("alias unavailable");
		});
		const createWorker = vi.fn(() => {
			throw new Error("workers denied");
		});
		const process = createPreviewImageProcessor({ resolveModuleUrl: resolve, createWorker });
		expect(resolve).not.toHaveBeenCalled();
		expect(createWorker).not.toHaveBeenCalled();
		expect(await process({ data: "", mimeType: "image/png" }, signal())).toBeUndefined();
		expect(createWorker).not.toHaveBeenCalled();
		const denied = createPreviewImageProcessor({ resolveModuleUrl: () => moduleUrl, createWorker });
		expect(await denied({ data: "", mimeType: "image/png" }, signal())).toBeUndefined();
	});

	it("rejects malformed, animated, unknown and over-limit inputs before importing codecs", async () => {
		const fake = pathToFileURL(join(directory, "must-not-import.mjs"));
		await writeFile(fake, "throw new Error('must not import');");
		const huge = Buffer.from(png);
		huge.writeUInt32BE(16385, 16);
		const animated = Buffer.concat([png.subarray(0, 33), chunk("acTL", Buffer.alloc(8)), png.subarray(33)]);
		for (const source of [
			{ data: "!!!!", mimeType: "image/png" },
			{ data: png.subarray(0, 32).toString("base64"), mimeType: "image/png" },
			{ data: huge.toString("base64"), mimeType: "image/png" },
			{ data: animated.toString("base64"), mimeType: "image/png" },
			{ data: png.toString("base64"), mimeType: "image/gif" },
			{ data: "AAAA".repeat(7 * 1024 * 1024 + 1), mimeType: "image/png" },
		])
			expect(await processor(workerUrl, fake.href)(source, signal())).toBeUndefined();
	});

	it("validates even small PNGs off-thread and rejects control suffixes, corrupt pixels and APNG", async () => {
		const small = validPng(1, 1);
		const data = small.toString("base64");
		expect((await processor()({ data, mimeType: "image/png" }, signal()))?.dimensions).toEqual({
			widthPx: 1,
			heightPx: 1,
		});
		const corrupt = Buffer.from(small);
		corrupt.fill(0, 41, 41 + corrupt.readUInt32BE(33));
		const animated = Buffer.concat([small.subarray(0, 33), chunk("acTL", Buffer.alloc(8)), small.subarray(33)]);
		for (const payload of [
			`${data}\x1b\\\x1b]52;c;YWJj\x07`,
			small.subarray(0, 24).toString("base64"),
			corrupt.toString("base64"),
			animated.toString("base64"),
		]) {
			expect(await processor()({ data: payload, mimeType: "image/png" }, signal())).toBeUndefined();
		}
	}, 20_000);

	it("handles missing APIs, codec errors, absent workers, and pre-abort", async () => {
		const source = { data: png.toString("base64"), mimeType: "image/png" };
		for (const text of ["export const resizeImage = () => null;", "throw new Error('codec unavailable');"]) {
			const url = pathToFileURL(join(directory, `api-${text.length}.mjs`));
			await writeFile(url, text);
			expect(await processor(workerUrl, url.href)(source, signal())).toBeUndefined();
		}
		expect(await processor(pathToFileURL(join(directory, "absent.mjs")))(source, signal())).toBeUndefined();
		const aborted = new AbortController();
		aborted.abort();
		expect(await processor()(source, aborted.signal)).toBeUndefined();
	});

	it.each(["abort", "timeout", "error", "success"])(
		"waits for termination on %s and prevents overlap",
		async (mode) => {
			let finishTermination: (() => void) | undefined;
			const worker = new EventEmitter() as Worker;
			Object.defineProperty(worker, "threadId", { value: 42 });
			worker.terminate = vi.fn(
				() =>
					new Promise<number>((resolve) => {
						finishTermination = () => {
							worker.emit("exit", 0);
							resolve(0);
						};
					}),
			);
			const createWorker = vi.fn(() => worker);
			const process = createPreviewImageProcessor({
				resolveModuleUrl: () => moduleUrl,
				createWorker,
				timeoutMs: mode === "timeout" ? 5 : 10_000,
			});
			const controller = new AbortController();
			let settled = false;
			const pending = process({ data: "", mimeType: "image/png" }, controller.signal).then((result) => {
				settled = true;
				return result;
			});
			await vi.waitFor(() => expect(createWorker).toHaveBeenCalledOnce());
			if (mode === "abort") controller.abort();
			if (mode === "error") worker.emit("error", new Error("failed"));
			if (mode === "success") worker.emit("message", undefined);
			await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalledOnce());
			expect(settled).toBe(false);
			expect(await process({ data: "", mimeType: "image/png" }, signal())).toBeUndefined();
			expect(createWorker).toHaveBeenCalledOnce();
			finishTermination?.();
			expect(await pending).toBeUndefined();
		},
	);

	it("contains the public synchronous fallback when nested workers are denied", async () => {
		const probe = pathToFileURL(join(directory, "permission-probe.mjs"));
		await writeFile(
			probe,
			`import {Worker} from 'node:worker_threads';
try { new Worker('0',{eval:true}); throw new Error('nested worker unexpectedly allowed'); }
catch(error) { if(error.code !== 'ERR_ACCESS_DENIED') throw error; }
await import(${JSON.stringify(workerUrl.href)});`,
		);
		let outer: Worker | undefined;
		const process = createPreviewImageProcessor({
			workerUrl: probe,
			resolveModuleUrl: () => moduleUrl,
			createWorker: (url, options) =>
				(outer = new Worker(url, {
					...options,
					execArgv: ["--permission", "--allow-fs-read=*"],
				})),
		});
		const result = await process({ data: png.toString("base64"), mimeType: "image/png" }, signal());
		expect(result?.dimensions).toEqual({ widthPx: 960, heightPx: 480 });
		expect(outer?.threadId).toBe(-1);
	}, 20_000);

	it("rejects oversized/invalid normalized output from a public API", async () => {
		for (const [name, output] of [
			["large", { data: "AAAA".repeat(1024 * 1024 + 1), mimeType: "image/png" }],
			["pixels", { data: png.toString("base64"), mimeType: "image/png" }],
			["invalid", { data: "!!!!", mimeType: "image/png" }],
		] as const) {
			const api = pathToFileURL(join(directory, `normalized-${name}.mjs`));
			await writeFile(
				api,
				`export const resizeImage = () => ({}); export const convertToPng = () => (${JSON.stringify(output)});`,
			);
			expect(
				await processor(workerUrl, api.href)({ data: png.toString("base64"), mimeType: "image/png" }, signal()),
			).toBeUndefined();
		}
	});

	it.each(["abort", "timeout"])("bounds stalled root resolution on %s and admits the next demand", async (mode) => {
		let lateRoot: ((url: string) => void) | undefined;
		const root = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise<string>((resolve) => {
						lateRoot = resolve;
					}),
			)
			.mockReturnValue(moduleUrl);
		const createWorker = vi.fn(() => {
			const worker = new EventEmitter() as Worker;
			Object.defineProperty(worker, "threadId", { value: -1 });
			worker.terminate = vi.fn(async () => 0);
			queueMicrotask(() => worker.emit("message", undefined));
			return worker;
		});
		const process = createPreviewImageProcessor({ resolveModuleUrl: root, createWorker, timeoutMs: 20 });
		const controller = new AbortController();
		const pending = process({ data: "", mimeType: "image/png" }, controller.signal);
		await Promise.resolve();
		if (mode === "abort") controller.abort();
		expect(await pending).toBeUndefined();
		expect(createWorker).not.toHaveBeenCalled();
		expect(await process({ data: "", mimeType: "image/png" }, signal())).toBeUndefined();
		expect(createWorker).toHaveBeenCalledOnce();
		lateRoot?.(moduleUrl);
		await Promise.resolve();
		await Promise.resolve();
		expect(createWorker).toHaveBeenCalledOnce();
	});

	it("aborts a real busy outer worker before resolving", async () => {
		const busy = pathToFileURL(join(directory, "busy.mjs"));
		await writeFile(busy, "while(true) {}");
		let worker: Worker | undefined;
		const process = createPreviewImageProcessor({
			workerUrl: busy,
			resolveModuleUrl: () => moduleUrl,
			createWorker: (url, options) => (worker = new Worker(url, options)),
		});
		const controller = new AbortController();
		const pending = process({ data: "", mimeType: "image/png" }, controller.signal);
		await vi.waitFor(() => expect(worker).toBeDefined());
		controller.abort();
		expect(await pending).toBeUndefined();
		expect(worker?.threadId).toBe(-1);
	});
});
