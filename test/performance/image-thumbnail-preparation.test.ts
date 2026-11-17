import { Image, resetCapabilitiesCache, setCapabilities } from "@earendil-works/pi-tui";
import { afterEach, assert, expect, it, vi } from "vitest";
import { renderImagePreviewEntry } from "../../extension-src/pi-style/features/messages/image-preview.js";
import { createImagePreviewPreparation } from "../../extension-src/pi-style/features/messages/image-preview-preparation.js";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const theme = { fg: (_token: string, text: string) => text };
afterEach(() => {
	vi.restoreAllMocks();
	resetCapabilitiesCache();
});

it("keeps large original payloads out of initial native work and reuses only encoded thumbnails on repaint", async () => {
	setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
	let finish!: (result: {
		data: string;
		mimeType: "image/png";
		dimensions: { widthPx: number; heightPx: number };
		originalDimensions: { widthPx: number; heightPx: number };
	}) => void;
	const process = vi.fn(
		() =>
			new Promise<Parameters<typeof finish>[0]>((resolve) => {
				finish = resolve;
			}),
	);
	const manager = createImagePreviewPreparation({ enabled: true, process });
	const render = vi.spyOn(Image.prototype, "render");
	const source = Object.freeze({ data: png + "A".repeat(4 * 1024 * 1024), mimeType: "image/png" });
	const component = renderImagePreviewEntry({ data: { images: [source] } }, {}, theme, manager);
	assert(component);
	for (let i = 0; i < 1000; i++) expect(component.render(100).join("")).not.toContain("\x1b_G");
	expect(render).not.toHaveBeenCalled();
	expect(process).not.toHaveBeenCalled();
	await Promise.resolve();
	expect(process).toHaveBeenCalledOnce();
	finish({
		data: png,
		mimeType: "image/png",
		dimensions: { widthPx: 1, heightPx: 1 },
		originalDimensions: { widthPx: 1200, heightPx: 800 },
	});
	await Promise.resolve();
	const first = component.render(100);
	const encoded = render.mock.results.at(-1)?.value;
	for (let i = 0; i < 1000; i++) {
		component.invalidate();
		expect(component.render(100)).toEqual(first);
		expect(render.mock.results.at(-1)?.value).toBe(encoded);
	}
	expect(first[0]).toBe("#1 · 1200×800");
	expect(first.join("").length).toBeLessThan(1000);
	manager.dispose();
});
