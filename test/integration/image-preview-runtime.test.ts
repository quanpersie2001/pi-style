import { readFile } from "node:fs/promises";
import { InteractiveMode, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, resetCapabilitiesCache, setCapabilities } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IMAGE_PREVIEW_ENTRY_TYPE } from "../../extension-src/pi-style/features/messages/image-preview.js";
import type {
	PreparedPreviewImage,
	PreviewImageProcessor,
} from "../../extension-src/pi-style/features/messages/image-preview-types.js";
import {
	resetMessagesRenderConfig,
	setMessagesRenderConfig,
} from "../../extension-src/pi-style/features/messages/render-config.js";
import { targetSpecs } from "../../extension-src/pi-style/pi/compatibility-probe.js";
import { getCompatibilityRecords } from "../../extension-src/pi-style/pi/compatibility-registry.js";
import {
	createImagePreviewRuntime,
	IMAGE_PREVIEW_WIDGET_KEY,
} from "../../extension-src/pi-style/pi/image-preview-runtime.js";
import { createPiStyleSessionCoordinator } from "../../extension-src/pi-style/pi/session-coordinator.js";
import { stripAnsi } from "../../extension-src/pi-style/shared/ansi.js";
import { FakePiHost } from "../helpers/fake-pi-host.js";

const { CustomEntryComponent } = await import(
	new URL("./modes/interactive/components/custom-entry.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href
);
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const artifact: PreparedPreviewImage = {
	data: PNG,
	mimeType: "image/png",
	dimensions: { widthPx: 1, heightPx: 1 },
	originalDimensions: { widthPx: 2000, heightPx: 1000 },
};
function source() {
	const bytes = Buffer.alloc(24);
	bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
	bytes.writeUInt32BE(2000, 16);
	bytes.writeUInt32BE(1000, 20);
	return { data: bytes.toString("base64"), mimeType: "image/png" };
}
async function settle() {
	for (let i = 0; i < 8; i++) await Promise.resolve();
}
function deferredProcessor() {
	const jobs: Array<{ signal: AbortSignal; resolve(value?: PreparedPreviewImage): void }> = [];
	const process = vi.fn<PreviewImageProcessor>(
		(_source, signal) => new Promise((resolve) => jobs.push({ signal, resolve })),
	);
	return { process, jobs };
}
function nativeEntry(host: FakePiHost, image = source()) {
	const entry = { customType: IMAGE_PREVIEW_ENTRY_TYPE, data: { images: [image] } };
	const renderer = host.registeredEntryRenderers.get(IMAGE_PREVIEW_ENTRY_TYPE);
	return { entry, native: new CustomEntryComponent(entry, renderer) };
}
function admitEntryToNativeChat(host: FakePiHost) {
	const chat = new Container();
	const entry = { customType: IMAGE_PREVIEW_ENTRY_TYPE, data: { images: [source()] } };
	Reflect.apply(
		Reflect.get(InteractiveMode.prototype, "addCustomEntryToChat"),
		{
			session: { extensionRunner: { getEntryRenderer: (type: string) => host.registeredEntryRenderers.get(type) } },
			chatContainer: chat,
			outputPad: 1,
			toolOutputExpanded: false,
		},
		[entry],
	);
	return chat;
}
function mount(host: FakePiHost, native: { invalidate(): void }) {
	const tui = { invalidate: vi.fn(() => native.invalidate()), requestRender: vi.fn() };
	const widget = host.componentFactories.get(IMAGE_PREVIEW_WIDGET_KEY)?.(tui, host.theme);
	expect(widget).toBeDefined();
	expect(widget?.render(100)).toEqual([]);
	return { tui, widget };
}

beforeEach(() => {
	initTheme("dark", false);
	resetMessagesRenderConfig();
	setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
});
afterEach(() => {
	resetMessagesRenderConfig();
	resetCapabilitiesCache();
	for (const spec of targetSpecs) for (const record of getCompatibilityRecords(spec.target)) record.disposer();
});

describe("public thumbnail repaint/lifecycle composition", () => {
	it("connects a real screenshot through the public worker, live entry and repaint port", async () => {
		const bytes = await readFile(new URL("../../assets/demo.png", import.meta.url));
		const image = { data: bytes.toString("base64"), mimeType: "image/png" };
		const original = image.data;
		const host = new FakePiHost();
		const runtime = createImagePreviewRuntime(host.extensionApi);
		const { entry, native } = nativeEntry(host, image);
		try {
			runtime.configure(host.extensionContext.ui, true);
			const { tui } = mount(host, native);
			expect(native.render(100).join("")).not.toContain("\x1b_G");
			await vi.waitFor(() => expect(native.render(100).join("")).toContain("\x1b_G"), {
				timeout: 15_000,
				interval: 25,
			});
			expect(stripAnsi(native.render(100).join("\n"))).toContain(`${bytes.readUInt32BE(16)}×${bytes.readUInt32BE(20)}`);
			expect(tui.requestRender).toHaveBeenCalled();
			expect(entry.data.images[0]?.data).toBe(original);
			expect(host.appendedEntries).toEqual([]);
		} finally {
			runtime.stop();
		}
	}, 20_000);

	it("degrades to metadata when the public widget API is unavailable", async () => {
		const host = new FakePiHost();
		const { process } = deferredProcessor();
		const runtime = createImagePreviewRuntime(host.extensionApi, process);
		const { native } = nativeEntry(host);
		const unavailable = {
			...host.extensionContext.ui,
			setWidget: () => {
				throw new Error("UI unavailable");
			},
		};
		expect(() => runtime.configure(unavailable, true)).not.toThrow();
		expect(native.render(100).join("")).not.toContain("\x1b_G");
		await settle();
		expect(process).not.toHaveBeenCalled();
		expect(() => runtime.stop()).not.toThrow();
	});

	it("hydrates a persisted entry created before bind, then repaints readiness without rebuilding", async () => {
		const host = new FakePiHost();
		const { process, jobs } = deferredProcessor();
		const runtime = createImagePreviewRuntime(host.extensionApi, process);
		const { entry, native } = nativeEntry(host);
		const original = JSON.stringify(entry);
		try {
			expect(native.render(100).join("")).not.toContain("\x1b_G");
			await settle();
			expect(process).not.toHaveBeenCalled();
			runtime.configure(host.extensionContext.ui, true);
			const { tui } = mount(host, native);
			await settle();
			native.render(100);
			await settle();
			expect(process).toHaveBeenCalledTimes(1);
			tui.invalidate.mockClear();
			tui.requestRender.mockClear();
			jobs[0]?.resolve(artifact);
			await settle();
			expect(tui.invalidate).not.toHaveBeenCalled();
			expect(tui.requestRender).toHaveBeenCalledTimes(1);
			const lines = native.render(100);
			expect(lines.join("")).toContain("\x1b_G");
			expect(stripAnsi(lines[1] ?? lines[0] ?? "")).toContain("2000×1000");
			expect(JSON.stringify(entry)).toBe(original);
			expect(host.appendedEntries).toEqual([]);
		} finally {
			runtime.stop();
		}
	});

	it("ignores old completion and stale widget disposal after a new UI binds", async () => {
		const oldHost = new FakePiHost();
		const nextHost = new FakePiHost();
		const { process, jobs } = deferredProcessor();
		const runtime = createImagePreviewRuntime(oldHost.extensionApi, process);
		const { native } = nativeEntry(oldHost);
		try {
			runtime.configure(oldHost.extensionContext.ui, true);
			const old = mount(oldHost, native);
			await settle();
			native.render(100);
			await settle();
			runtime.configure(nextHost.extensionContext.ui, true);
			const next = mount(nextHost, native);
			await settle();
			old.widget?.dispose?.();
			native.render(100);
			await settle();
			expect(jobs[0]?.signal.aborted).toBe(true);
			expect(process).toHaveBeenCalledTimes(1);
			next.tui.requestRender.mockClear();
			jobs[0]?.resolve(artifact);
			await settle();
			expect(next.tui.requestRender).not.toHaveBeenCalled();
			expect(process).toHaveBeenCalledTimes(2);
			jobs[1]?.resolve(artifact);
			await settle();
			expect(next.tui.requestRender).toHaveBeenCalledTimes(1);
			expect(native.render(100).join("")).toContain("\x1b_G");
		} finally {
			runtime.stop();
		}
	});

	it("OFF and tree reset cancel preparation; completion cannot repaint while stopped", async () => {
		const host = new FakePiHost();
		const { process, jobs } = deferredProcessor();
		const runtime = createImagePreviewRuntime(host.extensionApi, process);
		const { native } = nativeEntry(host);
		try {
			runtime.configure(host.extensionContext.ui, true);
			const { tui } = mount(host, native);
			await settle();
			native.render(100);
			await settle();
			runtime.reset();
			expect(jobs[0]?.signal.aborted).toBe(true);
			setMessagesRenderConfig({ showImagePreviews: false });
			runtime.configure(host.extensionContext.ui, false);
			expect(native.render(100)).toEqual([""]); // host spacer only, no preview content
			expect(host.widgets.has(IMAGE_PREVIEW_WIDGET_KEY)).toBe(false);
			tui.requestRender.mockClear();
			jobs[0]?.resolve(artifact);
			await settle();
			expect(tui.requestRender).not.toHaveBeenCalled();
		} finally {
			runtime.stop();
		}
	});
});

function coordinator(host: FakePiHost, process: PreviewImageProcessor, enabled = true) {
	return createPiStyleSessionCoordinator(host.extensionApi, {
		previewProcessor: process,
		filePort: {
			read: async () =>
				JSON.stringify({
					piStyle: {
						enabled,
						compatibility: { allowCorePatches: false },
						statusLine: { enabled: false },
						editor: { enabled: false },
						startup: { enabled: false },
						theme: { autoApply: "off" },
					},
				}),
			writeAtomic: async () => {},
		},
		paths: () => ({ globalPath: "global", projectPath: "project" }),
	});
}

describe("thumbnail session gates", () => {
	it("cannot bind an obsolete session after shutdown during asynchronous config loading", async () => {
		const host = new FakePiHost();
		let finish!: (document: string) => void;
		const document = new Promise<string>((resolve) => {
			finish = resolve;
		});
		const session = createPiStyleSessionCoordinator(host.extensionApi, {
			filePort: { read: () => document, writeAtomic: async () => {} },
			paths: () => ({ globalPath: "global", projectPath: "project" }),
		});
		const start = session.start({ reason: "startup" }, host.extensionContext);
		session.shutdown();
		finish("{}");
		await start;
		await settle();
		expect(host.widgets.has(IMAGE_PREVIEW_WIDGET_KEY)).toBe(false);
		expect(session.app.runtime.current).toBeUndefined();
	});

	it.each(["rpc", "json", "print"] as const)("does not mount or prepare in %s mode", async (mode) => {
		const host = new FakePiHost({ mode });
		const process = vi.fn<PreviewImageProcessor>(async () => artifact);
		const session = coordinator(host, process);
		try {
			await session.start({ reason: "startup" }, host.extensionContext);
			const { native } = nativeEntry(host);
			native.render(100);
			await settle();
			expect(host.widgets.has(IMAGE_PREVIEW_WIDGET_KEY)).toBe(false);
			expect(process).not.toHaveBeenCalled();
		} finally {
			session.shutdown();
		}
	});

	it("works with editor/status disabled, and respects global OFF/ON", async () => {
		const host = new FakePiHost();
		const { process, jobs } = deferredProcessor();
		const session = coordinator(host, process, false);
		try {
			await session.start({ reason: "startup" }, host.extensionContext);
			expect(host.widgets.has(IMAGE_PREVIEW_WIDGET_KEY)).toBe(false);
			// Use Pi's actual admission gate, which drops components without content.
			const chat = admitEntryToNativeChat(host);
			expect(chat.children).toHaveLength(1);
			expect(chat.render(100)).toEqual([""]); // native CustomEntry spacer, no preview content
			session.app.applySession({ enabled: true });
			mount(host, chat);
			await settle();
			chat.render(100);
			await settle();
			expect(process).toHaveBeenCalledTimes(1);
			expect(host.widgets.has("pi-style.status.primary")).toBe(false);
			session.app.applySession({ enabled: false });
			expect(jobs[0]?.signal.aborted).toBe(true);
			expect(host.widgets.has(IMAGE_PREVIEW_WIDGET_KEY)).toBe(false);
		} finally {
			session.shutdown();
		}
	});
});
