import { getCapabilities, getCellDimensions, getImageDimensions, Image, truncateToWidth } from "@earendil-works/pi-tui";
import type {
	PreparedPreviewImage,
	PreviewImageDimensions,
	PreviewImageProcessor,
	PreviewImageSource,
} from "./image-preview-types.js";

export const PREVIEW_LIMITS = {
	queued: 8,
	sourceBytes: 20 * 1024 * 1024,
	sourceReferences: 64 * 1024 * 1024,
	ready: 16,
	readyBytes: 32 * 1024 * 1024,
	output: 4 * 1024 * 1024,
} as const;

type Theme = { fg: (token: string, text: string) => string };
export interface ImagePreviewPreparation {
	setEnabled(enabled: boolean): void;
	reset(): void;
	dispose(): void;
	render(
		source: PreviewImageSource,
		width: number,
		theme: Theme,
	): {
		originalDimensions?: PreviewImageDimensions | undefined;
		lines: string[];
	};
}

/** Prefix-only parsing: never decode an attachment on the UI thread. */
export function previewDimensions(source: PreviewImageSource): PreviewImageDimensions | undefined {
	try {
		const prefix = source.data.slice(0, 256);
		if (source.mimeType === "image/png") {
			const bytes = Buffer.from(prefix, "base64");
			if (
				bytes.length < 24 ||
				bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
				bytes.readUInt32BE(8) !== 13 ||
				bytes.toString("ascii", 12, 16) !== "IHDR"
			)
				return undefined;
		}
		const dims = getImageDimensions(prefix, source.mimeType) ?? undefined;
		return validDimensions(dims, 16384) ? dims : undefined;
	} catch {
		return undefined;
	}
}

function validDimensions(dims: PreviewImageDimensions | undefined, edge: number): dims is PreviewImageDimensions {
	return (
		!!dims &&
		Number.isInteger(dims.widthPx) &&
		Number.isInteger(dims.heightPx) &&
		dims.widthPx > 0 &&
		dims.heightPx > 0 &&
		dims.widthPx <= edge &&
		dims.heightPx <= edge &&
		dims.widthPx * dims.heightPx <= 24_000_000
	);
}

export function previewMetadata(source: PreviewImageSource, theme: Theme, dims = previewDimensions(source)): string[] {
	const mime = /^image\/[a-z0-9.+-]{1,40}$/i.test(source.mimeType) ? source.mimeType : "image/unknown";
	return [theme.fg("toolOutput", `[${mime}${dims ? ` ${dims.widthPx}×${dims.heightPx}` : ""}]`)];
}

interface Slot {
	originalDimensions?: PreviewImageDimensions | undefined;
	component?: Image | undefined;
	bytes: number;
	environment?: string | undefined;
}
interface Job {
	source: PreviewImageSource;
	slot: Slot;
	generation: number;
	bytes: number;
}

export function createImagePreviewPreparation(
	options: { process?: PreviewImageProcessor; onChange?: () => void; enabled?: boolean } = {},
): ImagePreviewPreparation {
	let enabled = options.enabled ?? false;
	let disposed = false;
	let generation = 0;
	let slots = new WeakMap<PreviewImageSource, Slot>();
	const ready = new Set<Slot>();
	let readyBytes = 0;
	let sourceBytes = 0;
	let queue: Job[] = [];
	let active: { job: Job; controller: AbortController } | undefined;
	let scheduled = false;

	function drop(slot: Slot) {
		ready.delete(slot);
		readyBytes -= slot.bytes;
		slot.component = undefined;
		slot.bytes = 0;
		slot.environment = undefined;
	}
	function clear() {
		generation++;
		for (const slot of ready) drop(slot);
		slots = new WeakMap();
		queue = [];
		sourceBytes = active?.job.bytes ?? 0;
		active?.controller.abort();
	}
	function admit(slot: Slot, artifact: PreparedPreviewImage) {
		if (
			artifact.mimeType !== "image/png" ||
			artifact.data.length > PREVIEW_LIMITS.output ||
			!validDimensions(artifact.dimensions, 960) ||
			!validDimensions(artifact.originalDimensions, 16384)
		)
			return;
		const dims = previewDimensions(artifact);
		if (!dims || dims.widthPx !== artifact.dimensions.widthPx || dims.heightPx !== artifact.dimensions.heightPx) return;
		const bytes = 6 * artifact.data.length + 4096;
		if (bytes > PREVIEW_LIMITS.readyBytes) return;
		while (ready.size >= PREVIEW_LIMITS.ready || readyBytes + bytes > PREVIEW_LIMITS.readyBytes) {
			const oldest = ready.values().next().value;
			if (!oldest) break;
			drop(oldest);
		}
		slot.originalDimensions = artifact.originalDimensions;
		slot.component = new Image(artifact.data, "image/png", { fallbackColor: (text) => text }, {}, artifact.dimensions);
		slot.bytes = bytes;
		ready.add(slot);
		readyBytes += bytes;
	}
	function schedule() {
		if (scheduled) return;
		scheduled = true;
		queueMicrotask(() => {
			scheduled = false;
			void pump();
		});
	}
	async function pump() {
		if (active || !enabled || disposed || !options.process) return;
		if (!getCapabilities().images) {
			for (const job of queue) {
				sourceBytes -= job.bytes;
				slots.delete(job.source);
			}
			queue = [];
			return;
		}
		const job = queue.shift();
		if (!job) return;
		const controller = new AbortController();
		active = { job, controller };
		try {
			const result = await options.process(job.source, controller.signal);
			if (result && enabled && !disposed && job.generation === generation && !controller.signal.aborted) {
				admit(job.slot, result);
				options.onChange?.();
			}
		} catch {
			// Unsupported processors and failed decodes remain metadata-only this generation.
		} finally {
			sourceBytes -= job.bytes;
			active = undefined;
			schedule();
		}
	}
	return {
		setEnabled(value) {
			if (disposed || enabled === value) return;
			enabled = value;
			clear();
		},
		reset: clear,
		dispose() {
			disposed = true;
			enabled = false;
			clear();
		},
		render(source, width, theme) {
			let slot = slots.get(source);
			const protocol = getCapabilities().images;
			if (!slot) {
				slot = { originalDimensions: previewDimensions(source), bytes: 0 };
				// Inactive/unbound renders must remain hydratable after binding.
				if (enabled && !disposed && protocol && width > 0) {
					slots.set(source, slot);
					const bytes = source.data.length * 2;
					if (
						options.process &&
						source.data.length * 0.75 <= PREVIEW_LIMITS.sourceBytes &&
						queue.length < PREVIEW_LIMITS.queued &&
						sourceBytes + bytes <= PREVIEW_LIMITS.sourceReferences
					) {
						queue.push({ source, slot, bytes, generation });
						sourceBytes += bytes;
						schedule();
					}
				}
			}
			const cells = getCellDimensions();
			const environment = `${protocol}|${cells.widthPx}|${cells.heightPx}`;
			if (slot.component && slot.environment !== environment) slot.component.invalidate();
			slot.environment = environment;
			let lines: string[];
			if (enabled && !disposed && protocol && slot.component && width > 0) {
				ready.delete(slot);
				ready.add(slot);
				lines = [...slot.component.render(width)];
			} else
				lines =
					width > 0
						? previewMetadata(source, theme, slot.originalDimensions).map((line) => truncateToWidth(line, width))
						: [];
			return { originalDimensions: slot.originalDimensions, lines };
		},
	};
}
