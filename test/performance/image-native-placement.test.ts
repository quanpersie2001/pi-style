import { resetCapabilitiesCache, setCapabilities, setCellDimensions, TuiAltScreen } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it } from "vitest";
import { renderImagePreviewEntry } from "../../extension-src/pi-style/features/messages/image-preview.js";
import { createImagePreviewPreparation } from "../../extension-src/pi-style/features/messages/image-preview-preparation.js";
import { resetMessagesRenderConfig } from "../../extension-src/pi-style/features/messages/render-config.js";
import { createFakeTheme } from "../helpers/fake-theme.js";

function screenshot(): string {
	// Header-valid payload: exercises chunking/placement, not terminal PNG decoding.
	const bytes = Buffer.alloc(64 * 1024, 97);
	bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
	bytes.writeUInt32BE(13, 8);
	bytes.write("IHDR", 12);
	bytes.writeUInt32BE(900, 16);
	bytes.writeUInt32BE(800, 20);
	return bytes.toString("base64");
}

// Test-only boundary into Pi 1.5.2's real upload/placement cache. Production
// previews use only public Image components, never mutate the TUI or protocol.
function placements(ui: TuiAltScreen, lines: string[]): string[] {
	return Reflect.apply(Reflect.get(ui, "prepareKittyScreen"), ui, [lines]).lines;
}

afterEach(() => {
	resetMessagesRenderConfig();
	resetCapabilitiesCache();
	setCellDimensions({ widthPx: 9, heightPx: 18 });
});

describe("native fullscreen preview placement cache", () => {
	it.each([2, 3])("does not retain payloads for any of %i images on repeat placement", async (count) => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		setCellDimensions({ widthPx: 9, heightPx: 18 });
		const data = screenshot();
		const entry = { data: { images: Array.from({ length: count }, () => ({ data, mimeType: "image/png" })) } };
		const preview = renderImagePreviewEntry(
			entry,
			{},
			createFakeTheme(),
			createImagePreviewPreparation({
				enabled: true,
				process: async () => ({
					// Trusted fake artifact: tests native chunking, not decoder validation.
					data,
					mimeType: "image/png",
					dimensions: { widthPx: 900, heightPx: 800 },
					originalDimensions: { widthPx: 900, heightPx: 800 },
				}),
			}),
		);
		expect((preview?.render(100) ?? []).join("")).not.toContain("\x1b_G");
		for (let i = 0; i < 16; i++) await Promise.resolve();
		const lines = preview?.render(100) ?? [];
		expect(lines.length).toBeGreaterThan(count);
		const ui = new TuiAltScreen({ columns: 100, rows: 60, write() {} } as never);
		expect(placements(ui, lines).join("").length).toBeGreaterThan(data.length * count);
		for (let i = 0; i < 5; i++) {
			preview?.invalidate();
			const repeat = placements(ui, preview?.render(100) ?? []).join("");
			expect(repeat).not.toContain(data.slice(256, 512));
			expect(repeat.match(/a=p/g)).toHaveLength(count);
			expect(repeat.length).toBeLessThan(1000);
		}
	});
});
