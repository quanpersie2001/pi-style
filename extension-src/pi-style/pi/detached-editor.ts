import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { NormalizedPiStyleConfig } from "../domain/config-types.js";
import type { StatusSnapshot } from "../domain/status.js";
import { StyledEditor } from "../features/editor/index.js";

/** Optional, session-scoped integration for editors hosted outside Pi's main input. */
export const DETACHED_EDITOR_KEY = Symbol.for("@quandev104/pi-style:detached-editor");
type EditorArgs = ConstructorParameters<typeof StyledEditor>;
type FullTheme = ExtensionUIContext["theme"];
export type DetachedEditorIdentity = Pick<StatusSnapshot, "sessionName" | "editorBorderColor">;
export interface DetachedEditorRegistry {
	create(
		tui: EditorArgs[0],
		theme: FullTheme,
		keybindings: EditorArgs[2],
		identity: DetachedEditorIdentity,
	): StyledEditor | undefined;
}

type Owner = { create: DetachedEditorRegistry["create"] };
const owners: Owner[] = [];
const globals = globalThis as Record<symbol, unknown>;
let previous: unknown;
const registry: DetachedEditorRegistry = {
	create(tui, theme, keybindings, identity) {
		return owners.at(-1)?.create(tui, theme, keybindings, identity);
	},
};

export function registerDetachedEditor(getConfig: () => NormalizedPiStyleConfig): {
	configure(config: NormalizedPiStyleConfig): void;
	dispose(): void;
} {
	const editors = new Set<StyledEditor>();
	let disposed = false;
	const owner: Owner = {
		create(tui, theme, keybindings, identity) {
			const config = getConfig();
			if (disposed || !config.enabled || !config.editor.enabled) return undefined;
			// Custom overlay callbacks receive Pi's full Theme, unlike the main
			// setEditorComponent factory, which receives the small EditorTheme.
			const editorTheme: EditorArgs[1] = {
				borderColor: (text) => theme.fg("borderMuted", text),
				selectList: {
					selectedPrefix: (text) => theme.fg("accent", text),
					selectedText: (text) => theme.fg("accent", text),
					description: (text) => theme.fg("muted", text),
					scrollInfo: (text) => theme.fg("muted", text),
					noMatch: (text) => theme.fg("muted", text),
				},
			};
			const editor = new StyledEditor(tui, editorTheme, keybindings, {
				config,
				snapshot: { sessionName: identity.sessionName, editorBorderColor: identity.editorBorderColor },
				theme: editorTheme,
				fullTheme: theme,
				onSnapshot() {},
				onDispose: () => editors.delete(editor),
			});
			editors.add(editor);
			return editor;
		},
	};
	if (owners.length === 0) {
		previous = globals[DETACHED_EDITOR_KEY];
		globals[DETACHED_EDITOR_KEY] = registry;
	}
	owners.push(owner);
	return {
		configure(config) {
			if (disposed) return;
			for (const editor of editors) editor.configure(config);
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			// Existing overlays own their editors until they close. Stop tracking
			// config updates, but do not disable a still-visible composer.
			editors.clear();
			owners.splice(owners.indexOf(owner), 1);
			if (owners.length === 0 && globals[DETACHED_EDITOR_KEY] === registry) {
				if (previous === undefined) delete globals[DETACHED_EDITOR_KEY];
				else globals[DETACHED_EDITOR_KEY] = previous;
				previous = undefined;
			}
		},
	};
}
