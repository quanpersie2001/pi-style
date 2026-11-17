import { Image, resetCapabilitiesCache, setCapabilities, setCellDimensions } from "@earendil-works/pi-tui";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { registerImagePreviewSurface } from "../../extension-src/pi-style/features/messages/image-preview.js";
import {
	createImagePreviewPreparation,
	PREVIEW_LIMITS,
} from "../../extension-src/pi-style/features/messages/image-preview-preparation.js";
import type {
	PreparedPreviewImage,
	PreviewImageSource,
} from "../../extension-src/pi-style/features/messages/image-preview-types.js";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const pngBytes = Buffer.from(png, "base64");
const corruptSmall = Buffer.from(pngBytes);
corruptSmall.fill(0, 41, 54); // Corrupt the IDAT payload while retaining the readable PNG header.
const animatedSmall = Buffer.concat([
	pngBytes.subarray(0, 33),
	Buffer.from("000000086163544c0000000100000000b42de9a0", "hex"), // acTL: one frame, valid chunk CRC.
	pngBytes.subarray(33),
]).toString("base64");
const artifact: PreparedPreviewImage = {
	data: png,
	mimeType: "image/png",
	dimensions: { widthPx: 1, heightPx: 1 },
	originalDimensions: { widthPx: 1200, heightPx: 800 },
};
function required<T>(value: T | undefined): T {
	assert(value !== undefined);
	return value;
}
const theme = { fg: (_token: string, text: string) => text };
const source = (data = "unprocessed-original", mimeType = "image/jpeg"): PreviewImageSource => ({ data, mimeType });
function deferredProcessor() {
	const jobs: { source: PreviewImageSource; signal: AbortSignal; finish: (result?: PreparedPreviewImage) => void }[] =
		[];
	const process = vi.fn(
		(source: PreviewImageSource, signal: AbortSignal) =>
			new Promise<PreparedPreviewImage | undefined>((finish) => jobs.push({ source, signal, finish })),
	);
	return { jobs, process };
}
async function tick() {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}
function kitty() {
	setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
}
afterEach(() => {
	vi.restoreAllMocks();
	resetCapabilitiesCache();
	setCellDimensions({ widthPx: 9, heightPx: 18 });
});

describe("bounded preparation", () => {
	it("defers original nonPNG payload and serializes one active plus eight queued", async () => {
		kitty();
		const fake = deferredProcessor();
		const manager = createImagePreviewPreparation({ enabled: true, process: fake.process });
		const sources = Array.from({ length: 12 }, () => source());
		expect(manager.render(required(sources[0]), 32, theme).lines.join("")).not.toContain("unprocessed");
		expect(fake.process).not.toHaveBeenCalled();
		await tick();
		for (const item of sources.slice(1)) manager.render(item, 32, theme);
		await tick();
		expect(fake.process).toHaveBeenCalledTimes(1);
		for (let i = 0; i < 9; i++) {
			required(fake.jobs[i]).finish();
			await tick();
		}
		expect(fake.process).toHaveBeenCalledTimes(9);
		for (const item of sources) manager.render(item, 32, theme);
		await tick();
		expect(fake.process).toHaveBeenCalledTimes(9);
		manager.dispose();
	});

	it("enforces item and aggregate source reference byte caps", async () => {
		kitty();
		const fake = deferredProcessor();
		const manager = createImagePreviewPreparation({ enabled: true, process: fake.process });
		manager.render(source("x".repeat(Math.ceil(PREVIEW_LIMITS.sourceBytes / 0.75) + 1)), 32, theme);
		const data = "x".repeat(12 * 1024 * 1024);
		for (let i = 0; i < 8; i++) manager.render(source(data), 32, theme);
		await tick();
		required(fake.jobs[0]).finish();
		await tick();
		required(fake.jobs[1]).finish();
		await tick();
		expect(fake.process).toHaveBeenCalledTimes(2); // 2 * 24MiB fits, third exceeds 64MiB.
		manager.dispose();
	});

	it.each(["reset", "off", "dispose"] as const)(
		"%s aborts and waits for teardown; stale results never notify",
		async (action) => {
			kitty();
			const fake = deferredProcessor();
			const onChange = vi.fn();
			const manager = createImagePreviewPreparation({ enabled: true, process: fake.process, onChange });
			const original = source();
			manager.render(original, 32, theme);
			await tick();
			manager.render(source(), 32, theme);
			if (action === "reset") manager.reset();
			else if (action === "off") manager.setEnabled(false);
			else manager.dispose();
			expect(required(fake.jobs[0]).signal.aborted).toBe(true);
			manager.setEnabled(true);
			manager.render(original, 32, theme);
			await tick();
			expect(fake.process).toHaveBeenCalledTimes(1);
			required(fake.jobs[0]).finish(artifact);
			await tick();
			expect(onChange).not.toHaveBeenCalled();
			expect(fake.process).toHaveBeenCalledTimes(action === "dispose" ? 1 : 2);
			fake.jobs[1]?.finish(artifact);
			await tick();
			expect(onChange).toHaveBeenCalledTimes(action === "dispose" ? 0 : 1);
			manager.dispose();
		},
	);

	it("does not launch in inactive, nonimage, or zero-width renders and hydrates later", async () => {
		const fake = deferredProcessor();
		const manager = createImagePreviewPreparation({ process: fake.process });
		const item = source();
		kitty();
		manager.render(item, 32, theme);
		manager.setEnabled(true);
		setCapabilities({ images: null, trueColor: true, hyperlinks: true });
		manager.render(item, 32, theme);
		kitty();
		manager.render(item, 0, theme);
		await tick();
		expect(fake.process).not.toHaveBeenCalled();
		manager.render(item, 32, theme);
		await tick();
		expect(fake.process).toHaveBeenCalledTimes(1);
		manager.dispose();
		required(fake.jobs[0]).finish();
		await tick();
	});

	it("bounds native artifact count, clears evicted components, and never retries evicted demand", async () => {
		kitty();
		const process = vi.fn(async () => artifact);
		const manager = createImagePreviewPreparation({ enabled: true, process });
		const render = vi.spyOn(Image.prototype, "render");
		const sources = Array.from({ length: 17 }, () => source(png, "image/png"));
		for (const item of sources) {
			manager.render(item, 32, theme);
			await tick();
			expect(manager.render(item, 32, theme).lines[0]).toContain("\x1b_G");
		}
		expect(render).toHaveBeenCalledTimes(17);
		for (let i = 0; i < 5; i++)
			expect(manager.render(required(sources[0]), 32, theme).lines[0]).not.toContain("\x1b_G");
		expect(render).toHaveBeenCalledTimes(17);
		manager.reset();
		manager.render(required(sources[0]), 32, theme);
		await tick();
		expect(manager.render(required(sources[0]), 32, theme).lines[0]).toContain("\x1b_G");
		manager.dispose();
	});

	it("bounds ready bytes conservatively even below count cap", async () => {
		kitty();
		const fake = deferredProcessor();
		const manager = createImagePreviewPreparation({ enabled: true, process: fake.process });
		const items = Array.from({ length: 3 }, () => source());
		const large = { ...artifact, data: png.slice(0, 40) + "A".repeat(2 * 1024 * 1024) };
		for (const item of items) {
			manager.render(item, 32, theme);
			await tick();
			required(fake.jobs.at(-1)).finish(large);
			await tick();
		}
		expect(manager.render(required(items[0]), 32, theme).lines.join("")).not.toContain("\x1b_G");
		expect(manager.render(required(items[2]), 32, theme).lines[0]).toContain("\x1b_G");
		expect(fake.process).toHaveBeenCalledTimes(3);
		manager.dispose();
	});

	it.each([
		{ ...artifact, mimeType: "image/jpeg" },
		{ ...artifact, data: "not-png" },
		{ ...artifact, dimensions: { widthPx: 961, heightPx: 1 } },
		{ ...artifact, originalDimensions: { widthPx: 16385, heightPx: 1 } },
		{ ...artifact, data: "A".repeat(PREVIEW_LIMITS.output + 1) },
	])("rejects invalid processor artifacts without retry", async (result) => {
		kitty();
		const fake = deferredProcessor();
		const manager = createImagePreviewPreparation({ enabled: true, process: fake.process });
		const item = source();
		manager.render(item, 32, theme);
		await tick();
		required(fake.jobs[0]).finish(result as PreparedPreviewImage);
		await tick();
		expect(manager.render(item, 32, theme).lines.join("")).not.toContain("\x1b_G");
		await tick();
		expect(fake.process).toHaveBeenCalledTimes(1);
		manager.dispose();
	});

	it("updates a registered live component on completion without rebuilding or mutating sources", async () => {
		kitty();
		const fake = deferredProcessor();
		const onChange = vi.fn();
		const manager = createImagePreviewPreparation({ enabled: true, process: fake.process, onChange });
		let renderer: ((entry: unknown, options: unknown, theme: unknown) => unknown) | undefined;
		registerImagePreviewSurface(
			{
				registerEntryRenderer(_type, fn) {
					renderer = fn;
				},
				appendEntry() {},
			},
			manager,
		);
		const item = Object.freeze(source());
		const entry = Object.freeze({ data: Object.freeze({ images: Object.freeze([item]) }) });
		const component = required(renderer)(entry, {}, theme) as { render(width: number): string[] };
		expect(component.render(100).join("")).not.toContain("\x1b_G");
		await tick();
		required(fake.jobs[0]).finish(artifact);
		await tick();
		expect(onChange).toHaveBeenCalledOnce();
		expect(component.render(100)[0]).toBe("#1 · 1200×800");
		expect(component.render(100)[1]).toContain("\x1b_G");
		expect(item.data).toBe("unprocessed-original");
		manager.dispose();
	});

	it("rechecks terminal capability before dispatch and can hydrate after it returns", async () => {
		kitty();
		const fake = deferredProcessor();
		const manager = createImagePreviewPreparation({ enabled: true, process: fake.process });
		const item = source();
		manager.render(item, 32, theme);
		setCapabilities({ images: null, trueColor: true, hyperlinks: true });
		await tick();
		expect(fake.process).not.toHaveBeenCalled();
		kitty();
		manager.render(item, 32, theme);
		await tick();
		expect(fake.process).toHaveBeenCalledOnce();
		manager.dispose();
		required(fake.jobs[0]).finish();
		await tick();
	});

	it("drops pre-dispatch work on OFF and does not retry processor rejection", async () => {
		kitty();
		const process = vi.fn(async () => {
			throw new Error("unavailable");
		});
		const manager = createImagePreviewPreparation({ enabled: true, process });
		const item = source();
		manager.render(item, 32, theme);
		manager.setEnabled(false);
		await tick();
		expect(process).not.toHaveBeenCalled();
		manager.setEnabled(true);
		manager.render(item, 32, theme);
		await tick();
		for (let i = 0; i < 10; i++) manager.render(item, 32, theme);
		await tick();
		expect(process).toHaveBeenCalledOnce();
		manager.dispose();
	});

	it("refreshes LRU recency without retaining evicted native output", async () => {
		kitty();
		const manager = createImagePreviewPreparation({ enabled: true, process: async () => artifact });
		const items = Array.from({ length: 17 }, () => source(png, "image/png"));
		for (const item of items.slice(0, 16)) {
			manager.render(item, 32, theme);
			await tick();
		}
		manager.render(required(items[0]), 32, theme);
		manager.render(required(items[16]), 32, theme);
		await tick();
		expect(manager.render(required(items[0]), 32, theme).lines[0]).toContain("\x1b_G");
		expect(manager.render(required(items[1]), 32, theme).lines[0]).not.toContain("\x1b_G");
		manager.dispose();
		expect(manager.render(required(items[0]), 32, theme).lines[0]).not.toContain("\x1b_G");
	});

	// Admission tests only: the fake rejects these inputs; real decoder validation belongs to worker integration tests.
	it.each([
		["small PNG", png],
		["truncated PNG", png.slice(0, 40)],
		["corrupt small PNG", corruptSmall.toString("base64")],
		["APNG", animatedSmall],
		["terminal control suffix", `${png}\x1b\\\x1b]52;c;YWJj\x07`],
	])("never directly admits %s without a validated processor artifact", async (_name, data) => {
		kitty();
		const render = vi.spyOn(Image.prototype, "render");
		const item = Object.freeze(source(data, "image/png"));
		const unavailable = createImagePreviewPreparation({ enabled: true });
		const fake = deferredProcessor();
		const manager = createImagePreviewPreparation({ enabled: true, process: fake.process });
		for (const preparation of [unavailable, manager]) {
			const lines = preparation.render(item, 32, theme).lines.join("");
			expect(lines).not.toContain("\x1b");
			expect(lines).not.toContain(data);
		}
		expect(render).not.toHaveBeenCalled();
		await tick();
		expect(fake.process).toHaveBeenCalledOnce();
		required(fake.jobs[0]).finish();
		await tick();
		for (let i = 0; i < 3; i++) expect(manager.render(item, 32, theme).lines.join("")).not.toContain("\x1b");
		expect(render).not.toHaveBeenCalled();
		expect(fake.process).toHaveBeenCalledOnce();
		expect(item.data).toBe(data);
		unavailable.dispose();
		manager.dispose();
	});

	it("admits even a valid small PNG only after processor completion", async () => {
		kitty();
		const fake = deferredProcessor();
		const manager = createImagePreviewPreparation({ enabled: true, process: fake.process });
		const item = source(png, "image/png");
		expect(manager.render(item, 32, theme).lines.join("")).not.toContain("\x1b_G");
		await tick();
		expect(manager.render(item, 32, theme).lines.join("")).not.toContain("\x1b_G");
		required(fake.jobs[0]).finish({ ...artifact, originalDimensions: { widthPx: 1, heightPx: 1 } });
		await tick();
		expect(manager.render(item, 32, theme).lines[0]).toContain("\x1b_G");
		manager.dispose();
	});

	it("sanitizes hostile metadata and never uploads large PNG synchronously", () => {
		kitty();
		const manager = createImagePreviewPreparation({ enabled: true });
		expect(manager.render(source("secret", "image/png\x1b[31m"), 32, theme).lines).toEqual(["[image/unknown]"]);
		const large = source(png + "A".repeat(256 * 1024), "image/png");
		expect(manager.render(large, 32, theme).lines).toEqual(["[image/png 1×1]"]);
		manager.dispose();
	});
});
