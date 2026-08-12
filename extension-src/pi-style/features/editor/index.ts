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
	const fitted = widthOf(value) > width ? truncateAnsi(value, width, "") : value;
	const current = widthOf(fitted);
	return current < width ? fitted + " ".repeat(width - current) : fitted;
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
	private disposed = false;
	private renderPlanCache: { key: string; plan: RenderPlan } | undefined;

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
