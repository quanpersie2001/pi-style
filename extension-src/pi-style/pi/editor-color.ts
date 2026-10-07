import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export const EDITOR_COLOR_ENTRY_TYPE = "pi-style.editor-color";

/** Only concrete RGB colors are accepted: theme names and terminal escape codes
 * must never make their way into a saved session or a rendered border. */
export function parseEditorColor(input: string): string | undefined {
	const value = input.trim();
	if (/^#[\da-f]{6}$/i.test(value)) return value.toLowerCase();
	if (/^#[\da-f]{3}$/i.test(value))
		return `#${[...value.slice(1)].map((digit) => digit.repeat(2)).join("")}`.toLowerCase();
	return undefined;
}

/** null is an explicit reset, distinct from an absent entry (CLI default). */
export function savedEditorColor(entries: readonly SessionEntry[]): string | null | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry?.type !== "custom" || entry.customType !== EDITOR_COLOR_ENTRY_TYPE) continue;
		const value = (entry.data as { color?: unknown } | undefined)?.color;
		if (value === null) return null;
		if (typeof value === "string") return parseEditorColor(value);
	}
	return undefined;
}
