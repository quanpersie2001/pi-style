import {
	type Component,
	type OverlayHandle,
	type OverlayOptions,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { NormalizedPiStyleConfig } from "../../domain/config-types.js";
import type { StatusSnapshot } from "../../domain/status.js";
import { type ActiveTheme, resolveTheme } from "../../domain/theme.js";

export type StartupReason = "startup" | "reload" | "new" | "resume" | "fork";

export interface StartupResources {
	readonly contextFiles?: number;
	readonly extensions?: number;
	readonly skills?: number;
	readonly prompts?: number;
	readonly tools?: number;
	readonly error?: string;
}

export interface StartupSnapshot extends StatusSnapshot {
	readonly reason: StartupReason;
	readonly project?: string | undefined;
	readonly provider?: string | undefined;
	readonly resources?: StartupResources | undefined;
	readonly preset?: string | undefined;
	readonly compatibility?: string | undefined;
}

export type StartupTheme = ActiveTheme;

function activeThemeFromPi(theme: unknown): ActiveTheme {
	if (!theme || typeof theme !== "object") return {};
	const candidate = theme as { fg?: (token: string, text?: string) => string; colors?: Record<string, string> };
	return {
		...(candidate.colors ? { colors: candidate.colors } : {}),
		...(candidate.fg ? { fg: (token: string) => candidate.fg?.(token, "") ?? "" } : {}),
	};
}

export interface StartupHost {
	setHeader?: (factory: ((tui: unknown, theme: unknown) => Component & { dispose?(): void }) | undefined) => void;
	setWidget?: (key: string, content: unknown, options?: unknown) => void;
	custom?: <T>(
		factory: (
			tui: unknown,
			theme: unknown,
			keybindings: unknown,
			done: (value: T) => void,
		) => Component & { dispose?(): void },
		options?: { overlay?: boolean; overlayOptions?: OverlayOptions; onHandle?: (handle: OverlayHandle) => void },
	) => Promise<T>;
	onTerminalInput?: (handler: (...args: readonly unknown[]) => unknown) => () => void;
	readonly mode?: string;
	readonly hasUI?: boolean;
	/** Optional public-adapter capability used to avoid overwriting a later header owner. */
	getHeaderFactory?: () => unknown;
}

export interface StartupInstallation {
	readonly generation: number;
	update(snapshot: StartupSnapshot): void;
	dismiss(): void;
	configure(config: NormalizedPiStyleConfig): void;
	dispose(): void;
}

export interface StartupInstallOptions {
	host: StartupHost;
	config: NormalizedPiStyleConfig;
	snapshot: StartupSnapshot;
	generation: number;
	requestRender?: () => void;
	timeoutMs?: number;
	isCurrent?: () => boolean;
}

export const STARTUP_WIDGET_KEY = "pi-style.startup";
const owners = new WeakMap<object, Map<string, symbol>>();

function ownerMap(host: object): Map<string, symbol> {
	let map = owners.get(host);
	if (!map) {
		map = new Map();
		owners.set(host, map);
	}
	return map;
}

function safeCall(fn: () => void): boolean {
	try {
		fn();
		return true;
	} catch {
		return false;
	}
}

function shouldShow(reason: StartupReason, mode: "off" | "compact" | "overlay"): boolean {
	if (mode === "off") return false;
	return reason === "startup" || reason === "reload" || reason === "new" || reason === "resume" || reason === "fork";
}

function overlayAllowed(reason: StartupReason): boolean {
	return reason === "startup";
}

function projectName(snapshot: StartupSnapshot): string | undefined {
	if (snapshot.project) return snapshot.project;
	return snapshot.cwd?.split(/[\\/]/).filter(Boolean).at(-1);
}

function compactResourceLine(resources: StartupResources | undefined): string | undefined {
	if (!resources) return undefined;
	const parts: string[] = [];
	if (resources.contextFiles !== undefined) parts.push(`${resources.contextFiles} context`);
	if (resources.extensions !== undefined) parts.push(`${resources.extensions} extensions`);
	if (resources.skills !== undefined) parts.push(`${resources.skills} skills`);
	if (resources.prompts !== undefined) parts.push(`${resources.prompts} prompts`);
	if (resources.tools !== undefined) parts.push(`${resources.tools} tools`);
	return parts.length > 0 ? `resources  ${parts.join(" · ")}` : undefined;
}

function buildPlainLines(snapshot: StartupSnapshot, config: NormalizedPiStyleConfig, overlay: boolean): string[] {
	const lines: string[] = [];
	const model = config.startup.showModel ? snapshot.model : undefined;
	const project = projectName(snapshot);
	const identity = [model, snapshot.thinkingLevel ? `think ${snapshot.thinkingLevel}` : undefined, project]
		.filter(Boolean)
		.join("  ·  ");
	lines.push(identity ? `π pi-style  ${identity}` : "π pi-style");
	const context = snapshot.context?.percent;
	const details = [
		context !== undefined && Number.isFinite(context) ? `context ${Math.round(context)}%` : undefined,
		snapshot.provider ? `provider ${snapshot.provider}` : undefined,
		snapshot.preset ? `preset ${snapshot.preset}` : undefined,
		snapshot.compatibility ? snapshot.compatibility : undefined,
	].filter(Boolean);
	if (details.length > 0) lines.push(details.join("  ·  "));
	if (config.startup.showResources) {
		const resources = compactResourceLine(snapshot.resources);
		if (resources) lines.push(resources);
		if (snapshot.resources?.error) lines.push(`resources unavailable  ·  ${snapshot.resources.error}`);
	}
	if (overlay) lines.push("enter prompt to continue  ·  esc dismiss");
	return lines.filter((line) => line.trim().length > 0);
}

function styledLines(
	theme: ActiveTheme,
	config: NormalizedPiStyleConfig,
	snapshot: StartupSnapshot,
	overlay: boolean,
	width: number,
): string[] {
	if (width <= 0 || config.startup.mode === "off") return [];
	const resolved = resolveTheme(theme, config);
	const plain = buildPlainLines(snapshot, config, overlay);
	return plain.map((line, index) => {
		const token = index === 0 ? "accent" : index === plain.length - 1 && overlay ? "dim" : "muted";
		const styled = resolved.noColor ? line : `${resolved.color(token as never)}${line}\x1b[0m`;
		return visibleWidth(styled) <= width ? styled : truncateToWidth(styled, width, "");
	});
}

class StartupComponent implements Component {
	private snapshot: StartupSnapshot;
	private config: NormalizedPiStyleConfig;
	private readonly theme: ActiveTheme;
	private readonly overlay: boolean;
	private readonly requestRender: () => void;

	constructor(
		theme: ActiveTheme,
		config: NormalizedPiStyleConfig,
		snapshot: StartupSnapshot,
		overlay: boolean,
		requestRender: () => void,
	) {
		this.theme = theme;
		this.config = config;
		this.snapshot = snapshot;
		this.overlay = overlay;
		this.requestRender = requestRender;
	}

	setSnapshot(snapshot: StartupSnapshot): void {
		this.snapshot = snapshot;
		this.invalidate();
	}

	setConfig(config: NormalizedPiStyleConfig): void {
		this.config = config;
		this.invalidate();
	}

	render(width: number): string[] {
		return styledLines(this.theme, this.config, this.snapshot, this.overlay, width);
	}

	invalidate(): void {
		this.requestRender();
	}
}

export function renderStartup(
	snapshot: StartupSnapshot,
	config: NormalizedPiStyleConfig,
	theme: ActiveTheme,
	width: number,
	overlay = false,
): string[] {
	return styledLines(theme, config, snapshot, overlay, width);
}

export function installStartup(options: StartupInstallOptions): StartupInstallation | undefined {
	const { host } = options;
	if (options.config.startup.mode === "off" || !shouldShow(options.snapshot.reason, options.config.startup.mode))
		return undefined;
	if (!host.hasUI || host.mode !== "tui") return undefined;
	const token = Symbol("pi-style.startup");
	const map = ownerMap(host as object);
	let config = options.config;
	let snapshot = options.snapshot;
	let disposed = false;
	let dismissed = false;
	let headerInstalled = false;
	let installedHeaderFactory: unknown;
	let widgetInstalled = false;
	let overlayHandle: OverlayHandle | undefined;
	let removeInput: (() => void) | undefined;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	let overlayDone: ((value: undefined) => void) | undefined;
	const components: StartupComponent[] = [];
	const timeoutMs = options.timeoutMs;
	const component = (theme: unknown, isOverlay: boolean, tui: { requestRender?: () => void }) => {
		const result = new StartupComponent(activeThemeFromPi(theme), config, snapshot, isOverlay, () => {
			tui.requestRender?.();
			options.requestRender?.();
		});
		components.push(result);
		return result;
	};
	const clearTimer = () => {
		if (timeout) clearTimeout(timeout);
		timeout = undefined;
	};
	const dismiss = () => {
		if (disposed || dismissed) return;
		dismissed = true;
		clearTimer();
		overlayHandle?.hide();
		overlayHandle = undefined;
		overlayDone?.(undefined);
		overlayDone = undefined;
	};
	const clearHeader = () => {
		if (!headerInstalled || map.get("header") !== token) return;
		const current = host.getHeaderFactory?.();
		if (host.getHeaderFactory && current !== installedHeaderFactory) return;
		if (host.setHeader) safeCall(() => host.setHeader?.(undefined));
		map.delete("header");
	};
	const clearWidget = () => {
		if (!widgetInstalled || map.get(STARTUP_WIDGET_KEY) !== token) return;
		if (host.setWidget) safeCall(() => host.setWidget?.(STARTUP_WIDGET_KEY, undefined));
		map.delete(STARTUP_WIDGET_KEY);
	};
	const mountCompact = () => {
		const factory = (tui: unknown, theme: unknown) => component(theme, false, tui as { requestRender?: () => void });
		if (host.setHeader && safeCall(() => host.setHeader?.(factory))) {
			installedHeaderFactory = factory;
			headerInstalled = true;
			map.set("header", token);
			return;
		}
		if (host.setWidget && safeCall(() => host.setWidget?.(STARTUP_WIDGET_KEY, factory, { placement: "aboveEditor" }))) {
			widgetInstalled = true;
			map.set(STARTUP_WIDGET_KEY, token);
		}
	};
	const mountOverlay = () => {
		if (!host.custom || !overlayAllowed(snapshot.reason)) {
			mountCompact();
			return;
		}
		const overlayOptions: OverlayOptions = {
			anchor: "center",
			width: "80%",
			maxHeight: "60%",
			minWidth: 40,
			visible: (width, height) => width >= 40 && height >= 8,
		};
		void host
			.custom<undefined>(
				(tui, theme, _keybindings, done) => {
					overlayDone = done;
					return component(theme, true, tui as { requestRender?: () => void });
				},
				{ overlay: true, overlayOptions, onHandle: (handle) => (overlayHandle = handle) },
			)
			.catch(() => {
				if (!disposed && !dismissed) {
					clearTimer();
					mountCompact();
				}
			});
	};
	const installation: StartupInstallation = {
		generation: options.generation,
		update(next) {
			if (disposed || options.isCurrent?.() === false) return;
			snapshot = next;
			for (const item of components) item.setSnapshot(next);
			options.requestRender?.();
		},
		dismiss,
		configure(next) {
			if (disposed || options.isCurrent?.() === false) return;
			config = next;
			for (const item of components) item.setConfig(next);
			if (next.startup.mode === "off") {
				dismiss();
				clearHeader();
				clearWidget();
			}
			options.requestRender?.();
		},
		dispose() {
			if (disposed) return;
			dismiss();
			disposed = true;
			removeInput?.();
			removeInput = undefined;
			clearHeader();
			clearWidget();
			map.delete("installation");
		},
	};
	map.set("installation", token);
	removeInput = host.onTerminalInput?.(() => dismiss());
	if (config.startup.mode === "compact") mountCompact();
	if (config.startup.mode === "overlay") mountOverlay();
	if (config.startup.mode === "overlay" && timeoutMs !== undefined && timeoutMs >= 0) {
		timeout = setTimeout(() => dismiss(), timeoutMs);
	}
	return installation;
}
