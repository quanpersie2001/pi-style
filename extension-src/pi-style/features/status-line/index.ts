import type { NormalizedPiStyleConfig } from "../../domain/config-types.js";
import { createBuiltinSegments, type SegmentContext, type StatusSnapshot } from "../../domain/status.js";
import { renderStatus } from "../../domain/status-renderer.js";
import { resolveTheme } from "../../domain/theme.js";
import { visibleWidth } from "../../shared/ansi.js";

export const PRIMARY_WIDGET_KEY = "pi-style.status.primary";
export const SECONDARY_WIDGET_KEY = "pi-style.status.secondary";

type WidgetPlacement = "aboveEditor" | "belowEditor";
type RenderComponent = { render(width: number): string[]; invalidate(): void; dispose?(): void };
type WidgetFactory = (tui: { requestRender?: () => void }, theme: ActivePiTheme) => RenderComponent;

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
function separatorFor(config: NormalizedPiStyleConfig): string {
	if (config.statusLine.separator === "powerline-thin") return "│";
	if (config.statusLine.separator.length === 0) return "│";
	return config.statusLine.separator;
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
		const resolved = renderStatus(config.statusLine.layout, snapshot, width, {
			separator: separatorFor(config),
			segments,
			theme: resolveTheme(
				activeTheme.colors || activeTheme.fg
					? {
							...(activeTheme.colors ? { colors: activeTheme.colors } : {}),
							...(activeTheme.fg ? { fg: (token: string) => activeTheme.fg?.(token, "") ?? "" } : {}),
						}
					: undefined,
				config,
			),
			options: Object.fromEntries(config.statusLine.disabledSegments.map((id) => [id, { disabled: true }])),
		});
		const lines = secondary ? resolved.lines.slice(1) : resolved.lines.slice(0, 1);
		return lines.filter((line) => visibleWidth(line) <= width);
	};
	const factory =
		(secondary: boolean): WidgetFactory =>
		(tui, theme) => {
			const currentTheme = theme;
			const component: RenderComponent = {
				render(width) {
					const lines = render(currentTheme, width, secondary);
					return lines;
				},
				invalidate() {
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
			return;
		}
		if (safeWidget(options.host, PRIMARY_WIDGET_KEY, factory(false), placementFor(config))) claim(PRIMARY_WIDGET_KEY);
		if (safeWidget(options.host, SECONDARY_WIDGET_KEY, factory(true), "belowEditor")) claim(SECONDARY_WIDGET_KEY);
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
			installationMap(options.host).delete(options.generation);
		},
	};
	installationMap(options.host).set(options.generation, installation);
	mount();
	return installation;
}
