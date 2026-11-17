import { describe, expect, it, vi } from "vitest";
import { normalizeConfig } from "../../extension-src/pi-style/domain/config-normalization.js";
import type { StatusSnapshot } from "../../extension-src/pi-style/domain/status.js";
import {
	type ActivePiTheme,
	installStatusLine,
	PRIMARY_WIDGET_KEY,
	renderStatusLine,
	SECONDARY_WIDGET_KEY,
	type StatusLineWidgetHost,
} from "../../extension-src/pi-style/features/status-line/index.js";

const config = normalizeConfig({
	statusLine: {
		bottomMargin: 1,
		layout: { left: ["model", "git"], right: [], secondary: ["extension_statuses"] },
	},
});
const snapshot = {
	model: "model",
	git: { available: true, branch: "snapshot", staged: 0, unstaged: 0, untracked: 0, refreshing: false },
} satisfies StatusSnapshot;
type Component = { render(width: number): string[]; invalidate(): void; dispose?(): void };

function fixture(theme: ActivePiTheme) {
	const widgets = new Map<string, Component>();
	const statuses = new Map([["native", "live"]]);
	let branch = "main";
	let branchChanged: (() => void) | undefined;
	let footer: Component | undefined;
	const requestRender = vi.fn();
	const host: StatusLineWidgetHost = {
		setWidget(key, content) {
			widgets.get(key)?.dispose?.();
			widgets.delete(key);
			if (typeof content === "function") widgets.set(key, content({ requestRender }, theme));
		},
		setFooter(factory) {
			footer?.dispose?.();
			footer = factory?.({ requestRender }, theme, {
				getGitBranch: () => branch,
				getExtensionStatuses: () => statuses,
				onBranchChange(callback) {
					branchChanged = callback;
					return () => {
						branchChanged = undefined;
					};
				},
			});
		},
	};
	const install = (generation = 1) => installStatusLine({ host, generation, config, initialSnapshot: snapshot });
	return {
		widgets,
		statuses,
		install,
		requestRender,
		changeBranch(next: string) {
			branch = next;
			branchChanged?.();
		},
		releaseFooter: () => footer?.dispose?.(),
	};
}

describe("installed shared status layout", () => {
	it("matches full layouts at unequal widths, across native status and branch revisions", () => {
		const theme = { fg: (_token: string, text: string) => text };
		const f = fixture(theme);
		const installation = f.install();
		const primary = f.widgets.get(PRIMARY_WIDGET_KEY);
		const secondary = f.widgets.get(SECONDARY_WIDGET_KEY);
		try {
			for (const branch of ["main", "changed"]) {
				f.changeBranch(branch);
				for (const value of ["inserted", "changed", ""]) {
					if (value) f.statuses.set("native", value);
					else f.statuses.clear();
					const effective = {
						...snapshot,
						git: { ...snapshot.git, branch },
						extensionStatuses: [...f.statuses].map(([key, value]) => ({ key, value })),
					};
					for (const [first, second] of [
						[80, 24],
						[24, 80],
						[80, 80],
					] as const) {
						expect(secondary?.render(second)).toEqual(renderStatusLine(config, effective, theme, second).slice(1));
						const expected = renderStatusLine(config, effective, theme, first).slice(0, 1);
						expect(primary?.render(first)).toEqual([...expected, ""]);
					}
				}
			}
			expect(f.requestRender).toHaveBeenCalled();
			f.releaseFooter();
			expect(primary?.render(80)).toEqual([...renderStatusLine(config, snapshot, theme, 80).slice(0, 1), ""]);
			expect(secondary?.render(80)).toEqual([]);
		} finally {
			installation.dispose();
		}
	});

	it("refreshes both rows on mutable theme invalidation and stable-proxy backing reload", () => {
		let color = "31";
		let colors = {};
		const theme = {
			get colors() {
				return colors;
			},
			fg: (_token: string, text: string) => `\x1b[${color}m${text}\x1b[39m`,
		};
		const f = fixture(theme);
		const installation = f.install();
		try {
			const primary = f.widgets.get(PRIMARY_WIDGET_KEY);
			const secondary = f.widgets.get(SECONDARY_WIDGET_KEY);
			expect(primary?.render(80).join("")).toContain("\x1b[31m");
			expect(secondary?.render(80).join("")).toContain("\x1b[31m");
			color = "32";
			secondary?.invalidate();
			expect(primary?.render(80).join("")).toContain("\x1b[32m");
			expect(secondary?.render(80).join("")).toContain("\x1b[32m");
			color = "33";
			colors = {};
			// No invalidate: Pi can keep its theme proxy stable on backing reload.
			expect(secondary?.render(80).join("")).toContain("\x1b[33m");
			expect(primary?.render(80).join("")).toContain("\x1b[33m");
		} finally {
			installation.dispose();
		}
	});

	it("drops cached rows on configuration/remount and keeps newer installation ownership", () => {
		const f = fixture({ fg: (_token: string, text: string) => text });
		const old = f.install();
		try {
			f.widgets.get(PRIMARY_WIDGET_KEY)?.render(80);
			old.configure(
				normalizeConfig({ ...config, placement: "above", statusLine: { ...config.statusLine, bottomMargin: 0 } }),
			);
			expect(f.widgets.get(PRIMARY_WIDGET_KEY)?.render(80)).toHaveLength(1);
			old.configure(normalizeConfig({ enabled: false }));
			expect(f.widgets.size).toBe(0);
			old.configure(config);
			expect(f.widgets.get(PRIMARY_WIDGET_KEY)?.render(80)).toHaveLength(2);
			const current = f.install(2);
			try {
				old.dispose();
				old.update({ model: "stale" });
				expect(f.widgets.size).toBe(2);
				expect(f.widgets.get(PRIMARY_WIDGET_KEY)?.render(80).join("")).not.toContain("stale");
			} finally {
				current.dispose();
			}
			expect(f.widgets.size).toBe(0);
		} finally {
			old.dispose();
		}
	});
});
