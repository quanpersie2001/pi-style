import type { Component, OverlayHandle, OverlayOptions } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeConfig } from "../../extension-src/pi-style/domain/config-normalization.js";
import { installStartup, type StartupHost } from "../../extension-src/pi-style/features/startup/index.js";

const snapshot = { reason: "startup" as const, model: "gpt-test", thinkingLevel: "high" as const };

function host(): { host: StartupHost; state: { hidden: boolean; disposed: boolean }; renders: number[] } {
	const renders: number[] = [];
	const state = { hidden: false, disposed: false };
	const current = {
		hide: () => {
			state.hidden = true;
			state.disposed = true;
		},
		setHidden: (hidden: boolean) => {
			state.hidden = hidden;
		},
		isHidden: () => state.hidden,
		focus: () => {},
		unfocus: () => {},
		isFocused: () => !state.hidden,
	};
	const custom: NonNullable<StartupHost["custom"]> = async <T>(
		factory: (tui: unknown, theme: unknown, keybindings: unknown, done: (value: T) => void) => Component,
		options?: { overlay?: boolean; overlayOptions?: OverlayOptions; onHandle?: (handle: OverlayHandle) => void },
	) => {
		options?.onHandle?.(current);
		await factory({ requestRender: () => renders.push(1) }, { fg: () => "" }, {}, () => current.hide());
		return undefined as T;
	};
	const startupHost: StartupHost = {
		mode: "tui",
		hasUI: true,
		setHeader: () => {},
		custom,
		onTerminalInput: () => () => {},
	};
	return { host: startupHost, state, renders };
}

describe("startup lifecycle safety", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("dismisses overlay on timeout and cancels the timer on disposal", async () => {
		const fake = host();
		const installation = installStartup({
			host: fake.host,
			config: normalizeConfig({ startup: { mode: "overlay" } }),
			snapshot,
			generation: 1,
			timeoutMs: 100,
		});
		await vi.advanceTimersByTimeAsync(100);
		expect(fake.state.disposed).toBe(true);
		installation?.dispose();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("ignores stale generation updates", () => {
		const fake = host();
		const installation = installStartup({
			host: fake.host,
			config: normalizeConfig({}),
			snapshot,
			generation: 2,
			isCurrent: () => false,
		});
		installation?.update({ ...snapshot, model: "stale" });
		expect(fake.renders).toEqual([]);
	});
});
