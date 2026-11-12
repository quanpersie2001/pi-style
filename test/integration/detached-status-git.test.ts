import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../../extension-src/pi-style/domain/config-normalization.js";
import {
	DETACHED_EDITOR_KEY,
	type DetachedEditorRegistry,
	registerDetachedEditor,
} from "../../extension-src/pi-style/pi/detached-editor.js";

const globals = globalThis as Record<symbol, DetachedEditorRegistry>;

describe("detached child Git provider", () => {
	it("uses its own per-cwd cache, honors disabled config, and aborts on session disposal", async () => {
		let config = DEFAULT_CONFIG;
		const pending = Promise.withResolvers<{ code: number; stdout: string; stderr: string }>();
		let signal: AbortSignal | undefined;
		const runner = {
			run: vi.fn(async (_args: readonly string[], cwd: string, _timeout: number, abort?: AbortSignal) => {
				if (cwd === "/pending") {
					signal = abort;
					return pending.promise;
				}
				return { code: 0, stdout: `## ${cwd.slice(1)}\n M dirty\n?? new\n`, stderr: "" };
			}),
		};
		const installation = registerDetachedEditor(() => config, { gitRunner: runner });
		const registry = globals[DETACHED_EDITOR_KEY];
		if (!registry?.readGit) throw new Error("Missing detached Git provider");
		try {
			for (const cwd of ["", ".", "relative/worktree"]) expect(await registry.readGit(cwd)).toBeUndefined();
			expect(runner.run).not.toHaveBeenCalled();
			expect(await registry.readGit("/A")).toMatchObject({ branch: "A", unstaged: 1, untracked: 1 });
			expect(await registry.readGit("/B")).toMatchObject({ branch: "B" });
			await registry.readGit("/A");
			expect(runner.run).toHaveBeenCalledTimes(2);
			config = { ...config, enabled: false };
			expect(await registry.readGit("/disabled")).toBeUndefined();
			config = { ...config, enabled: true, statusLine: { ...config.statusLine, enabled: false } };
			expect(await registry.readGit("/disabled")).toBeUndefined();
			expect(runner.run).toHaveBeenCalledTimes(2);
			config = DEFAULT_CONFIG;
			const response = registry.readGit("/pending");
			expect(signal?.aborted).toBe(false);
			installation.dispose();
			expect(signal?.aborted).toBe(true);
			pending.resolve({ code: 0, stdout: "## late\n", stderr: "" });
			expect(await response).toBeUndefined();
			expect(await registry.readGit("/A")).toBeUndefined();
		} finally {
			installation.dispose();
		}
	});

	it("returns safe unavailable Git on runner failure, never Main data", async () => {
		const installation = registerDetachedEditor(() => DEFAULT_CONFIG, {
			gitRunner: {
				run: async () => {
					throw new Error("not a repository");
				},
			},
		});
		try {
			expect(await globals[DETACHED_EDITOR_KEY]?.readGit?.("/unknown")).toMatchObject({
				available: false,
				branch: null,
				refreshing: false,
			});
		} finally {
			installation.dispose();
		}
	});
});
