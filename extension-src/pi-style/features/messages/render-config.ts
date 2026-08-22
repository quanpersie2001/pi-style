// Per-session render configuration for message-surface features.
//
// Mirrors the tools surface's session-config pattern (features/tools/boxed/
// session-config.ts): set once per session by the compatibility coordinator,
// read inside renderers, and kept out of the render path (no filesystem or
// config reads during render).

export interface MessagesRenderConfig {
	/** Inline previews for user-prompt images (ADR 0008). Gates both the
	 *  stage side (before_agent_start) and the render side (entry renderer). */
	showImagePreviews: boolean;
	/** Clipboard image input (ADR 0009): upgrade built-in paste temp paths to
	 *  real image attachments on submit. Gates the input transform only. */
	clipboardImages: boolean;
	/** Max cell width per preview image (ADR 0008); Ctrl+O expansion uses 60. */
	previewMaxWidth: number;
}

let sessionMessagesConfig: MessagesRenderConfig = {
	showImagePreviews: true,
	clipboardImages: true,
	previewMaxWidth: 30,
};

export function setMessagesRenderConfig(config: Partial<MessagesRenderConfig>): void {
	sessionMessagesConfig = { ...sessionMessagesConfig, ...config };
}

export function getMessagesRenderConfig(): MessagesRenderConfig {
	return sessionMessagesConfig;
}

/** Reset to defaults (test isolation). */
export function resetMessagesRenderConfig(): void {
	sessionMessagesConfig = { showImagePreviews: true, clipboardImages: true, previewMaxWidth: 30 };
}
