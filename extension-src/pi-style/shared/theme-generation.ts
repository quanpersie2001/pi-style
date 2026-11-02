/** Pi 1.5 keeps the theme proxy stable, but replaces its cached colors object
 * on backing-theme replacement (including reload) or terminal-color changes.
 * Older/structural themes without colors retain identity-based caching. */
export function themeGeneration(theme: unknown): object | undefined {
	if (!theme || typeof theme !== "object") return undefined;
	const colors = (theme as { colors?: unknown }).colors;
	return colors && typeof colors === "object" ? colors : theme;
}
