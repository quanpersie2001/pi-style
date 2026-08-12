import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { UsageSnapshot } from "../domain/status.js";

/**
 * Minimal structural view of Pi's session manager: only the entry iteration
 * needed to aggregate cumulative usage. `ExtensionContext.sessionManager`
 * satisfies this shape.
 */
export interface SessionUsageSource {
	getEntries(): readonly SessionEntry[];
}

interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

interface UsageContribution extends UsageTotals {
	sawUsage: boolean;
}

interface SessionUsageCacheState {
	processedLength: number;
	lastEntryId: string | undefined;
	lastEntryRef: SessionEntry | undefined;
	lastContribution: UsageContribution;
	totals: UsageTotals;
	cached: UsageSnapshot | undefined;
	scannedEntries: number;
	cacheHits: number;
	rebuilds: number;
	tailRefreshes: number;
}

export interface SessionUsageCacheStats {
	processedLength: number;
	scannedEntries: number;
	cacheHits: number;
	rebuilds: number;
	tailRefreshes: number;
}

let usageCache = new WeakMap<SessionUsageSource, SessionUsageCacheState>();

/**
 * Aggregate cumulative token/cost usage from finalized session entries,
 * mirroring Pi's native footer. The result is cached incrementally so repeated
 * reads only scan appended entries and refresh the finalized tail entry when it
 * changes in place.
 */
export function usageFromSession(session: SessionUsageSource): UsageSnapshot | undefined {
	const entries = session.getEntries();
	const state = usageCache.get(session) ?? createState();
	usageCache.set(session, state);

	if (entries.length === 0) {
		state.cacheHits++;
		state.processedLength = 0;
		state.lastEntryId = undefined;
		state.lastEntryRef = undefined;
		state.lastContribution = emptyContribution();
		state.totals = emptyTotals();
		state.cached = undefined;
		return undefined;
	}

	if (state.processedLength === 0) {
		rebuildFrom(entries, state);
		return state.cached;
	}

	if (entries.length < state.processedLength) {
		rebuildFrom(entries, state);
		return state.cached;
	}

	const currentLast = entries.at(-1);
	if (!currentLast) {
		state.cacheHits++;
		state.cached = undefined;
		return undefined;
	}

	if (entries.length === state.processedLength) {
		if (currentLast.id !== state.lastEntryId) {
			rebuildFrom(entries, state);
			return state.cached;
		}
		if (currentLast !== state.lastEntryRef) refreshTailEntry(currentLast, state);
		else state.cacheHits++;
		return state.cached;
	}

	const previousLast = entries[state.processedLength - 1];
	if (!previousLast || previousLast.id !== state.lastEntryId) {
		rebuildFrom(entries, state);
		return state.cached;
	}
	if (previousLast !== state.lastEntryRef) refreshTailEntry(previousLast, state);
	for (const entry of entries.slice(state.processedLength)) appendEntry(entry, state);
	return state.cached;
}

export function resetUsageFromSessionCache(session?: SessionUsageSource): void {
	if (session) {
		usageCache.delete(session);
		return;
	}
	usageCache = new WeakMap<SessionUsageSource, SessionUsageCacheState>();
}

export function getUsageFromSessionCacheStats(session: SessionUsageSource): SessionUsageCacheStats {
	const state = usageCache.get(session) ?? createState();
	if (!usageCache.has(session)) usageCache.set(session, state);
	return {
		processedLength: state.processedLength,
		scannedEntries: state.scannedEntries,
		cacheHits: state.cacheHits,
		rebuilds: state.rebuilds,
		tailRefreshes: state.tailRefreshes,
	};
}

function createState(): SessionUsageCacheState {
	return {
		processedLength: 0,
		lastEntryId: undefined,
		lastEntryRef: undefined,
		lastContribution: emptyContribution(),
		totals: emptyTotals(),
		cached: undefined,
		scannedEntries: 0,
		cacheHits: 0,
		rebuilds: 0,
		tailRefreshes: 0,
	};
}

function rebuildFrom(entries: readonly SessionEntry[], state: SessionUsageCacheState): void {
	state.rebuilds++;
	state.processedLength = 0;
	state.lastEntryId = undefined;
	state.lastEntryRef = undefined;
	state.lastContribution = emptyContribution();
	state.totals = emptyTotals();
	state.cached = undefined;
	for (const entry of entries) appendEntry(entry, state);
}

function refreshTailEntry(entry: SessionEntry, state: SessionUsageCacheState): void {
	state.tailRefreshes++;
	subtractContribution(state.totals, state.lastContribution);
	const contribution = usageContribution(entry);
	addContribution(state.totals, contribution);
	state.lastEntryId = entry.id;
	state.lastEntryRef = entry;
	state.lastContribution = contribution;
	state.cached = snapshotFromTotals(state.totals);
	state.scannedEntries++;
}

function appendEntry(entry: SessionEntry, state: SessionUsageCacheState): void {
	const contribution = usageContribution(entry);
	addContribution(state.totals, contribution);
	state.processedLength++;
	state.lastEntryId = entry.id;
	state.lastEntryRef = entry;
	state.lastContribution = contribution;
	state.cached = snapshotFromTotals(state.totals);
	state.scannedEntries++;
}

function usageContribution(entry: SessionEntry): UsageContribution {
	if (entry.type === "message") {
		if (entry.message.role !== "assistant" && entry.message.role !== "toolResult") return emptyContribution();
		const usage = "usage" in entry.message ? entry.message.usage : undefined;
		if (!usage) return emptyContribution();
		return {
			input: usage.input,
			output: usage.output,
			cacheRead: usage.cacheRead,
			cacheWrite: usage.cacheWrite,
			cost: usage.cost.total,
			sawUsage: true,
		};
	}
	if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
		return {
			input: entry.usage.input,
			output: entry.usage.output,
			cacheRead: entry.usage.cacheRead,
			cacheWrite: entry.usage.cacheWrite,
			cost: entry.usage.cost.total,
			sawUsage: true,
		};
	}
	return emptyContribution();
}

function snapshotFromTotals(totals: UsageTotals): UsageSnapshot | undefined {
	if (
		totals.input === 0 &&
		totals.output === 0 &&
		totals.cacheRead === 0 &&
		totals.cacheWrite === 0 &&
		totals.cost === 0
	)
		return undefined;
	return {
		inputTokens: totals.input,
		outputTokens: totals.output,
		cacheReadTokens: totals.cacheRead,
		cacheWriteTokens: totals.cacheWrite,
		cost: totals.cost,
		subscriptionMode: "unknown",
		streaming: false,
	};
}

function addContribution(totals: UsageTotals, usage: UsageContribution): void {
	totals.input += usage.input;
	totals.output += usage.output;
	totals.cacheRead += usage.cacheRead;
	totals.cacheWrite += usage.cacheWrite;
	totals.cost += usage.cost;
}

function subtractContribution(totals: UsageTotals, usage: UsageContribution): void {
	totals.input -= usage.input;
	totals.output -= usage.output;
	totals.cacheRead -= usage.cacheRead;
	totals.cacheWrite -= usage.cacheWrite;
	totals.cost -= usage.cost;
}

function emptyTotals(): UsageTotals {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

function emptyContribution(): UsageContribution {
	return { ...emptyTotals(), sawUsage: false };
}
