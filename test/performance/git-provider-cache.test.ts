import { describe, expect, it } from "vitest";
import { CachedGitProvider, NodeGitCommandRunner } from "../../extension-src/pi-style/app/providers.js";

const ok = { stdout: "## main\n", stderr: "", code: 0 };
function makeClock() {
	let value = 0;
	return {
		clock: { now: () => value },
		advance: (amount: number) => {
			value += amount;
		},
	};
}

describe("Git provider cache behavior", () => {
	it("returns fresh cache identity without a second runner call", async () => {
		let calls = 0;
		const provider = new CachedGitProvider(
			{
				run: async () => {
					calls++;
					return ok;
				},
			},
			1000,
		);
		const first = await provider.get("/repo");
		const second = await provider.get("/repo");
		expect(second).toBe(first);
		expect(calls).toBe(1);
		expect(provider.stats).toMatchObject({ entries: 1, inFlight: 0, refreshes: 1, disposed: false });
	});

	it("serves stale identity while exactly one refresh runs", async () => {
		const { clock, advance } = makeClock();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let calls = 0;
		const provider = new CachedGitProvider(
			{
				run: async () => {
					calls++;
					if (calls > 1) await gate;
					return ok;
				},
			},
			10,
			800,
			5000,
			clock,
		);
		const initial = await provider.get("/repo");
		advance(11);
		const stale = await provider.get("/repo");
		expect(stale).not.toBe(initial);
		expect(stale.branch).toBe("main");
		expect(stale.refreshing).toBe(true);
		expect(await provider.get("/repo")).toBe(stale);
		expect(calls).toBe(2);
		release();
		await viWait();
		expect(provider.stats.inFlight).toBe(0);
	});

	it("backs off errors and retries after the injected clock advances", async () => {
		const { clock, advance } = makeClock();
		let calls = 0;
		const provider = new CachedGitProvider(
			{
				run: async () => {
					calls++;
					return { stdout: "", stderr: "timeout", code: 124 };
				},
			},
			10,
			800,
			100,
			clock,
		);
		const first = await provider.get("/repo");
		expect(first.error).toBe("timeout");
		await provider.get("/repo");
		expect(calls).toBe(1);
		advance(100);
		await provider.get("/repo");
		expect(calls).toBe(2);
	});

	it("invalidates an existing entry but does not create work for an absent cwd", async () => {
		let calls = 0;
		const provider = new CachedGitProvider({
			run: async () => {
				calls++;
				return ok;
			},
		});
		provider.invalidate("/missing");
		expect(provider.stats).toMatchObject({ entries: 0, inFlight: 0 });
		await provider.get("/repo");
		provider.invalidate("/repo");
		expect(provider.stats.entries).toBe(0);
		expect(calls).toBe(1);
	});

	it("restarts invalidated refresh with an authoritative replacement result", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let calls = 0;
		const provider = new CachedGitProvider({
			run: async () => {
				calls++;
				if (calls === 1) {
					await gate;
					return { stdout: "## stale\n", stderr: "", code: 0 };
				}
				return { stdout: "## replacement\n", stderr: "", code: 0 };
			},
		});
		const first = provider.get("/repo");
		provider.invalidate("/repo");
		release();
		await first;
		await viWait();
		const replacement = await provider.get("/repo");
		expect(calls).toBe(2);
		expect(replacement.branch).toBe("replacement");
		expect(replacement.refreshing).toBe(false);
		expect(provider.stats).toMatchObject({ entries: 1, inFlight: 0, refreshes: 2 });
	});

	it("aborts an in-flight command, leaves no entries, and ignores late completion", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let signal!: AbortSignal;
		const provider = new CachedGitProvider({
			run: async (_args, _cwd, _timeout, provided) => {
				if (!provided) throw new Error("missing abort signal");
				signal = provided;
				await gate;
				return ok;
			},
		});
		const flight = provider.get("/repo");
		provider.dispose();
		expect(signal.aborted).toBe(true);
		release();
		await flight;
		expect(provider.stats).toMatchObject({ entries: 0, inFlight: 0, disposed: true });
	});

	it("represents an already-aborted Node runner signal as a failed command", async () => {
		const controller = new AbortController();
		controller.abort();
		const result = await new NodeGitCommandRunner().run(["--version"], process.cwd(), 100, controller.signal);
		expect(result.code).not.toBe(0);
		expect(result.stderr.length + result.stdout.length).toBeGreaterThan(0);
	});
});

async function viWait(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}
