// Display-only image preparation boundary. Original attachments/session data
// are never rewritten; the processor runs outside the render/UI thread.

export interface PreviewImageSource {
	readonly data: string;
	readonly mimeType: string;
}

export interface PreviewImageDimensions {
	readonly widthPx: number;
	readonly heightPx: number;
}

export interface PreparedPreviewImage {
	readonly data: string;
	readonly mimeType: "image/png";
	readonly dimensions: PreviewImageDimensions;
	readonly originalDimensions: PreviewImageDimensions;
}

/** Must settle only after cancellation/worker teardown, before another job starts. */
export type PreviewImageProcessor = (
	source: PreviewImageSource,
	signal: AbortSignal,
) => Promise<PreparedPreviewImage | undefined>;
