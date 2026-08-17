import type { NormalizedPiStyleConfig } from "../../domain/config-types.js";
import { createBuiltinSegments, type SegmentContext, type StatusSnapshot } from "../../domain/status.js";
import { renderStatus } from "../../domain/status-renderer.js";
import { type ResolvedTheme, resolveTheme } from "../../domain/theme.js";
import { visibleWidth } from "../../shared/ansi.js";

export const PRIMARY_WIDGET_KEY = "pi-style.status.primary";
export const SECONDARY_WIDGET_KEY = "pi-style.status.secondary";

type WidgetPlacement = "aboveEditor" | "belowEditor";
type RenderComponent = { render(width: number): string[]; invalidate(): void; dispose?(): void };
type WidgetFactory = (tui: { requestRender?: () => void }, theme: ActivePiTheme) => RenderComponent;

/** Read-only view of Pi's footer data provider, kept out of the domain layer. */
export interface FooterDataProviderView {
	getGitBranch(): string | null;
	getExtensionStatuses(): ReadonlyMap<string, string>;
	onBranchChange(callback: () => void): () => void;
}

type FooterFactory = (
	tui: { requestRender?: (force?: boolean) => void },
	// The footer renders nothing, so the theme is intentionally untyped.
	theme: unknown,
	footerData: FooterDataProviderView,
) => RenderComponent;

/** Minimal structural view of Pi's theme, kept out of the domain layer. */
export interface ActivePiTheme {
	fg?: (token: string, text: string) => string;
	colors?: Record<string, string>;
}

export interface StatusLineWidgetHost {
	setWidget(
		key: string,
		content: string[] | WidgetFactory | undefined,
		options?: { placement?: WidgetPlacement },
	): void;
	/** Replace the native Pi footer with a pi-style owned component; undefined restores it. */
	setFooter(factory: FooterFactory | undefined): void;
}

export interface StatusLineInstallation {
	readonly generation: number;
	readonly primaryKey: typeof PRIMARY_WIDGET_KEY;
	readonly secondaryKey: typeof SECONDARY_WIDGET_KEY;
	update(snapshot: StatusSnapshot): void;
	configure(config: NormalizedPiStyleConfig): void;
	dispose(): void;
}

export interface StatusLineInstallOptions {
	host: StatusLineWidgetHost;
	config: NormalizedPiStyleConfig;
	generation: number;
	initialSnapshot: StatusSnapshot;
	isCurrent?: () => boolean;
	/** Force a full terminal redraw (clear screen + scrollback) on the first footer mount. */
	clearOnStartup?: boolean;
}

interface Ownership {
	token: symbol;
	generation: number;
}

const ownership = new WeakMap<object, Map<string, Ownership>>();
const activeInstallations = new WeakMap<object, Map<number, StatusLineInstallation>>();

function ownerMap(host: object): Map<string, Ownership> {
	let map = ownership.get(host);
	if (!map) {
		map = new Map();
		ownership.set(host, map);
	}
	return map;
}
function installationMap(host: object): Map<number, StatusLineInstallation> {
	let map = activeInstallations.get(host);
	if (!map) {
		map = new Map();
		activeInstallations.set(host, map);
	}
	return map;
}
function safeWidget(
	host: StatusLineWidgetHost,
	key: string,
	content: string[] | WidgetFactory | undefined,
	placement?: WidgetPlacement,
): boolean {
	try {
		host.setWidget(key, content, placement ? { placement } : undefined);
		return true;
	} catch {
		return false;
	}
}
function placementFor(config: NormalizedPiStyleConfig): WidgetPlacement {
	return config.placement === "below" ? "belowEditor" : "aboveEditor";
}
function separatorsFor(config: NormalizedPiStyleConfig, theme: ResolvedTheme): string {
	const style = config.statusLine.separator;
	if (style === "powerline") return theme.apply("separator", theme.glyph("powerlineLeft"));
	if (style === "powerline-thin" || style === "" || style === undefined) {
		return theme.apply("separator", theme.glyph("powerlineThinLeft"));
	}
	if (style === "none") return " ";
	return theme.apply("separator", style);
}

/** Per-(theme, config) derived values shared across status-line renders. */
interface ThemeAssets {
	readonly resolved: ResolvedTheme;
	readonly separator: string;
}
/** Resolved theme + separator keyed by Pi theme identity then config identity; a fresh configure() object misses naturally. */
const themeAssetsCache = new WeakMap<ActivePiTheme, WeakMap<NormalizedPiStyleConfig, ThemeAssets>>();
function themeAssetsFor(activeTheme: ActivePiTheme, config: NormalizedPiStyleConfig): ThemeAssets {
	let byConfig = themeAssetsCache.get(activeTheme);
	if (!byConfig) {
		byConfig = new WeakMap();
		themeAssetsCache.set(activeTheme, byConfig);
	}
	let assets = byConfig.get(config);
	if (!assets) {
		const resolved = resolveTheme(
			activeTheme.colors || activeTheme.fg
				? {
						...(activeTheme.colors ? { colors: activeTheme.colors } : {}),
						// Call through the theme instance so `this` binds correctly inside Pi's fg().
						...(activeTheme.fg ? { fg: (color: string, text: string) => activeTheme.fg?.(color, text) ?? text } : {}),
					}
				: undefined,
			config,
		);
		assets = { resolved, separator: separatorsFor(config, resolved) };
		byConfig.set(config, assets);
	}
	return assets;
}

export function installStatusLine(options: StatusLineInstallOptions): StatusLineInstallation {
	const existing = installationMap(options.host).get(options.generation);
	if (existing) return existing;
	const token = Symbol("pi-style.status-line");
	const owners = ownerMap(options.host);
	let config = options.config;
	let snapshot: StatusSnapshot = options.initialSnapshot;
	let disposed = false;
	let primaryComponent: RenderComponent | undefined;
	let secondaryComponent: RenderComponent | undefined;
	let footerData: FooterDataProviderView | undefined;
	let footerOwner = false;
	let footerUnsubscribe: (() => void) | undefined;
	let clearedOnStartup = false;
	const segments = new Map(createBuiltinSegments());
	for (const item of config.statusLine.customItems) {
		if (!item.id || !item.statusKey) continue;
		segments.set(item.id, {
			id: item.id,
			defaultPriority: item.priority ?? 40,
			overflow: "secondary",
			render: ({ snapshot }: SegmentContext) => {
				const status = snapshot.extensionStatuses?.find(
					(entry: { readonly key: string; readonly value: string }) => entry.key === item.statusKey,
				);
				if (!status) return { visible: false, content: "" };
				return { visible: true, content: `${item.label ? `${item.label}:` : ""}${status.value}`, truncatable: true };
			},
		});
	}

	const render = (activeTheme: ActivePiTheme, width: number, secondary: boolean): string[] => {
		if (width <= 0 || !config.enabled || !config.statusLine.enabled) return [];
		const { resolved, separator } = themeAssetsFor(activeTheme, config);
		const result = renderStatus(config.statusLine.layout, effectiveSnapshot(snapshot), width, {
			separator,
			segments,
			theme: resolved,
			options: {
				...Object.fromEntries(config.statusLine.disabledSegments.map((id) => [id, { disabled: true }])),
				context_bar: { width: config.statusLine.contextBarWidth },
			},
		});
		const lines = secondary ? result.lines.slice(1) : result.lines.slice(0, 1);
		const rendered = lines.filter((line) => visibleWidth(line) <= width);
		if (!secondary && rendered.length > 0 && config.statusLine.bottomMargin > 0) {
			// Blank rows below the primary row keep the status line off the terminal edge.
			return [...rendered, ...Array.from({ length: config.statusLine.bottomMargin }, () => "")];
		}
		return rendered;
	};
	/** Merge authoritative native footer data (branch + extension statuses) into the snapshot. */
	const effectiveSnapshot = (input: StatusSnapshot): StatusSnapshot => {
		if (!footerData) return input;
		const statuses = footerData.getExtensionStatuses();
		const extensionStatuses = statuses.size > 0 ? [...statuses].map(([key, value]) => ({ key, value })) : undefined;
		const branch = footerData.getGitBranch();
		const git = branch && input.git ? { ...input.git, branch } : input.git;
		return {
			...input,
			...(extensionStatuses ? { extensionStatuses } : {}),
			...(git ? { git } : {}),
		};
	};
	const releaseFooterData = (): void => {
		footerUnsubscribe?.();
		footerUnsubscribe = undefined;
		footerData = undefined;
	};
	const footerFactory: FooterFactory = (tui, _theme, data) => {
		footerData = data;
		footerUnsubscribe?.();
		footerUnsubscribe = data.onBranchChange(() => {
			primaryComponent?.invalidate();
			secondaryComponent?.invalidate();
			tui.requestRender?.();
		});
		if (options.clearOnStartup && !clearedOnStartup) {
			clearedOnStartup = true;
			// Force a full redraw on the first frame: clears the screen and scrollback.
			tui.requestRender?.(true);
		}
		return {
			// The native footer is replaced by an empty component; visible status lives in widgets.
			render() {
				return [];
			},
			invalidate() {
				tui.requestRender?.();
			},
			dispose() {
				releaseFooterData();
			},
		};
	};
	const mountFooter = (): void => {
		if (disposed || options.isCurrent?.() === false) return;
		if (!config.enabled || !config.statusLine.enabled) {
			clearFooter();
			return;
		}
		try {
			options.host.setFooter(footerFactory);
			footerOwner = true;
		} catch {
			footerOwner = false;
		}
	};
	const clearFooter = (): void => {
		if (!footerOwner) return;
		footerOwner = false;
		releaseFooterData();
		try {
			options.host.setFooter(undefined);
		} catch {
			// Best-effort restore; cleanup must never throw.
		}
	};
	const factory =
		(secondary: boolean): WidgetFactory =>
		(tui, theme) => {
			const currentTheme = theme;
			// Per-component render cache: Pi repaints widgets on every frame
			// (keystrokes, streaming chunks, tickers). Same width without an
			// invalidate() (snapshot update / configure / footer-branch change)
			// means the previous lines are still current; return them as-is.
			let renderCache: { width: number; lines: string[] } | undefined;
			const component: RenderComponent = {
				render(width) {
					if (renderCache?.width === width) return renderCache.lines;
					const lines = render(currentTheme, width, secondary);
					renderCache = { width, lines };
					return lines;
				},
				invalidate() {
					renderCache = undefined;
					// Pi supplies a fresh theme to the factory on theme replacement. Do not retain
					// pre-rendered ANSI strings; the next render reads the current component theme.
					primaryComponent = secondary ? primaryComponent : component;
					secondaryComponent = secondary ? component : secondaryComponent;
					if (tui.requestRender) tui.requestRender();
				},
				dispose() {},
			};
			if (secondary) secondaryComponent = component;
			else primaryComponent = component;
			return component;
		};
	const claim = (key: string) => owners.set(key, { token, generation: options.generation });
	const mount = () => {
		if (disposed || options.isCurrent?.() === false) return;
		if (!config.enabled || !config.statusLine.enabled) {
			clear(PRIMARY_WIDGET_KEY);
			clear(SECONDARY_WIDGET_KEY);
			clearFooter();
			return;
		}
		if (safeWidget(options.host, PRIMARY_WIDGET_KEY, factory(false), placementFor(config))) claim(PRIMARY_WIDGET_KEY);
		if (safeWidget(options.host, SECONDARY_WIDGET_KEY, factory(true), "belowEditor")) claim(SECONDARY_WIDGET_KEY);
		mountFooter();
	};
	function clear(key: string): void {
		const current = owners.get(key);
		if (current?.token !== token || current.generation !== options.generation) return;
		if (safeWidget(options.host, key, undefined)) owners.delete(key);
	}
	const installation: StatusLineInstallation = {
		generation: options.generation,
		primaryKey: PRIMARY_WIDGET_KEY,
		secondaryKey: SECONDARY_WIDGET_KEY,
		update(next) {
			if (disposed || options.isCurrent?.() === false) return;
			snapshot = next;
			primaryComponent?.invalidate();
			secondaryComponent?.invalidate();
		},
		configure(next) {
			if (disposed || options.isCurrent?.() === false) return;
			const placementChanged = placementFor(next) !== placementFor(config);
			const enabledChanged = next.enabled !== config.enabled || next.statusLine.enabled !== config.statusLine.enabled;
			config = next;
			if (placementChanged || enabledChanged) {
				clear(PRIMARY_WIDGET_KEY);
				clear(SECONDARY_WIDGET_KEY);
				clearFooter();
				primaryComponent = undefined;
				secondaryComponent = undefined;
				mount();
			} else {
				primaryComponent?.invalidate();
				secondaryComponent?.invalidate();
			}
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			clear(PRIMARY_WIDGET_KEY);
			clear(SECONDARY_WIDGET_KEY);
			clearFooter();
			installationMap(options.host).delete(options.generation);
		},
	};
	installationMap(options.host).set(options.generation, installation);
	mount();
	return installation;
}
