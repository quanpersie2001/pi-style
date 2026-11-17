import type { ExtensionAPI, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { registerImagePreviewSurface } from "../features/messages/image-preview.js";
import { createImagePreviewPreparation } from "../features/messages/image-preview-preparation.js";
import type { PreviewImageProcessor } from "../features/messages/image-preview-types.js";
import { createPreviewImageProcessor } from "./image-preview-processor.js";

export const IMAGE_PREVIEW_WIDGET_KEY = "pi-style.image-preview-refresh";

type RepaintPort = { invalidate(): void; requestRender(): void };

/** Owns only public preview UI/repaint hooks, independently of editor/status/core patches. */
export function createImagePreviewRuntime(pi: ExtensionAPI, process?: PreviewImageProcessor) {
	let ui: ExtensionUIContext | undefined;
	let tui: RepaintPort | undefined;
	let enabled = false;
	let generation = 0;
	let binding = 0;
	let pending = false;
	let needsInvalidate = false;
	const repaint = (invalidate = false) => {
		if (!enabled || !tui) return;
		needsInvalidate ||= invalidate;
		if (pending) return;
		pending = true;
		const current = generation;
		queueMicrotask(() => {
			if (current !== generation) return;
			pending = false;
			if (!enabled || !tui) return;
			const rebuild = needsInvalidate;
			needsInvalidate = false;
			if (rebuild) tui.invalidate();
			tui.requestRender();
		});
	};
	const preparation = createImagePreviewPreparation({
		process: process ?? createPreviewImageProcessor(),
		onChange: () => repaint(),
		enabled: false,
	});
	registerImagePreviewSurface(pi, preparation);

	const stop = () => {
		generation++;
		binding++;
		pending = false;
		needsInvalidate = false;
		enabled = false;
		preparation.setEnabled(false);
		tui = undefined;
		const previous = ui;
		ui = undefined;
		try {
			previous?.setWidget(IMAGE_PREVIEW_WIDGET_KEY, undefined);
		} catch {
			// An unavailable UI leaves only metadata, never an active worker owner.
		}
	};
	return {
		stop,
		configure(nextUi: ExtensionUIContext | undefined, nextEnabled: boolean) {
			if (!nextEnabled || !nextUi) {
				const previousTui = tui;
				stop();
				// Live OFF must rebuild zero-line entries as well as clear image rows.
				previousTui?.invalidate();
				previousTui?.requestRender();
				return;
			}
			if (enabled && ui === nextUi) return;
			stop();
			enabled = true;
			ui = nextUi;
			const currentBinding = ++binding;
			try {
				nextUi.setWidget(
					IMAGE_PREVIEW_WIDGET_KEY,
					(host) => {
						if (!enabled || currentBinding !== binding) return { render: () => [], invalidate() {} };
						tui = host;
						preparation.setEnabled(true);
						// Persisted entries may have rendered while unbound or globally OFF.
						repaint(true);
						return {
							render: () => [],
							invalidate() {},
							dispose() {
								if (currentBinding !== binding) return;
								generation++;
								pending = false;
								needsInvalidate = false;
								tui = undefined;
								preparation.setEnabled(false);
							},
						};
					},
					{ placement: "belowEditor" },
				);
			} catch {
				stop();
			}
		},
		reset() {
			generation++;
			pending = false;
			needsInvalidate = false;
			preparation.reset();
			repaint(true);
		},
	};
}
