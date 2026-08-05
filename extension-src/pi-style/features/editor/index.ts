import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { type EditorComponent, visibleWidth } from "@earendil-works/pi-tui";
import type { NormalizedPiStyleConfig } from "../../domain/config-types.js";
import { contextPercent, type StatusSnapshot, type ThinkingLevel } from "../../domain/status.js";
import type { ResolvedTheme } from "../../domain/theme.js";
import { resolveTheme } from "../../domain/theme.js";
import { stripAnsi, truncateAnsi } from "../../shared/ansi.js";

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

interface EditorOptions {
	config: NormalizedPiStyleConfig;
	snapshot: StatusSnapshot;
	theme: PiEditorTheme;
	/** Full Pi theme for thinking-level border colors (optional; falls back to borderColor). */
	fullTheme?: { getThinkingBorderColor?: (level: ThinkingLevel) => (str: string) => string };
	onSnapshot: (snapshot: StatusSnapshot) => void;
}

const widthOf = visibleWidth;

function widthSafe(value: string, width: number): string {
	if (width <= 0) return "";
	const fitted = widthOf(value) > width ? truncateAnsi(value, width, "") : value;
	const current = widthOf(fitted);
	return current < width ? fitted + " ".repeat(width - current) : fitted;
}

function isNativeBorderLine(line: string): boolean {
	const stripped = stripAnsi(line);
	return /^─{2,}$/.test(stripped) || /^─── [↑↓] \d+ more /.test(stripped);
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
	private disposed = false;

	constructor(tui: Tui, theme: PiEditorTheme, keybindings: Keybindings, options: EditorOptions) {
		super(tui, theme, keybindings);
		this.config = options.config;
		this.snapshot = options.snapshot;
		this.piTheme = theme;
		this.fullTheme = options.fullTheme;
		this.onSnapshot = options.onSnapshot;
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
		this.semantic = semanticTheme(this.piTheme, config);
		this.invalidate();
	}

	override handleInput(data: string): void {
		if (this.disposed) return;
		super.handleInput(data);
		this.onSnapshot({ ...this.snapshot });
	}

	override invalidate(): void {
		super.invalidate();
		this.semantic = semanticTheme(this.piTheme, this.config);
		this.tui.requestRender();
	}

	override render(width: number): string[] {
		if (width <= 0) return [];
		const nativeLines = super.render(width);
		const style = this.styleFor(width);
		// Autocomplete (slash menu / @-mentions) restructure: Pi draws the
		// suggestions after its own bottom border, which pushes the below-editor
		// widgets (status line) down. Re-frame the native output so the dropdown
		// lives INSIDE the input box, keeping the footer directly below the input.
		// Native layout: [top border, text lines, bottom border, dropdown lines...].
		if ((this as unknown as { autocompleteState?: unknown }).autocompleteState) {
			const prompt = this.prompt();
			const padding = this.paddingFor(width, style);
			const promptWidth = widthOf(prompt) + 1;
			const prefix = `${" ".repeat(padding)}${prompt} `;
			const continuation = " ".repeat(padding + promptWidth);
			const borderIndex = nativeLines.slice(1).findIndex((line) => isNativeBorderLine(line));
			const split = borderIndex >= 0 ? borderIndex + 1 : nativeLines.length;
			const body = nativeLines.slice(1, split);
			const dropdown = nativeLines.slice(split);
			const border = this.borderFor();
			const kind = this.frameKind(style);
			const renderWidth = width - (kind === "rounded" ? 2 : 0);
			const sideColor = kind === "rounded" ? this.borderColorFor() : undefined;
			const wrap = (line: string) =>
				kind === "rounded" && sideColor ? `${sideColor("│")}${line}${sideColor("│")}` : line;
			const renderedBody = body.map((line, index) =>
				wrap(widthSafe(`${index === 0 ? prefix : continuation}${line}`, renderWidth)),
			);
			const dropdownLines = dropdown.map((line) => wrap(widthSafe(line, renderWidth)));
			if (kind === "rounded") {
				return [
					border(`╭${"─".repeat(Math.max(0, width - 2))}╮`),
					...renderedBody,
					...dropdownLines,
					border(`╰${"─".repeat(Math.max(0, width - 2))}╯`),
				];
			}
			return [border("─".repeat(width)), ...renderedBody, ...dropdownLines, border("─".repeat(width))];
		}
		if (style === "native") return nativeLines.map((line) => widthSafe(line, width));

		const prompt = this.prompt();
		const promptWidth = widthOf(prompt) + 1;
		const padding = this.paddingFor(width, style);
		const kind = this.frameKind(style);
		const sideReserve = kind === "rounded" ? 2 : 0;
		const renderWidth = Math.max(1, width - sideReserve);
		const innerWidth = Math.max(1, renderWidth - promptWidth - padding * 2);
		const innerLines = super.render(innerWidth);
		if (innerLines.length === 0) return [];

		const body = innerLines.slice(1, -1);
		const prefix = `${" ".repeat(padding)}${prompt} `;
		const continuation = " ".repeat(padding + promptWidth);
		const hint = this.config.editor.hint;
		const showHint = hint !== "" && this.getText() === "";
		const renderedBody = body.map((line, index) => {
			const lead = index === 0 ? prefix : continuation;
			let content = `${lead}${line}`;
			// Empty-input hint: the cursor block (first cell of the native empty
			// line) stays at the input position, the dim hint trails it. The native
			// line is pre-padded to renderWidth with literal spaces; drop them from
			// the raw end (safe: no ANSI follows the padding) before appending the
			// hint, or the hint is truncated away by widthSafe. Typing any character
			// makes the text non-empty and the hint disappears.
			if (showHint && index === 0 && line) {
				let end = content.length;
				while (end > 0 && content[end - 1] === " ") end--;
				if (end < content.length) content = content.slice(0, end);
				content += this.semantic.apply("hint", hint);
			}
			return widthSafe(content, renderWidth);
		});
		const metadata = this.metadata(width, style);
		const framed = this.frame(width, style, renderedBody, metadata);
		return framed.map((line) => widthSafe(line, width));
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.invalidate();
	}

	private prompt(): string {
		const configured = this.config.theme.glyphs.prompt;
		if (configured) return configured;
		return this.semantic.mode === "ascii" ? ">" : "❯";
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
