import type { NormalizedPiStyleConfig } from "../../domain/config-types.js";
import { createBuiltinSegments, type SegmentContext, type StatusSnapshot } from "../../domain/status.js";
import { renderStatus } from "../../domain/status-renderer.js";
import { type ResolvedTheme, resolveTheme, themeGeneration } from "../../domain/theme.js";
import { visibleWidth } from "../../shared/ansi.js";

export const PRIMARY_WIDGET_KEY = "pi-style.status.primary";
export const SECONDARY_WIDGET_KEY = "pi-style.status.secondary";

// Optional main-UI bridge: consumers notify after inserting a below-editor
// widget. Only the active installation may reinsert its own status rows.
const ORDER_KEY = Symbol.for("@quandev104/pi-style:status-widget-order");
const globals = globalThis as Record<symbol, unknown>;
const FOOTER_OWNER_KEY = "pi-style.footer";

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
	colors?: Readonly<Record<string, unknown>>;
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
const activeOwners = new WeakMap<object, symbol>();

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
/** Assets follow the backing theme, not Pi's stable proxy. */
const themeAssetsCache = new WeakMap<object, WeakMap<NormalizedPiStyleConfig, ThemeAssets>>();
function themeAssetsFor(activeTheme: ActivePiTheme, config: NormalizedPiStyleConfig): ThemeAssets {
	const generation = themeGeneration(activeTheme) ?? activeTheme;
	let byConfig = themeAssetsCache.get(generation);
	if (!byConfig) {
		byConfig = new WeakMap();
		themeAssetsCache.set(generation, byConfig);
	}
	let assets = byConfig.get(config);
	if (!assets) {
		const resolved = resolveTheme(activeTheme, config);
		assets = { resolved, separator: separatorsFor(config, resolved) };
		byConfig.set(config, assets);
	}
	return assets;
}

function statusSegments(config: NormalizedPiStyleConfig) {
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

	return segments;
}

export function renderStatusLine(
	config: NormalizedPiStyleConfig,
	snapshot: StatusSnapshot,
	activeTheme: ActivePiTheme,
	width: number,
	segments = statusSegments(config),
): string[] {
	if (width <= 0 || !config.enabled || !config.statusLine.enabled) return [];
	const { resolved, separator } = themeAssetsFor(activeTheme, config);
	return [
		...renderStatus(config.statusLine.layout, snapshot, width, {
			separator,
			segments,
			theme: resolved,
			options: {
				...Object.fromEntries(config.statusLine.disabledSegments.map((id) => [id, { disabled: true }])),
				context_bar: { width: config.statusLine.contextBarWidth },
			},
		}).lines,
	];
}

export function installStatusLine(options: StatusLineInstallOptions): StatusLineInstallation {
	const existing = installationMap(options.host).get(options.generation);
	if (existing) return existing;
	const token = Symbol("pi-style.status-line");
	activeOwners.set(options.host, token);
	const isCurrent = () => !disposed && activeOwners.get(options.host) === token && options.isCurrent?.() !== false;
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
	let segments = statusSegments(config);

	const render = (
		activeTheme: ActivePiTheme,
		width: number,
		secondary: boolean,
		statuses: ReadonlyMap<string, string> | undefined,
	): string[] => {
		if (width <= 0 || !config.enabled || !config.statusLine.enabled) return [];
		const result = renderStatusLine(config, effectiveSnapshot(snapshot, statuses), activeTheme, width, segments);
		const lines = secondary ? result.slice(1) : result.slice(0, 1);
		const rendered = lines.filter((line) => visibleWidth(line) <= width);
		if (!secondary && rendered.length > 0 && config.statusLine.bottomMargin > 0) {
			// Blank rows below the primary row keep the status line off the terminal edge.
			return [...rendered, ...Array.from({ length: config.statusLine.bottomMargin }, () => "")];
		}
		return rendered;
	};
	/** Merge authoritative native footer data (branch + extension statuses) into the snapshot. */
	const effectiveSnapshot = (
		input: StatusSnapshot,
		statuses: ReadonlyMap<string, string> | undefined,
	): StatusSnapshot => {
		if (!footerData || !statuses) return input;
		const extensionStatuses = [...statuses].map(([key, value]) => ({ key, value }));
		const branch = footerData.getGitBranch();
		const git = branch && input.git ? { ...input.git, branch } : input.git;
		return {
			...input,
			extensionStatuses,
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
		if (!isCurrent()) return;
		if (!config.enabled || !config.statusLine.enabled) {
			clearFooter();
			return;
		}
		try {
			options.host.setFooter(footerFactory);
			footerOwner = true;
			owners.set(FOOTER_OWNER_KEY, { token, generation: options.generation });
		} catch {
			footerOwner = false;
		}
	};
	const clearFooter = (): void => {
		if (!footerOwner) return;
		footerOwner = false;
		releaseFooterData();
		if (owners.get(FOOTER_OWNER_KEY)?.token !== token) return;
		owners.delete(FOOTER_OWNER_KEY);
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
			// can reuse lines only while native statuses also remain unchanged.
			let renderCache:
				| { width: number; generation: object | undefined; statuses: [string, string][] | undefined; lines: string[] }
				| undefined;
			const component: RenderComponent = {
				render(width) {
					const generation = themeGeneration(currentTheme);
					const statuses = footerData?.getExtensionStatuses();
					const statusesMatch = statuses
						? renderCache?.statuses !== undefined &&
							renderCache.statuses.length === statuses.size &&
							renderCache.statuses.every(([key, value]) => statuses.get(key) === value)
						: renderCache?.statuses === undefined;
					if (renderCache?.width === width && renderCache.generation === generation && statusesMatch) {
						return renderCache.lines;
					}
					const lines = render(currentTheme, width, secondary, statuses);
					renderCache = { width, generation, statuses: statuses ? [...statuses] : undefined, lines };
					return lines;
				},
				invalidate() {
					renderCache = undefined;
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
	const orderingBridge = {
		reflow(): void {
			if (!isCurrent() || globals[ORDER_KEY] !== orderingBridge) return;
			if (!config.enabled || !config.statusLine.enabled) return;
			for (const [key, secondary] of [
				[PRIMARY_WIDGET_KEY, false],
				[SECONDARY_WIDGET_KEY, true],
			] as const) {
				if (!secondary && placementFor(config) !== "belowEditor") continue;
				if (owners.get(key)?.token !== token) continue;
				safeWidget(options.host, key, factory(secondary), "belowEditor");
			}
		},
	};
	const releaseOrdering = () => {
		if (globals[ORDER_KEY] === orderingBridge) delete globals[ORDER_KEY];
	};
	const mount = () => {
		if (!isCurrent()) return;
		if (!config.enabled || !config.statusLine.enabled) {
			clear(PRIMARY_WIDGET_KEY);
			clear(SECONDARY_WIDGET_KEY);
			clearFooter();
			releaseOrdering();
			return;
		}
		globals[ORDER_KEY] = orderingBridge;
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
			if (!isCurrent()) return;
			snapshot = next;
			primaryComponent?.invalidate();
			secondaryComponent?.invalidate();
		},
		configure(next) {
			if (!isCurrent()) return;
			const placementChanged = placementFor(next) !== placementFor(config);
			const enabledChanged = next.enabled !== config.enabled || next.statusLine.enabled !== config.statusLine.enabled;
			config = next;
			segments = statusSegments(config);
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
			releaseOrdering();
			clear(PRIMARY_WIDGET_KEY);
			clear(SECONDARY_WIDGET_KEY);
			clearFooter();
			installationMap(options.host).delete(options.generation);
			if (activeOwners.get(options.host) === token) activeOwners.delete(options.host);
		},
	};
	installationMap(options.host).set(options.generation, installation);
	mount();
	return installation;
}
