import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { getThemeExtrasRevision, setFullTheme } from "../shared/theme-extras.js";

export const THEME_REFRESH_WIDGET_KEY = "pi-style.theme-refresh";

/** Independent, zero-line invalidation hook. Chat invalidates before widgets,
 * so refresh extras here, then rebuild once with the refreshed extras revision.
 * Never mutate the host TUI: Pi supplies a forwarding reference that can swap
 * its backing renderer, and function reads do not have stable identity. */
export function installThemeRefresh(ui: ExtensionUIContext): { dispose(): void } {
	let release: (() => void) | undefined;
	ui.setWidget(
		THEME_REFRESH_WIDGET_KEY,
		(tui, theme) => {
			release?.();
			let active = true;
			let pending = false;
			setFullTheme(theme);
			let revision = getThemeExtrasRevision();
			const dispose = () => {
				active = false;
			};
			release = dispose;
			return {
				render: () => [],
				invalidate() {
					if (!active) return;
					setFullTheme(theme);
					const current = getThemeExtrasRevision();
					if (current === revision) return;
					revision = current;
					if (pending) return;
					pending = true;
					queueMicrotask(() => {
						pending = false;
						if (!active) return;
						tui.invalidate();
						tui.requestRender();
					});
				},
				dispose,
			};
		},
		{ placement: "belowEditor" },
	);
	return {
		dispose() {
			release?.();
			release = undefined;
			ui.setWidget(THEME_REFRESH_WIDGET_KEY, undefined);
		},
	};
}
