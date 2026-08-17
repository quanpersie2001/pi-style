import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPiStyleApp } from "../../extension-src/pi-style/app/index.js";
import { createPiStyleRuntime } from "../../extension-src/pi-style/app/runtime.js";
import { normalizeConfig } from "../../extension-src/pi-style/domain/config-normalization.js";
import {
	getUsageFromSessionCacheStats,
	resetUsageFromSessionCache,
	usageFromSession,
} from "../../extension-src/pi-style/pi/session-usage.js";

function usage(input: number, output: number) {
	return { input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output, cost: { total: 0 } };
}

function assistant(id: string, withUsage = true): SessionEntry {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: "t",
		message: withUsage ? { role: "assistant", usage: usage(1, 2) } : { role: "assistant" },
	} as SessionEntry;
}

class MutableSession {
	entries: SessionEntry[];
	constructor(entries: SessionEntry[]) {
		this.entries = entries;
	}
	getEntries(): readonly SessionEntry[] {
		return this.entries;
	}
}

describe("streaming runtime and usage pipeline", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		resetUsageFromSessionCache();
	});
	afterEach(() => vi.useRealTimers());

	it("does not rescan context usage or schedule renders for unchanged streaming bursts", () => {
		let contextReads = 0;
		const app = createPiStyleApp();
		app.sessionStart({
			mode: "print",
			hasUI: false,
			getContextUsage: () => {
				contextReads++;
				return { tokens: 128, contextWindow: 4096, percent: 3 };
			},
		});
		const runtime = app.runtime.current;
		if (!runtime) throw new Error("runtime unavailable");
		const schedule = vi.spyOn(runtime.scheduler, "schedule");
		for (let index = 0; index < 200; index++) app.update({}, "coalesced");
		expect(schedule).not.toHaveBeenCalled();
		expect(contextReads).toBe(1);
	});

	it("skips duplicate revisions for unchanged status updates", () => {
		const app = createPiStyleApp();
		app.sessionStart({ mode: "print", hasUI: false });
		const runtime = app.runtime.current;
		if (!runtime) throw new Error("runtime unavailable");
		const initialRevision = runtime.snapshot.revision;
		app.update({ sessionName: "alpha" }, "coalesced");
		expect(runtime.snapshot.revision).toBe(initialRevision + 1);
		const changedRevision = runtime.snapshot.revision;
		app.update({ sessionName: "alpha" }, "coalesced");
		expect(runtime.snapshot.revision).toBe(changedRevision);
	});

	it("scales usage aggregation incrementally for long sessions", () => {
		const session = new MutableSession(Array.from({ length: 4000 }, (_, index) => assistant(`a${index}`)));
		expect(usageFromSession(session)?.outputTokens).toBe(8000);
		expect(getUsageFromSessionCacheStats(session)).toMatchObject({ scannedEntries: 4000, rebuilds: 1 });
		for (let index = 0; index < 100; index++) expect(usageFromSession(session)?.outputTokens).toBe(8000);
		expect(getUsageFromSessionCacheStats(session)).toMatchObject({ scannedEntries: 4000, cacheHits: 100, rebuilds: 1 });
		session.entries.push(assistant("tail"));
		expect(usageFromSession(session)?.outputTokens).toBe(8002);
		expect(getUsageFromSessionCacheStats(session)).toMatchObject({ scannedEntries: 4001, rebuilds: 1 });
	});

	it("limits production requestRender calls to actual snapshot changes", async () => {
		let renders = 0;
		const runtime = createPiStyleRuntime(
			{
				mode: "print",
				hasUI: false,
				cwd: "/repo",
				config: normalizeConfig({ startup: { mode: "off" }, editor: { enabled: false } }),
				gitRunner: {
					run: async () => ({ stdout: "## main\n", stderr: "", code: 0 }),
				},
				requestRender: () => {
					renders++;
				},
			},
			1,
		);
		await flushPromises();
		expect(renders).toBe(1);
		// invalidateGit debounces the git status spawn (~250ms) so tool-result
		// bursts coalesce into one refresh; advance the window so the refresh
		// runs, then assert it still did not render (snapshot unchanged).
		runtime.invalidateGit();
		await vi.advanceTimersByTimeAsync(300);
		await flushPromises();
		expect(renders).toBe(1);
	});
});

async function flushPromises(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}
