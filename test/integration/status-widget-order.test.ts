import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../../extension-src/pi-style/domain/config-normalization.js";
import {
	installStatusLine,
	PRIMARY_WIDGET_KEY,
	SECONDARY_WIDGET_KEY,
	type StatusLineWidgetHost,
} from "../../extension-src/pi-style/features/status-line/index.js";

const key = Symbol.for("@quandev104/pi-style:status-widget-order");
const globals = globalThis as Record<symbol, unknown>;
const reflow = () => (globals[key] as { reflow(): void } | undefined)?.reflow();
const config = (placement: "above" | "below" = "below", enabled = true) =>
	normalizeConfig({ placement, statusLine: { enabled } });

function fixture() {
	const widgets = new Map<string, string>();
	let footerMounts = 0;
	const host: StatusLineWidgetHost = {
		setWidget(key, content, options) {
			// Native Pi disposes/deletes even when replacing an existing key.
			widgets.delete(key);
			if (content) widgets.set(key, options?.placement ?? "aboveEditor");
		},
		setFooter() {
			footerMounts++;
		},
	};
	const install = (generation = 1) => installStatusLine({ host, generation, config: config(), initialSnapshot: {} });
	const roster = () => {
		host.setWidget("teams-agents", ["roster"], { placement: "belowEditor" });
		reflow();
	};
	const below = () => [...widgets].filter(([, placement]) => placement === "belowEditor").map(([key]) => key);
	return { install, roster, below, widgets, footerMounts: () => footerMounts };
}

describe("optional main widget ordering bridge", () => {
	it.each([true, false])("keeps roster before status with style first=%s and dynamic mounts", (styleFirst) => {
		const f = fixture();
		if (!styleFirst) f.roster();
		const style = f.install();
		try {
			f.roster();
			expect(f.below()).toEqual(["teams-agents", PRIMARY_WIDGET_KEY, SECONDARY_WIDGET_KEY]);
			const mounts = f.footerMounts();
			f.widgets.delete("teams-agents");
			f.roster();
			expect(f.below()).toEqual(["teams-agents", PRIMARY_WIDGET_KEY, SECONDARY_WIDGET_KEY]);
			expect(f.footerMounts()).toBe(mounts);
			style.configure(config("above"));
			f.roster();
			expect(f.widgets.get(PRIMARY_WIDGET_KEY)).toBe("aboveEditor");
			expect(f.below()).toEqual(["teams-agents", SECONDARY_WIDGET_KEY]);
			style.configure(config());
			expect(f.below()).toEqual(["teams-agents", PRIMARY_WIDGET_KEY, SECONDARY_WIDGET_KEY]);
			const retained = globals[key] as { reflow(): void };
			style.configure(config("below", false));
			expect(globals[key]).toBeUndefined();
			retained.reflow();
			f.roster();
			expect(f.below()).toEqual(["teams-agents"]);
			style.configure(config());
			expect(f.below()).toEqual(["teams-agents", PRIMARY_WIDGET_KEY, SECONDARY_WIDGET_KEY]);
		} finally {
			style.dispose();
		}
		expect(globals[key]).toBeUndefined();
	});

	it("does not let replaced or disposed callbacks reclaim widgets", () => {
		const f = fixture();
		const old = f.install();
		const stale = globals[key] as { reflow(): void };
		const current = f.install(2);
		try {
			f.roster();
			const before = [...f.widgets];
			stale.reflow();
			old.configure(config("above"));
			expect([...f.widgets]).toEqual(before);
			const footerMounts = f.footerMounts();
			old.dispose();
			expect(f.footerMounts()).toBe(footerMounts);
			expect(globals[key]).toBeDefined();
			f.roster();
			expect(f.below()).toEqual(["teams-agents", PRIMARY_WIDGET_KEY, SECONDARY_WIDGET_KEY]);
		} finally {
			old.dispose();
			current.dispose();
		}
		const before = [...f.widgets];
		stale.reflow();
		expect([...f.widgets]).toEqual(before);
		expect(globals[key]).toBeUndefined();
	});
});
