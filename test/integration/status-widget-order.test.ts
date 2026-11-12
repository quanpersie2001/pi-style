import { describe, expect, it, vi } from "vitest";
import { normalizeConfig } from "../../extension-src/pi-style/domain/config-normalization.js";
import {
	installStatusLine,
	PRIMARY_WIDGET_KEY,
	SECONDARY_WIDGET_KEY,
	type StatusLineWidgetHost,
} from "../../extension-src/pi-style/features/status-line/index.js";

const key = Symbol.for("@quandev104/pi-teams:agent-widget-order");
const globals = globalThis as Record<symbol, unknown>;
const config = (placement: "above" | "below" = "below", enabled = true) =>
	normalizeConfig({ placement, statusLine: { enabled } });

function fixture() {
	const widgets = new Map<string, string>();
	const host: StatusLineWidgetHost = {
		setWidget(key, content, options) {
			// Native Pi disposes/deletes even when replacing an existing key.
			widgets.delete(key);
			if (content) widgets.set(key, options?.placement ?? "aboveEditor");
		},
		setFooter() {},
	};
	const install = (generation = 1) => installStatusLine({ host, generation, config: config(), initialSnapshot: {} });
	const roster = () => host.setWidget("teams-agents", ["roster"], { placement: "belowEditor" });
	const below = () => [...widgets].filter(([, placement]) => placement === "belowEditor").map(([key]) => key);
	return { install, roster, below, widgets };
}

describe("optional main widget ordering bridge", () => {
	it.each([true, false])("keeps status before roster with style first=%s and dynamic mounts", (styleFirst) => {
		const f = fixture();
		const bridge = { reflow: f.roster };
		if (!styleFirst) {
			f.roster();
			globals[key] = bridge;
		}
		const style = f.install();
		try {
			f.roster();
			globals[key] = bridge;
			expect(f.below()).toEqual([PRIMARY_WIDGET_KEY, SECONDARY_WIDGET_KEY, "teams-agents"]);
			f.widgets.delete("teams-agents");
			f.roster();
			expect(f.below()).toEqual([PRIMARY_WIDGET_KEY, SECONDARY_WIDGET_KEY, "teams-agents"]);
			style.configure(config("above"));
			expect(f.widgets.get(PRIMARY_WIDGET_KEY)).toBe("aboveEditor");
			expect(f.below()).toEqual([SECONDARY_WIDGET_KEY, "teams-agents"]);
			style.configure(config());
			expect(f.below()).toEqual([PRIMARY_WIDGET_KEY, SECONDARY_WIDGET_KEY, "teams-agents"]);
			style.configure(config("below", false));
			expect(f.below()).toEqual(["teams-agents"]);
			style.configure(config());
			expect(f.below()).toEqual([PRIMARY_WIDGET_KEY, SECONDARY_WIDGET_KEY, "teams-agents"]);
		} finally {
			style.dispose();
			// The status installation must never remove the roster owner's bridge.
			expect(globals[key]).toBe(bridge);
			delete globals[key];
		}
	});

	it("does not notify from replaced or disposed installations", () => {
		const f = fixture();
		const reflow = vi.fn(f.roster);
		globals[key] = { reflow };
		const old = f.install();
		const current = f.install(2);
		try {
			reflow.mockClear();
			old.configure(config("above"));
			old.dispose();
			expect(reflow).not.toHaveBeenCalled();
			expect(f.below()).toEqual([PRIMARY_WIDGET_KEY, SECONDARY_WIDGET_KEY, "teams-agents"]);
		} finally {
			old.dispose();
			current.dispose();
			delete globals[key];
		}
	});

	it("tolerates an absent or failing optional roster bridge", () => {
		const f = fixture();
		const style = f.install();
		try {
			globals[key] = {
				reflow() {
					throw new Error("stale host");
				},
			};
			expect(() => style.configure(config("above"))).not.toThrow();
			expect(f.widgets.get(PRIMARY_WIDGET_KEY)).toBe("aboveEditor");
			expect(f.below()).toEqual([SECONDARY_WIDGET_KEY]);
		} finally {
			style.dispose();
			delete globals[key];
		}
	});
});
