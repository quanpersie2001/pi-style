import type { NormalizedPiStyleConfig } from "../../domain/config-types.js";
import { createBuiltinSegments, type StatusSnapshot } from "../../domain/status.js";
import { renderStatus } from "../../domain/status-renderer.js";
import { resolveTheme } from "../../domain/theme.js";

export const PRIMARY_WIDGET_KEY = "pi-style.status.primary";
export const SECONDARY_WIDGET_KEY = "pi-style.status.secondary";

type WidgetContent = string[] | undefined;

export interface StatusLineWidgetHost {
	setWidget(key: string, content: WidgetContent, options?: { placement?: "aboveEditor" | "belowEditor" }): void;
}

export interface StatusLineInstallation {
	readonly generation: number;
	readonly primaryKey: typeof PRIMARY_WIDGET_KEY;
	readonly secondaryKey: typeof SECONDARY_WIDGET_KEY;
	update(snapshot: StatusSnapshot): void;
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
	content: WidgetContent,
	placement?: "aboveEditor" | "belowEditor",
): boolean {
	try {
		host.setWidget(key, content, placement ? { placement } : undefined);
		return true;
	} catch {
		return false;
	}
}

function renderLines(snapshot: StatusSnapshot, config: NormalizedPiStyleConfig): string[] {
	const rendered = renderStatus(config.statusLine.layout, snapshot, 160, {
		separator: config.statusLine.separator === "powerline-thin" ? "│" : config.statusLine.separator,
		segments: createBuiltinSegments(),
		theme: resolveTheme(undefined, config),
	});
	return [...rendered.lines];
}

export function installStatusLine(options: StatusLineInstallOptions): StatusLineInstallation {
	const current = installationMap(options.host).get(options.generation);
	if (current) return current;

	const token = Symbol("pi-style.status-line");
	const owners = ownerMap(options.host);
	const placement = options.config.placement === "below" ? "belowEditor" : "aboveEditor";
	let disposed = false;
	let snapshot: StatusSnapshot = options.initialSnapshot;

	const claim = (key: string): void => {
		owners.set(key, { token, generation: options.generation });
	};
	const write = (key: string, content: WidgetContent, widgetPlacement?: "aboveEditor" | "belowEditor"): void => {
		if (!safeWidget(options.host, key, content, widgetPlacement)) return;
		claim(key);
	};
	const update = (next: StatusSnapshot): void => {
		if (disposed || options.isCurrent?.() === false) return;
		snapshot = next;
		const lines = renderLines(snapshot, options.config);
		const primary = lines[0] ? [lines[0]] : undefined;
		const secondary = lines.length > 1 ? lines.slice(1) : undefined;
		write(PRIMARY_WIDGET_KEY, primary, placement);
		write(SECONDARY_WIDGET_KEY, secondary, "belowEditor");
	};
	const installation: StatusLineInstallation = {
		generation: options.generation,
		primaryKey: PRIMARY_WIDGET_KEY,
		secondaryKey: SECONDARY_WIDGET_KEY,
		update,
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const key of [PRIMARY_WIDGET_KEY, SECONDARY_WIDGET_KEY]) {
				const currentOwner = owners.get(key);
				if (currentOwner?.token !== token || currentOwner.generation !== options.generation) continue;
				if (safeWidget(options.host, key, undefined)) owners.delete(key);
			}
			installationMap(options.host).delete(options.generation);
		},
	};

	installationMap(options.host).set(options.generation, installation);
	update(options.initialSnapshot);
	return installation;
}
