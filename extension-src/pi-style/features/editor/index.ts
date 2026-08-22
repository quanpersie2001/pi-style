import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { type EditorComponent, visibleWidth } from "@earendil-works/pi-tui";
import type { NormalizedPiStyleConfig } from "../../domain/config-types.js";
import { contextPercent, type StatusSnapshot, type ThinkingLevel } from "../../domain/status.js";
import type { ResolvedTheme } from "../../domain/theme.js";
import { resolveTheme } from "../../domain/theme.js";
import { stripAnsi, truncateAnsi } from "../../shared/ansi.js";
import { clipboardMarkerAtEnd, isSingleClipboardImagePath } from "../../shared/clipboard-path.js";

export const EDITOR_DIAGNOSTIC_KEY = "pi-style.editor";
type SetEditorComponent = NonNullable<ExtensionUIContext["setEditorComponent"]>;
type EditorFactory = NonNullable<Parameters<SetEditorComponent>[0]>;
type Tui = Parameters<EditorFactory>[0];
type PiEditorTheme = Parameters<EditorFactory>[1];
type Keybindings = Parameters<EditorFactory>[2];
type EditorHost = Pick<ExtensionUIContext, "setEditorComponent"> & {
	getEditorComponent?: () => EditorFactory | undefined;
	notify?: (message: string, type?: "info" | "warning" | "error") => void;
	/** Full Pi theme; provides thinking-level border colors when available. */
	readonly theme?: { getThinkingBorderColor?: (level: ThinkingLevel) => (str: string) => string };
};

export interface EditorInstallation {
	readonly generation: number;
	readonly installedFactory: EditorFactory;
	readonly previousFactory: EditorFactory | undefined;
	readonly preservedPrevious: boolean;
	update(snapshot: StatusSnapshot): void;
	configure(config: NormalizedPiStyleConfig): void;
	dispose(): void;
}

/** Structural clipboard-image paste surface (ADR 0009) consumed by the
 *  editor. Structural so this feature needs no cross-feature import; the
 *  app layer passes the instance built in features/messages. */
interface ClipboardImagePasteSurface {
	enabled(): boolean;
	clipboardHasImage(): boolean | null;
	markerFromClipboard(): string;
	markerFromArtifact(path: string): Promise<string>;
	isMarkerIndexRegistered(index: number): boolean;
	discardMarkerIndex(index: number): void;
}

interface EditorOptions {
	config: NormalizedPiStyleConfig;
	snapshot: StatusSnapshot;
	theme: PiEditorTheme;
	/** Full Pi theme for thinking-level border colors (optional; falls back to borderColor). */
	fullTheme?: { getThinkingBorderColor?: (level: ThinkingLevel) => (str: string) => string };
	onSnapshot: (snapshot: StatusSnapshot) => void;
	/** Clipboard image paste surface (ADR 0009): instant `[Image #N] ` markers
	 *  at keystroke time, artifact-path fallback, atomic marker backspace.
	 *  Undefined keeps native behavior entirely. */
	clipboardImagePaste?: ClipboardImagePasteSurface;
}

/** Pi-tui Editor internals mirrored for O(1) atomic marker surgery. All are
 *  runtime-present on the Editor prototype chain but TS-private; the typed
 *  cast follows the autocompleteState-access pattern used in render(). */
interface EditorInternals {
	readonly state: { lines: string[]; cursorLine: number; cursorCol: number };
	lastAction: string | null;
	readonly onChange?: (text: string) => void;
	exitHistoryBrowsing(): void;
	setCursorCol(col: number): void;
	cancelAutocomplete(): void;
}

interface RenderPlan {
	readonly style: "compact" | "boxed" | "dock" | "native";
	readonly kind: "compact" | "boxed" | "outline" | "rounded" | "native";
	readonly prompt: string;
	readonly promptWidth: number;
	readonly padding: number;
	readonly sideReserve: number;
	readonly renderWidth: number;
	readonly innerWidth: number;
	readonly prefix: string;
	readonly continuation: string;
}

const widthOf = visibleWidth;

function widthSafe(value: string, width: number): string {
	if (width <= 0) return "";
	const measured = widthOf(value);
	if (measured > width) {
		const fitted = truncateAnsi(value, width, "");
		const current = widthOf(fitted);
		return current < width ? fitted + " ".repeat(width - current) : fitted;
	}
	return measured < width ? value + " ".repeat(width - measured) : value;
}

function isNativeBorderLine(line: string): boolean {
	const stripped = stripAnsi(line);
	return /^─{2,}$/.test(stripped) || /^─── [↑↓] \d+ more /.test(stripped);
}

/**
 * Remove `count` leading visible characters from an ANSI-rendered editor line,
 * preserving escape sequences (CSI/OSC/APC/DCS) verbatim. Used to hide the
 * bash-mode `!` prefix; the CURSOR_MARKER and cursor-block sequences pass
 * through unchanged so hardware-cursor placement stays aligned.
 */
function stripLeadingVisibleChars(line: string, count: number): string {
	if (count <= 0 || line.length === 0) return line;
	let output = "";
	let stripped = 0;
	let index = 0;
	while (index < line.length) {
		const char = line[index] ?? "";
		if (char === "\x1b") {
			const start = index;
			index++;
			const intro = line[index];
			if (intro === "[") {
				index++;
				while (index < line.length) {
					const byte = line[index] ?? "";
					index++;
					if (byte >= "@" && byte <= "~") break;
				}
			} else if (intro === "]" || intro === "_" || intro === "^" || intro === "P") {
				index++;
				while (index < line.length) {
					const byte = line[index] ?? "";
					if (byte === "\x1b" && line[index + 1] === "\\") {
						index += 2;
						break;
					}
					index++;
					if (byte === "\x07") break;
				}
			} else if (intro !== undefined) {
				index++;
			}
			output += line.slice(start, index);
			continue;
		}
		if (stripped < count) {
			stripped++;
			index++;
			continue;
		}
		output += char;
		index++;
	}
	return output;
}

function semanticTheme(theme: PiEditorTheme, config: NormalizedPiStyleConfig): ResolvedTheme {
	const editorTheme = theme;
	return resolveTheme(
		{
			fg: (token) => {
				if (token === "borderActive" || token.startsWith("thinking")) return editorTheme.borderColor("");
				return "";
			},
		},
		config,
	);
}

/**
 * A thin CustomEditor treatment: all text, cursor, paste, autocomplete, history,
 * and keybinding state remains owned by Pi's editor implementation.
 */
export class StyledEditor extends CustomEditor implements EditorComponent {
	private config: NormalizedPiStyleConfig;
	private snapshot: StatusSnapshot;
	private readonly piTheme: PiEditorTheme;
	private readonly fullTheme: EditorOptions["fullTheme"];
	private readonly onSnapshot: (snapshot: StatusSnapshot) => void;
	private semantic: ResolvedTheme;
	/** Set when config changes; invalidate() then rebuilds the (otherwise stable) semantic theme. */
	private semanticDirty = false;
	private disposed = false;
	private renderPlanCache: { key: string; plan: RenderPlan } | undefined;
	private readonly clipboardImagePaste: ClipboardImagePasteSurface | undefined;
	/** Keybinding matcher (the factory's KeybindingsManager) for keystroke-level
	 *  interception: the paste keybinding and backspace checks below. */
	private readonly editorKeybindings: { matches(data: string, keybinding: string): boolean };

	constructor(tui: Tui, theme: PiEditorTheme, keybindings: Keybindings, options: EditorOptions) {
		super(tui, theme, keybindings);
		this.config = options.config;
		this.snapshot = options.snapshot;
		this.piTheme = theme;
		this.fullTheme = options.fullTheme;
		this.onSnapshot = options.onSnapshot;
		this.clipboardImagePaste = options.clipboardImagePaste;
		this.editorKeybindings = keybindings as unknown as { matches(data: string, keybinding: string): boolean };
		this.semantic = semanticTheme(theme, options.config);
		this.setPaddingX(0);
	}

	update(snapshot: StatusSnapshot): void {
		if (this.disposed) return;
		this.snapshot = snapshot;
		this.invalidate();
	}

	configure(config: NormalizedPiStyleConfig): void {
		if (this.disposed) return;
		this.config = config;
		this.semanticDirty = true;
		this.invalidate();
	}

	override handleInput(data: string): void {
		if (this.disposed) return;
		if (this.handleClipboardImagePasteKeystroke(data)) return;
		if (this.handleAtomicMarkerBackspace(data)) return;
		super.handleInput(data);
		this.onSnapshot({ ...this.snapshot });
	}

	/**
	 * Instant marker (ADR 0009): when the built-in paste keybinding fires, the
	 * clipboard holds an image (sync native probe), and the surface is enabled,
	 * the keystroke is owned here — an `[Image #N] ` marker is inserted
	 * immediately (zero-latency feedback) and the bytes fill the registry
	 * entry asynchronously. Pi's own paste handler never runs for this
	 * keystroke, so no temp artifact is written. Text pastes (no image) and
	 * probe-unavailable hosts fall through to the native path untouched.
	 */
	private handleClipboardImagePasteKeystroke(data: string): boolean {
		const surface = this.clipboardImagePaste;
		if (!surface?.enabled()) return false;
		if (!this.editorKeybindings.matches(data, "app.clipboard.pasteImage")) return false;
		if (surface.clipboardHasImage() !== true) return false;
		super.insertTextAtCursor(surface.markerFromClipboard());
		this.onSnapshot({ ...this.snapshot });
		return true;
	}

	/**
	 * Atomic marker backspace (ADR 0009): backspacing directly after a
	 * registered `[Image #N] ` marker deletes the whole marker as one unit —
	 * the image is discarded (image-paste semantics). Direct state surgery
	 * (O(1)) mirroring pi-tui's handleBackspace mutation protocol: no setText
	 * round-trip (it clears the pastes registry, and undo snapshots store that
	 * Map by reference — silently breaking `[paste #N]` atomicity on undo) and
	 * no per-column left-arrow inputs (O(K·L) through the keybinding chain and
	 * visual line maps). No undo snapshot is pushed: the discarded image
	 * cannot be restored, so the deletion is intentionally non-undoable.
	 */
	private handleAtomicMarkerBackspace(data: string): boolean {
		const surface = this.clipboardImagePaste;
		if (!surface?.enabled()) return false;
		const isBackspace = this.editorKeybindings.matches(data, "tui.editor.deleteCharBackward") || data === "\x7f";
		if (!isBackspace) return false;
		const lines = this.getLines();
		const cursor = this.getCursor();
		const current = lines[cursor.line];
		if (current === undefined) return false;
		const before = current.slice(0, cursor.col);
		const hit = clipboardMarkerAtEnd(before);
		if (!hit || !surface.isMarkerIndexRegistered(hit.index)) return false;
		const editor = this as unknown as EditorInternals;
		const targetCol = cursor.col - hit.length;
		editor.exitHistoryBrowsing();
		editor.lastAction = null;
		editor.cancelAutocomplete();
		// Splice the marker out of its line in place (deletion never removes a
		// line, so cursorLine is unchanged). setCursorCol also clears
		// preferredVisualCol/snappedFromCursorCol. scrollOffset is left alone;
		// render() re-clamps it to keep the cursor visible.
		editor.state.lines[cursor.line] = current.slice(0, targetCol) + current.slice(cursor.col);
		editor.setCursorCol(targetCol);
		editor.onChange?.(this.getText());
		surface.discardMarkerIndex(hit.index);
		this.invalidate();
		this.onSnapshot({ ...this.snapshot });
		return true;
	}

	/**
	 * Artifact-path fallback (ADR 0009): when the keystroke was not owned
	 * (probe unavailable, native editor path, config toggled) Pi's built-in
	 * paste still inserts a `<tmpdir>/pi-clipboard-<uuid>.<ext>` path through
	 * this method. Convert it to a marker when the artifact reads successfully;
	 * every failure inserts the original text verbatim (exact native behavior).
	 */
	override insertTextAtCursor(text: string): void {
		const surface = this.clipboardImagePaste;
		if (!surface?.enabled() || !isSingleClipboardImagePath(text)) {
			super.insertTextAtCursor(text);
			return;
		}
		void (async () => {
			let replacement = text;
			try {
				replacement = await surface.markerFromArtifact(text);
			} catch {
				// Unreadable artifact or surface failure: keep native behavior.
			}
			super.insertTextAtCursor(replacement);
			// The caller (Pi's handleClipboardPaste) requested its render before
			// this async insert completed — without a repaint the marker stays
			// invisible until the next keystroke. Request one now.
			this.tui.requestRender();
		})();
	}

	override invalidate(): void {
		super.invalidate();
		// The semantic theme is derived from (piTheme, config); piTheme is fixed per
		// instance and config changes go through configure(), so keystroke-driven
		// invalidations reuse the cached instance instead of rebuilding it.
		if (this.semanticDirty) {
			this.semantic = semanticTheme(this.piTheme, this.config);
			this.semanticDirty = false;
		}
		this.renderPlanCache = undefined;
		this.tui.requestRender();
	}

	override render(width: number): string[] {
		if (width <= 0) return [];
		const plan = this.renderPlan(width);
		const autocompleteState = (this as unknown as { autocompleteState?: unknown }).autocompleteState;
		if (plan.style === "native") return super.render(width).map((line) => widthSafe(line, width));
		if (autocompleteState) return this.renderAutocompleteFrame(width, plan);

		const innerLines = super.render(plan.innerWidth);
		if (innerLines.length === 0) return [];
		const body = innerLines.slice(1, -1);
		const hint = this.config.editor.hint;
		const showHint = hint !== "" && this.getText() === "";
		const bashHidden = this.bashHiddenCount();
		const renderedBody = body.map((line, index) => {
			const lead = index === 0 ? plan.prefix : plan.continuation;
			const source = index === 0 && bashHidden > 0 ? stripLeadingVisibleChars(line, bashHidden) : line;
			let content = `${lead}${source}`;
			if (showHint && index === 0 && line) {
				let end = content.length;
				while (end > 0 && content[end - 1] === " ") end--;
				if (end < content.length) content = content.slice(0, end);
				content += this.semantic.apply("hint", hint);
			}
			return widthSafe(content, plan.renderWidth);
		});
		const metadata = this.metadata(width, plan.style);
		const framed = this.frame(width, plan.style, renderedBody, metadata);
		return framed.map((line) => widthSafe(line, width));
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.invalidate();
	}

	private renderPlan(width: number): RenderPlan {
		const style = this.styleFor(width);
		const prompt = this.prompt();
		const kind = this.frameKind(style);
		const key = `${width}:${style}:${kind}:${prompt}`;
		if (this.renderPlanCache?.key === key) return this.renderPlanCache.plan;
		const promptWidth = widthOf(prompt) + 1;
		const padding = this.paddingFor(width, style);
		const sideReserve = kind === "rounded" ? 2 : 0;
		const renderWidth = Math.max(1, width - sideReserve);
		const innerWidth = Math.max(1, renderWidth - promptWidth - padding * 2);
		const prefix = `${" ".repeat(padding)}${prompt} `;
		const continuation = " ".repeat(padding + promptWidth);
		const plan = {
			style,
			kind,
			prompt,
			promptWidth,
			padding,
			sideReserve,
			renderWidth,
			innerWidth,
			prefix,
			continuation,
		};
		this.renderPlanCache = { key, plan };
		return plan;
	}

	private renderAutocompleteFrame(width: number, plan: RenderPlan): string[] {
		const nativeLines = super.render(width);
		const borderIndex = nativeLines.slice(1).findIndex((line) => isNativeBorderLine(line));
		const split = borderIndex >= 0 ? borderIndex + 1 : nativeLines.length;
		const body = nativeLines.slice(1, split);
		const dropdown = nativeLines.slice(split);
		const border = this.borderFor();
		const sideColor = plan.kind === "rounded" ? this.borderColorFor() : undefined;
		const wrap = (line: string) =>
			plan.kind === "rounded" && sideColor ? `${sideColor("│")}${line}${sideColor("│")}` : line;
		const bashHidden = this.bashHiddenCount();
		const renderedBody = body.map((line, index) => {
			const source = index === 0 && bashHidden > 0 ? stripLeadingVisibleChars(line, bashHidden) : line;
			return wrap(widthSafe(`${index === 0 ? plan.prefix : plan.continuation}${source}`, plan.renderWidth));
		});
		const dropdownLines = dropdown.map((line) => wrap(widthSafe(line, plan.renderWidth)));
		if (plan.kind === "rounded") {
			return [
				border(`╭${"─".repeat(Math.max(0, width - 2))}╮`),
				...renderedBody,
				...dropdownLines,
				border(`╰${"─".repeat(Math.max(0, width - 2))}╯`),
			];
		}
		return [border("─".repeat(width)), ...renderedBody, ...dropdownLines, border("─".repeat(width))];
	}

	private prompt(): string {
		if (this.isBashMode()) {
			// Bash mode (`!` prefix): the prompt glyph becomes the bash icon and the
			// leading `!` is hidden from the input text. The glyph takes the live
			// border color (pi sets editor.borderColor to the bashMode color).
			const glyph = this.semantic.glyph("bashPrompt");
			return this.borderColor(glyph);
		}
		const configured = this.config.theme.glyphs.prompt;
		if (configured) return configured;
		return this.semantic.mode === "ascii" ? ">" : "❯";
	}

	/** Pi's bash mode: the input starts with `!` after optional whitespace. */
	private isBashMode(): boolean {
		return this.getText().trimStart().startsWith("!");
	}

	/**
	 * Number of leading `!` characters to hide from the displayed input while
	 * bash mode is active. Characters under the cursor are never hidden, so the
	 * native cursor block stays visible when the cursor sits on a `!`.
	 */
	private bashHiddenCount(): number {
		const text = this.getText();
		let index = 0;
		while (index < text.length && (text[index] === " " || text[index] === "\t")) index++;
		const runStart = index;
		while (index < text.length && text[index] === "!") index++;
		const run = index - runStart;
		if (run === 0) return 0;
		const cursor = this.getCursor();
		const position = cursor.line === 0 ? cursor.col : Number.POSITIVE_INFINITY;
		return Math.min(run, Math.max(0, position - runStart));
	}

	private styleFor(width: number): "compact" | "boxed" | "dock" | "native" {
		if (width < 20) return "native";
		if (["compact", "boxed", "dock", "native"].includes(this.config.editor.style)) {
			if (this.config.editor.style === "native") return "native";
			if (width < 40 && this.config.editor.style !== "compact") return "compact";
			return this.config.editor.style as "compact" | "boxed" | "dock";
		}
		return "compact";
	}

	/**
	 * Resolve the frame treatment for a style: horizontal bars for compact,
	 * full-width bars for boxed, an outlined box for dock, and a rounded box
	 * with side borders (`╭─╮ │ │ ╰─╯`) for `frame: "rounded"`.
	 */
	private frameKind(
		style: "compact" | "boxed" | "dock" | "native",
	): "compact" | "boxed" | "outline" | "rounded" | "native" {
		const frame = this.config.editor.frame;
		if (style === "compact" || frame === "line" || frame === "solid") return "compact";
		if (style === "boxed") return "boxed";
		if (frame === "native") return "native";
		if (frame === "rounded") return "rounded";
		return "outline";
	}

	private paddingFor(width: number, style: "compact" | "boxed" | "dock" | "native"): number {
		if (width < 50) return 0;
		return style === "boxed" ? 2 : style === "dock" ? 1 : 1;
	}

	private borderFor(): (line: string) => string {
		return (line: string) => this.borderColorFor()(line);
	}

	/** Raw border color function (thinking-synced) WITHOUT full-width padding, for single glyphs. */
	private borderColorFor(): (line: string) => string {
		// While bash mode is active pi keeps editor.borderColor set to the
		// bashMode color (its native updateEditorBorderColor path); prefer it over
		// the thinking-level color so the whole frame switches to the bash color.
		if (this.isBashMode()) return this.borderColor;
		const level = this.snapshot.thinkingLevel;
		const thinking = this.fullTheme?.getThinkingBorderColor?.(level ?? "off");
		return thinking ?? this.piTheme.borderColor;
	}

	private frame(
		width: number,
		style: "compact" | "boxed" | "dock" | "native",
		body: string[],
		metadata: string[],
	): string[] {
		const border = this.borderFor();
		const kind = this.frameKind(style);
		if (kind === "compact") {
			// Match Pi's native editor: a horizontal border above and below the input.
			return [border("─".repeat(width)), ...body, border("─".repeat(width)), ...metadata];
		}
		if (kind === "boxed") {
			const glyph = this.config.editor.frame === "halfblock" ? "▀" : "━";
			return [border(glyph.repeat(width)), ...body, border(glyph.repeat(width)), ...metadata];
		}
		if (kind === "native") return body;
		const inner = Math.max(0, width - 2);
		if (kind === "rounded") {
			// Rounded box with vertical side borders: `╭─╮ / │ text │ / ╰─╯`.
			// Body lines were rendered at width - 2; re-fit defensively, then wrap.
			// Side glyphs use the raw border color (no full-width padding, unlike border()).
			const sideColor = this.borderColorFor();
			const side = (line: string) => `${sideColor("│")}${widthSafe(line, inner)}${sideColor("│")}`;
			return [border(`╭${"─".repeat(inner)}╮`), ...body.map(side), border(`╰${"─".repeat(inner)}╯`), ...metadata];
		}
		return [border(`┌${"─".repeat(inner)}┐`), ...body, border(`└${"─".repeat(inner)}┘`), ...metadata];
	}

	private metadata(width: number, style: "compact" | "boxed" | "dock" | "native"): string[] {
		if (!this.config.editor.showMetadata || width < 60) return [];
		const percent = contextPercent(this.snapshot.context ?? {});
		if (percent === undefined) return [];
		const label = `ctx ${Math.round(percent)}%`;
		return [this.piTheme.borderColor(` ${style === "boxed" ? "· " : ""}${label}`)];
	}
}

export function installEditor(options: {
	host: EditorHost;
	config: NormalizedPiStyleConfig;
	generation: number;
	initialSnapshot: StatusSnapshot;
	isCurrent?: () => boolean;
	clipboardImagePaste?: EditorOptions["clipboardImagePaste"];
}): EditorInstallation | undefined {
	if (!options.host.setEditorComponent) return undefined;
	const previous = options.host.getEditorComponent?.();
	if (previous && options.config.compatibility.preferExistingEditor) {
		return {
			generation: options.generation,
			installedFactory: previous,
			previousFactory: previous,
			preservedPrevious: true,
			update() {},
			configure() {},
			dispose() {},
		};
	}
	let config = options.config;
	let snapshot = options.initialSnapshot;
	let disposed = false;
	const components = new Set<StyledEditor>();
	const factory = ((tui: Tui, theme: PiEditorTheme, keybindings: Keybindings) => {
		const editor = new StyledEditor(tui, theme, keybindings, {
			config,
			snapshot,
			theme,
			...(options.host.theme ? { fullTheme: options.host.theme } : {}),
			...(options.clipboardImagePaste ? { clipboardImagePaste: options.clipboardImagePaste } : {}),
			onSnapshot: (next) => {
				if (!disposed && options.isCurrent?.() !== false) snapshot = next;
			},
		});
		components.add(editor);
		return editor;
	}) as EditorFactory;
	try {
		options.host.setEditorComponent(factory);
	} catch {
		options.host.notify?.("pi-style editor unavailable; keeping the native editor", "warning");
		return undefined;
	}
	return {
		generation: options.generation,
		installedFactory: factory,
		previousFactory: previous,
		preservedPrevious: false,
		update(next) {
			if (disposed || options.isCurrent?.() === false) return;
			snapshot = next;
			for (const component of components) component.update(next);
		},
		configure(next) {
			if (disposed || options.isCurrent?.() === false) return;
			config = next;
			for (const component of components) component.configure(next);
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const component of components) component.dispose();
			components.clear();
			if (options.host.getEditorComponent?.() === factory) {
				options.host.setEditorComponent(previous);
			}
		},
	};
}
