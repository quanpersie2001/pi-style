// Cross-feature bridge for the merged turn-summary line
// (`◈ Thought N times · Called M tools · …`).
//
// depcruise forbids sibling-feature imports, so the tools-side turn registry
// (features/tools/boxed/turn-summary.ts) and the messages-side thought groups
// (features/messages/thought-summary.ts) meet here instead. This module is a
// pure data registry: it imports nothing and owns no rendering.
//
// Data flow (all publishers run BEFORE the consumers rebuild):
// - The turn registry publishes per-message tool stats (one assistant message
//   = one stats record covering exactly its tool calls) when a run finalizes
//   (`finishAgentRun`, restore rebuild).
// - The thought groups publish which messages belong to an ENDED segment
//   (`finishAgentThoughtRun`, restore rebuild).
// - The thought-segment leader label reads `mergedStatsFor(group.messages)`;
//   the tool dispatcher hides the run's `➔` leader when every message of the
//   run belongs to an ended segment (so the merged lines carry the counts).
//
// All maps are weak: records live exactly as long as the session's message
// objects, so session resets need no explicit clearing.

/** Tool-call stats attributed to one assistant message. */
export interface MergedSegmentStats {
	/** Tool calls of the message (all members, mutating and failed included). */
	readonly calls: number;
	/** Aggregate diff stats when any member carried them. */
	readonly diff?: { readonly additions: number; readonly removals: number };
	/** Failed members. */
	readonly failed: number;
}

const statsByMessage = new WeakMap<object, MergedSegmentStats>();
const endedGroupMessages = new WeakSet<object>();

/** Publish one assistant message's tool stats (turn registry, run finalize). */
export function publishMessageStats(message: object, stats: MergedSegmentStats): void {
	statsByMessage.set(message, stats);
}

/** Publish that an assistant message belongs to an ended thought segment. */
export function publishEndedGroupMessage(message: object): void {
	endedGroupMessages.add(message);
}

/** Combined stats across the messages a thought segment covers; undefined when
 *  none of them carried tool calls (the segment keeps its thought-only label). */
export function mergedStatsFor(messages: readonly object[]): MergedSegmentStats | undefined {
	let calls = 0;
	let failed = 0;
	let additions = 0;
	let removals = 0;
	let diffMembers = 0;
	let seen = 0;
	for (const message of messages) {
		const stats = statsByMessage.get(message);
		if (!stats) continue;
		seen++;
		calls += stats.calls;
		failed += stats.failed;
		if (stats.diff !== undefined) {
			additions += stats.diff.additions;
			removals += stats.diff.removals;
			diffMembers++;
		}
	}
	if (seen === 0) return undefined;
	return {
		calls,
		failed,
		...(diffMembers > 0 ? { diff: { additions, removals } } : {}),
	};
}

/** Whether every message of a run belongs to an ended thought group — the
 *  precondition for hiding the run's `➔` leader line in favor of the merged
 *  segment lines. Empty/undefined message lists keep their `➔` line. */
export function everyMessageInEndedGroup(messages: readonly object[] | undefined): boolean {
	if (!messages || messages.length === 0) return false;
	return messages.every((message) => endedGroupMessages.has(message));
}
