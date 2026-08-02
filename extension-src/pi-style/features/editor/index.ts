import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { type EditorComponent, visibleWidth } from "@earendil-works/pi-tui";
import type { NormalizedPiStyleConfig } from "../../domain/config-types.js";
import { contextPercent, type StatusSnapshot } from "../../domain/status.js";
import type { ResolvedTheme } from "../../domain/theme.js";
import { resolveTheme } from "../../domain/theme.js";
import { truncateAnsi } from "../../shared/ansi.js";

export const EDITOR_DIAGNOSTIC_KEY = "pi-style.editor";
type SetEditorComponent = NonNullable<ExtensionUIContext["setEditorComponent"]>;
type EditorFactory = NonNullable<Parameters<SetEditorComponent>[0]>;
type Tui = Parameters<EditorFactory>[0];
type PiEditorTheme = Parameters<EditorFactory>[1];
type Keybindings = Parameters<EditorFactory>[2];
type EditorHost = Pick<ExtensionUIContext, "setEditorComponent"> & {
	getEditorComponent?: () => EditorFactory | undefined;
	notify?: (message: string, type?: "info" | "warning" | "error") => void;
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
	onSnapshot: (snapshot: StatusSnapshot) => void;
}

const widthOf = visibleWidth;

function widthSafe(value: string, width: number): string {
	if (width <= 0) return "";
	const fitted = widthOf(value) > width ? truncateAnsi(value, width, "") : value;
	const current = widthOf(fitted);
	return current < width ? fitted + " ".repeat(width - current) : fitted;
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
	private readonly onSnapshot: (snapshot: StatusSnapshot) => void;
	private semantic: ResolvedTheme;
	private disposed = false;

	constructor(tui: Tui, theme: PiEditorTheme, keybindings: Keybindings, options: EditorOptions) {
		super(tui, theme, keybindings);
		this.config = options.config;
		this.snapshot = options.snapshot;
		this.piTheme = theme;
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
		const style = this.styleFor(width);
		if (style === "native") return super.render(width).map((line) => widthSafe(line, width));

		const prompt = this.prompt();
		const promptWidth = widthOf(prompt) + 1;
		const padding = this.paddingFor(width, style);
		const innerWidth = Math.max(1, width - promptWidth - padding * 2);
		const nativeLines = super.render(innerWidth);
		if (nativeLines.length === 0) return [];

		const body = nativeLines.slice(1, -1);
		const prefix = `${" ".repeat(padding)}${prompt} `;
		const continuation = " ".repeat(padding + promptWidth);
		const renderedBody = body.map((line, index) => {
			const lead = index === 0 ? prefix : continuation;
			return widthSafe(`${lead}${line}`, width);
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

	private paddingFor(width: number, style: "compact" | "boxed" | "dock" | "native"): number {
		if (width < 50) return 0;
		return style === "boxed" ? 2 : style === "dock" ? 1 : 1;
	}

	private frame(
		width: number,
		style: "compact" | "boxed" | "dock" | "native",
		body: string[],
		metadata: string[],
	): string[] {
		const border = (line: string) => this.piTheme.borderColor(widthSafe(line, width));
		const lineMode = this.config.editor.frame === "line" || this.config.editor.frame === "solid";
		if (style === "compact" || lineMode) {
			return [...body, border("─".repeat(width)), ...metadata];
		}
		if (style === "boxed") {
			const glyph = this.config.editor.frame === "halfblock" ? "▀" : "━";
			return [border(glyph.repeat(width)), ...body, border(glyph.repeat(width)), ...metadata];
		}
		if (this.config.editor.frame === "native") return body;
		return [
			border(`┌${"─".repeat(Math.max(0, width - 2))}┐`),
			...body,
			border(`└${"─".repeat(Math.max(0, width - 2))}┘`),
			...metadata,
		];
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
