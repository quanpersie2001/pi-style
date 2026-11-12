import { isAbsolute } from "node:path";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { CachedGitProvider } from "../app/providers.js";
import type { NormalizedPiStyleConfig } from "../domain/config-types.js";
import type { GitCommandRunner } from "../domain/providers.js";
import type { GitSnapshot, StatusSnapshot } from "../domain/status.js";
import { StyledEditor } from "../features/editor/index.js";
import { type ActivePiTheme, renderStatusLine } from "../features/status-line/index.js";

/** Optional, session-scoped integration for editors hosted outside Pi's main input. */
export const DETACHED_EDITOR_KEY = Symbol.for("@quandev104/pi-style:detached-editor");
type EditorArgs = ConstructorParameters<typeof StyledEditor>;
type FullTheme = ExtensionUIContext["theme"];
export type DetachedEditorIdentity = Pick<StatusSnapshot, "sessionName" | "editorBorderColor">;
export interface DetachedEditorRegistry {
	readGit?(cwd: string): Promise<GitSnapshot | undefined>;
	/** Replace child metadata without changing the editor identity or draft. */
	update?(editor: StyledEditor, snapshot: StatusSnapshot): void;
	renderStatus(theme: FullTheme, width: number, snapshot: StatusSnapshot): string[] | undefined;
	create(
		tui: EditorArgs[0],
		theme: FullTheme,
		keybindings: EditorArgs[2],
		identity: DetachedEditorIdentity,
	): StyledEditor | undefined;
}

type Owner = DetachedEditorRegistry;
const owners: Owner[] = [];
const updates = new WeakMap<StyledEditor, (snapshot: StatusSnapshot) => void>();
const globals = globalThis as Record<symbol, unknown>;
let previous: unknown;
const registry: DetachedEditorRegistry = {
	async readGit(cwd) {
		return owners.at(-1)?.readGit?.(cwd);
	},
	update(editor, snapshot) {
		updates.get(editor)?.(snapshot);
	},
	renderStatus(theme, width, snapshot) {
		return owners.at(-1)?.renderStatus(theme, width, snapshot);
	},
	create(tui, theme, keybindings, identity) {
		return owners.at(-1)?.create(tui, theme, keybindings, identity);
	},
};

export function registerDetachedEditor(
	getConfig: () => NormalizedPiStyleConfig,
	options: { gitRunner?: GitCommandRunner } = {},
): {
	configure(config: NormalizedPiStyleConfig): void;
	dispose(): void;
} {
	const editors = new Set<StyledEditor>();
	const git = new CachedGitProvider(options.gitRunner);
	let disposed = false;
	const owner: Owner = {
		async readGit(cwd) {
			const config = getConfig();
			if (disposed || !config.enabled || !config.statusLine.enabled || !isAbsolute(cwd)) return undefined;
			const snapshot = await git.get(cwd);
			const latest = getConfig();
			return disposed || !latest.enabled || !latest.statusLine.enabled ? undefined : snapshot;
		},
		renderStatus(theme, width, snapshot) {
			const config = getConfig();
			if (disposed || !config.enabled || !config.statusLine.enabled) return undefined;
			return renderStatusLine(config, snapshot, theme as unknown as ActivePiTheme, width);
		},
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
			// Replace, rather than merge: unknown/closed child state must clear
			// old native values. Identity remains owned by this detached editor.
			let metadataKey: string | undefined;
			updates.set(editor, (snapshot) => {
				const next = { ...snapshot, sessionName: identity.sessionName, editorBorderColor: identity.editorBorderColor };
				const key = JSON.stringify(next);
				if (key === metadataKey) return;
				metadataKey = key;
				editor.update(next);
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
			git.dispose();
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
