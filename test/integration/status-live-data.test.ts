import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../../extension-src/pi-style/domain/config-normalization.js";
import type { NormalizedPiStyleConfig } from "../../extension-src/pi-style/domain/config-types.js";
import type { StatusSnapshot } from "../../extension-src/pi-style/domain/status.js";
import {
	installStatusLine,
	PRIMARY_WIDGET_KEY,
	renderStatusLine,
	SECONDARY_WIDGET_KEY,
	type StatusLineWidgetHost,
} from "../../extension-src/pi-style/features/status-line/index.js";
import { stripAnsi } from "../../extension-src/pi-style/shared/ansi.js";

function fixture(config: NormalizedPiStyleConfig, snapshot: StatusSnapshot = {}) {
	const statuses = new Map<string, string>();
	const theme = { fg: (_token: string, text: string) => text };
	const widgets = new Map<string, { render(width: number): string[]; invalidate(): void }>();
	const host: StatusLineWidgetHost = {
		setWidget(key, content) {
			widgets.delete(key);
			if (typeof content === "function") widgets.set(key, content({}, theme));
		},
		setFooter(factory) {
			factory?.({}, theme, {
				getGitBranch: () => null,
				getExtensionStatuses: () => statuses,
				onBranchChange: () => () => {},
			});
		},
	};
	const installation = installStatusLine({ host, config, generation: 1, initialSnapshot: snapshot });
	const render = (key = PRIMARY_WIDGET_KEY) => widgets.get(key)?.render(80) ?? [];
	return { statuses, theme, installation, render };
}

function statusConfig(secondary = false) {
	return normalizeConfig({
		theme: { nerdFonts: "off" },
		statusLine: {
			bottomMargin: 0,
			layout: {
				left: secondary ? ["model"] : ["extension_statuses"],
				right: [],
				secondary: secondary ? ["extension_statuses"] : [],
			},
		},
	});
}

describe("live native status data", () => {
	it.each([false, true])(
		"repaints native status insert/change/remove without snapshot updates (secondary=%s)",
		(secondary) => {
			const host = fixture(statusConfig(secondary), { model: "model" });
			const key = secondary ? SECONDARY_WIDGET_KEY : PRIMARY_WIDGET_KEY;
			try {
				const empty = host.render(key);
				expect(host.render(key)).toBe(empty);
				host.statuses.set("native", "inserted");
				const inserted = host.render(key);
				expect(inserted.map(stripAnsi).join("\n")).toContain("inserted");
				expect(host.render(key)).toBe(inserted);
				host.statuses.set("native", "changed");
				const changed = host.render(key);
				expect(changed.map(stripAnsi).join("\n")).toContain("changed");
				expect(changed.map(stripAnsi).join("\n")).not.toContain("inserted");
				host.statuses.delete("native");
				expect(host.render(key)).toEqual(empty);
			} finally {
				host.installation.dispose();
			}
		},
	);

	it("treats an empty native status map as authoritative over stale snapshots", () => {
		const host = fixture(statusConfig(), { extensionStatuses: [{ key: "stale", value: "stale snapshot" }] });
		try {
			expect(host.render()).toEqual([]);
			host.statuses.set("native", "live");
			expect(host.render().map(stripAnsi)).toEqual(["live"]);
			host.statuses.clear();
			expect(host.render()).toEqual([]);
		} finally {
			host.installation.dispose();
		}
	});

	it("matches detached rendering after custom segment add/change/remove configuration", () => {
		const base = statusConfig();
		const configFor = (customItems: NormalizedPiStyleConfig["statusLine"]["customItems"]) =>
			normalizeConfig({
				...base,
				statusLine: {
					...base.statusLine,
					layout: { left: ["custom"], right: [], secondary: [] },
					customItems: [...customItems],
				},
			});
		const host = fixture(configFor([]));
		host.statuses.set("one", "first");
		host.statuses.set("two", "second");
		try {
			for (const [items, expected] of [
				[[{ id: "custom", statusKey: "one", label: "added" }], "added:first"],
				[[{ id: "custom", statusKey: "two", label: "changed", priority: 99 }], "changed:second"],
				[[], ""],
			] as const) {
				const config = configFor(items);
				host.installation.configure(config);
				const lines = host.render();
				expect(lines.map(stripAnsi).join("\n")).toBe(expected);
				expect(lines).toEqual(
					renderStatusLine(
						config,
						{ extensionStatuses: [...host.statuses].map(([key, value]) => ({ key, value })) },
						host.theme,
						80,
					),
				);
				expect(host.render()).toBe(lines);
			}
		} finally {
			host.installation.dispose();
		}
	});
});
