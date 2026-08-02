import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
	ContextProvider,
	GitCommandResult,
	GitCommandRunner,
	GitProvider,
	UsageProvider,
} from "../domain/providers.js";
import type { ContextSnapshot, GitSnapshot, UsageSnapshot } from "../domain/status.js";

const execFileAsync = promisify(execFile);
const EMPTY_USAGE: UsageSnapshot = Object.freeze({
	inputTokens: 0,
	outputTokens: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
	streaming: false,
	subscriptionMode: "unknown",
});

export class NodeGitCommandRunner implements GitCommandRunner {
	async run(args: readonly string[], cwd: string, timeoutMs: number): Promise<GitCommandResult> {
		try {
			const result = await execFileAsync("git", [...args], { cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024 });
			return { stdout: result.stdout, stderr: result.stderr, code: 0 };
		} catch (error) {
			const failure = error as { stdout?: string; stderr?: string; code?: number };
			return { stdout: failure.stdout ?? "", stderr: failure.stderr ?? "", code: failure.code ?? 1 };
		}
	}
}

interface GitEntry {
	value: GitSnapshot;
	expiresAt: number;
	promise?: Promise<GitSnapshot>;
}

export class CachedGitProvider implements GitProvider {
	private readonly cache = new Map<string, GitEntry>();
	private disposed = false;
	constructor(
		private readonly runner: GitCommandRunner = new NodeGitCommandRunner(),
		private readonly ttlMs = 1000,
		private readonly timeoutMs = 800,
	) {}
	async get(cwd: string): Promise<GitSnapshot> {
		if (this.disposed) return unavailableGit("provider disposed");
		const current = this.cache.get(cwd);
		if (current && current.expiresAt > Date.now()) return current.value;
		if (current?.promise) return current.promise;
		const stale = current?.value;
		const promise = this.refresh(cwd, stale);
		this.cache.set(cwd, { value: stale ?? refreshingGit(), expiresAt: Date.now() + this.ttlMs, promise });
		return promise;
	}
	invalidate(cwd?: string): void {
		if (cwd === undefined) this.cache.clear();
		else this.cache.delete(cwd);
	}
	dispose(): void {
		this.disposed = true;
		this.cache.clear();
	}
	private async refresh(cwd: string, stale?: GitSnapshot): Promise<GitSnapshot> {
		const result = await this.runner.run(["status", "--porcelain=v1", "--branch"], cwd, this.timeoutMs);
		if (result.code !== 0) {
			const value = stale
				? { ...stale, refreshing: false, error: result.stderr.trim() || "git status failed" }
				: unavailableGit(result.stderr.trim() || "git status failed");
			this.cache.set(cwd, { value, expiresAt: Date.now() + this.ttlMs });
			return value;
		}
		const value = parseGitStatus(result.stdout);
		this.cache.set(cwd, { value, expiresAt: Date.now() + this.ttlMs });
		return value;
	}
}

function refreshingGit(): GitSnapshot {
	return Object.freeze({ available: false, branch: null, staged: 0, unstaged: 0, untracked: 0, refreshing: true });
}
function unavailableGit(error: string): GitSnapshot {
	return Object.freeze({
		available: false,
		branch: null,
		staged: 0,
		unstaged: 0,
		untracked: 0,
		refreshing: false,
		error,
	});
}
export function parseGitStatus(output: string): GitSnapshot {
	const lines = output.split("\n").filter(Boolean);
	const header = lines.find((line) => line.startsWith("## "))?.slice(3) ?? "";
	if (!header) return unavailableGit("not a git repository");
	const branch = header.split("...")[0]?.replace(/^HEAD \(no branch\)$/, "detached") ?? null;
	let staged = 0;
	let unstaged = 0;
	let untracked = 0;
	for (const line of lines) {
		if (line.startsWith("## ")) continue;
		if (line.startsWith("??")) {
			untracked++;
			continue;
		}
		if (line.length < 2) continue;
		if (line[0] !== " ") staged++;
		if (line[1] !== " ") unstaged++;
	}
	const ahead = /\[ahead (\d+)\]/.exec(header)?.[1];
	const behind = /\[behind (\d+)\]/.exec(header)?.[1];
	return Object.freeze({
		available: true,
		branch: branch || null,
		staged,
		unstaged,
		untracked,
		...(ahead ? { ahead: Number(ahead) } : {}),
		...(behind ? { behind: Number(behind) } : {}),
		refreshing: false,
	});
}

export class InMemoryUsageProvider implements UsageProvider {
	private readonly values = new Map<string, UsageSnapshot>();
	private readonly events = new Map<string, Set<string>>();
	get(sessionId: string): UsageSnapshot {
		return this.values.get(sessionId) ?? EMPTY_USAGE;
	}
	record(
		sessionId: string,
		usage: Partial<UsageSnapshot>,
		options: { eventId?: string; finalized?: boolean } = {},
	): void {
		if (options.eventId) {
			const ids = this.events.get(sessionId) ?? new Set<string>();
			if (ids.has(options.eventId)) return;
			ids.add(options.eventId);
			this.events.set(sessionId, ids);
		}
		const current = this.get(sessionId);
		const next = {
			...current,
			...usage,
			streaming: options.finalized ? false : (usage.streaming ?? current.streaming),
		};
		this.values.set(sessionId, Object.freeze(next));
	}
	reset(sessionId?: string): void {
		if (sessionId === undefined) {
			this.values.clear();
			this.events.clear();
			return;
		}
		this.values.delete(sessionId);
		this.events.delete(sessionId);
	}
}

export class InMemoryContextProvider implements ContextProvider {
	private readonly values = new Map<string, ContextSnapshot>();
	get(sessionId: string): ContextSnapshot | undefined {
		return this.values.get(sessionId);
	}
	set(sessionId: string, context: ContextSnapshot): void {
		this.values.set(sessionId, Object.freeze({ ...context }));
	}
	clear(sessionId?: string): void {
		if (sessionId === undefined) this.values.clear();
		else this.values.delete(sessionId);
	}
}
