import { type MergedSegmentStats, mergedStatsFor, publishEndedGroupMessage } from "../../shared/turn-summary-bridge.js";

export interface ThinkingRuns {
	readonly count: number;
	readonly complete: boolean[];
	readonly texts: string[];
	/** Substantive assistant text before this run starts a new visual segment. */
	readonly breakBefore: boolean[];
	/** Substantive assistant text after this run closes its visual segment. */
	readonly breakAfter: boolean[];
	readonly hasVisibleText: boolean;
}

/**
 * Native thinking-run layout: maximal runs of consecutive non-empty thinking
 * blocks. Tool calls close a native run but do not split its visual aggregate;
 * substantive assistant text does both.
 */
export function parseThinkingRuns(message: unknown, streaming: boolean): ThinkingRuns {
	const complete: boolean[] = [];
	const texts: string[] = [];
	const breakBefore: boolean[] = [];
	const breakAfter: boolean[] = [];
	const content = (message as { content?: unknown } | undefined)?.content;
	if (!Array.isArray(content)) {
		return { count: 0, complete, texts, breakBefore, breakAfter, hasVisibleText: false };
	}
	let openRun = -1;
	let lastRun = -1;
	let openText = "";
	let pendingTextBoundary = false;
	let hasVisibleText = false;
	const stopReason = (message as { stopReason?: unknown } | undefined)?.stopReason;
	const closeRun = () => {
		if (openRun < 0) return;
		texts[openRun] = openText;
		openRun = -1;
		openText = "";
	};
	for (const rawBlock of content) {
		const block = rawBlock as { type?: unknown; thinking?: unknown; text?: unknown } | undefined;
		if (!block || typeof block !== "object") continue;
		if (block.type === "thinking") {
			if (typeof block.thinking === "string" && block.thinking.trim() !== "") {
				if (openRun < 0) {
					openRun = complete.length;
					lastRun = openRun;
					complete.push(false);
					texts.push("");
					breakBefore.push(pendingTextBoundary);
					breakAfter.push(false);
					pendingTextBoundary = false;
				}
				openText = openText === "" ? block.thinking : `${openText}\n\n${block.thinking}`;
			}
			continue;
		}
		if (block.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
			hasVisibleText = true;
			if (openRun >= 0) {
				complete[openRun] = true;
				closeRun();
			}
			if (lastRun >= 0) breakAfter[lastRun] = true;
			pendingTextBoundary = true;
			continue;
		}
		if (block.type === "toolCall" && openRun >= 0) {
			complete[openRun] = true;
			closeRun();
		}
	}
	if (openRun >= 0 && (!streaming || stopReason)) {
		complete[openRun] = true;
		closeRun();
	} else if (openRun >= 0) {
		texts[openRun] = openText;
	}
	return { count: complete.length, complete, texts, breakBefore, breakAfter, hasVisibleText };
}

interface AssistantTarget {
	hideThinkingBlock?: boolean;
	thinkingVisibilityOverrides?: Map<number, boolean>;
	lastMessage?: unknown;
	isStreaming?: boolean;
	updateContent?: (message: unknown, isStreaming?: boolean) => unknown;
}

interface ThoughtMember {
	readonly key: string;
	readonly runIndex: number;
	duration: number | undefined;
	complete: boolean;
	readonly instances: Set<object>;
}

interface ThoughtGroup {
	readonly id: string;
	live: boolean;
	ended: boolean;
	/** Run-level merge: first group of the batch renders the single run line. */
	runFirst?: boolean;
	/** Run-total stats pooled across every group of the batch (leader only). */
	runStats?: MergedSegmentStats | undefined;
	/** Run-total thought count across every group of the batch (leader only). */
	runTotalThoughts?: number;
	/** The disclosure is run-wide even when assistant commentary splits groups. */
	runGroups?: readonly ThoughtGroup[];
	runMessages?: readonly object[];
	members: ThoughtMember[];
	/** Assistant messages whose thinking runs joined this group (identity).
	 *  Feeds the merged-summary bridge: the leader label aggregates the tool
	 *  stats published for exactly these messages. */
	readonly messages: Set<object>;
}

type ThoughtBinding = { group: ThoughtGroup; member: ThoughtMember };
type ThoughtMessageBinding = { readonly members: ThoughtBinding[] };

export interface ThoughtGroupPresentation {
	readonly ended: boolean;
	readonly leader: boolean;
	readonly count: number;
	readonly durationMs: number | undefined;
	/** Merged tool stats for the messages this segment covers (undefined when
	 *  the segment produced no tool calls — the label stays thought-only). */
	readonly stats: MergedSegmentStats | undefined;
	/** Run-level merge: this group's leader renders the single run line. */
	readonly runFirst: boolean;
	readonly runStats: MergedSegmentStats | undefined;
	readonly runTotalThoughts: number | undefined;
	/** Whole-run messages after finalize, otherwise this group's messages.
	 * Consumed by the merged leader to control every run tool with thinking. */
	readonly messages: readonly object[];
}

let memberByKey = new Map<string, ThoughtBinding>();
let bindingByInstance = new WeakMap<object, ThoughtMessageBinding>();
let entryKeyByMessage = new WeakMap<object, string>();
let knownInstances = new Set<object>();
let instanceOrder = new WeakMap<object, number>();
let instanceSequence = 0;
let currentLiveGroup: ThoughtGroup | undefined;
let liveGroups: ThoughtGroup[] = [];
let liveMessages = new Set<object>();
let liveAgentActive = false;
let groupSequence = 0;

function contentSignature(message: unknown): string {
	const content = (message as { content?: unknown } | undefined)?.content;
	if (!Array.isArray(content)) return "empty";
	let signature = "";
	for (const raw of content) {
		const block = raw as { type?: unknown; id?: unknown; thinking?: unknown; text?: unknown } | undefined;
		if (!block || typeof block !== "object") continue;
		if (block.type === "toolCall" && typeof block.id === "string") return `tool:${block.id}`;
		const text = block.type === "thinking" ? block.thinking : block.type === "text" ? block.text : undefined;
		if (typeof text === "string") signature += `${String(block.type)}:${text.length}:${text.slice(0, 24)};`;
	}
	return signature || "content";
}

function fallbackMessageKey(message: unknown): string {
	const candidate = message as { timestamp?: unknown; model?: unknown } | undefined;
	const timestamp =
		typeof candidate?.timestamp === "number" || typeof candidate?.timestamp === "string"
			? String(candidate.timestamp)
			: undefined;
	const model = typeof candidate?.model === "string" ? candidate.model : "model";
	return timestamp === undefined
		? `message:unknown:${model}:${contentSignature(message)}`
		: `message:${timestamp}:${model}:${contentSignature(message)}`;
}

function messageKey(message: unknown): string {
	if (message && typeof message === "object") {
		const entryKey = entryKeyByMessage.get(message);
		if (entryKey) return entryKey;
	}
	return fallbackMessageKey(message);
}

function runKey(baseKey: string, runIndex: number): string {
	return `${baseKey}#${runIndex}`;
}

function createGroup(live: boolean, prefix: string): ThoughtGroup {
	return { id: `${prefix}:${++groupSequence}`, live, ended: false, members: [], messages: new Set() };
}

function appendMember(group: ThoughtGroup, baseKey: string, runIndex: number, complete: boolean): ThoughtBinding {
	const member: ThoughtMember = {
		key: runKey(baseKey, runIndex),
		runIndex,
		duration: undefined,
		complete,
		instances: new Set(),
	};
	group.members.push(member);
	const binding = { group, member };
	memberByKey.set(member.key, binding);
	return binding;
}

function presentation(binding: ThoughtBinding): ThoughtGroupPresentation {
	const { group, member } = binding;
	let durationMs = 0;
	let completeDuration = group.members.length > 0;
	for (const candidate of group.members) {
		if (candidate.duration === undefined) completeDuration = false;
		else durationMs += candidate.duration;
	}
	return {
		ended: group.ended,
		leader: group.members[0] === member,
		count: group.members.length,
		durationMs: completeDuration ? durationMs : undefined,
		stats: mergedStatsFor([...group.messages]),
		runFirst: group.runFirst === true,
		runStats: group.runStats,
		runTotalThoughts: group.runTotalThoughts,
		messages: group.runMessages ?? [...group.messages],
	};
}

function closeCurrentLiveGroup(): void {
	currentLiveGroup = undefined;
}

function createLiveBinding(baseKey: string, runIndex: number, runs: ThinkingRuns): ThoughtBinding {
	if (runs.breakBefore[runIndex]) closeCurrentLiveGroup();
	if (!currentLiveGroup) {
		currentLiveGroup = createGroup(true, "live");
		liveGroups.push(currentLiveGroup);
	}
	const binding = appendMember(currentLiveGroup, baseKey, runIndex, runs.complete[runIndex] === true);
	if (runs.breakAfter[runIndex]) closeCurrentLiveGroup();
	return binding;
}

function createStandaloneBinding(
	baseKey: string,
	runIndex: number,
	runs: ThinkingRuns,
	previous: ThoughtBinding | undefined,
): ThoughtBinding {
	const group =
		!runs.breakBefore[runIndex] && previous && !runs.breakAfter[runIndex - 1]
			? previous.group
			: createGroup(false, "standalone");
	return appendMember(group, baseKey, runIndex, runs.complete[runIndex] === true);
}

function createStandaloneBindings(baseKey: string, runs: ThinkingRuns): ThoughtBinding[] {
	const bindings: ThoughtBinding[] = [];
	for (let runIndex = 0; runIndex < runs.count; runIndex++) {
		bindings.push(createStandaloneBinding(baseKey, runIndex, runs, bindings[runIndex - 1]));
	}
	return bindings;
}

/** Observe one assistant component after native updateContent rebuilt its children. */
export function observeThoughtMessage(
	instance: object,
	message: unknown,
	runs: ThinkingRuns,
	durations: readonly (number | undefined)[],
): ThoughtGroupPresentation[] {
	if (runs.count === 0) {
		// Global native visibility changes also rebuild historical messages.
		// Only a streaming/currently attributed message may split this run.
		const currentMessage = message !== null && typeof message === "object" && liveMessages.has(message);
		if (liveAgentActive && runs.hasVisibleText && ((instance as AssistantTarget).isStreaming || currentMessage)) {
			closeCurrentLiveGroup();
		}
		return [];
	}
	let order = instanceOrder.get(instance);
	if (order === undefined) {
		order = ++instanceSequence;
		instanceOrder.set(instance, order);
	}
	let messageBinding = bindingByInstance.get(instance);
	if (!messageBinding) {
		const baseKey = messageKey(message);
		const members: Array<ThoughtBinding | undefined> = [];
		for (let runIndex = 0; runIndex < runs.count; runIndex++) {
			const existing = memberByKey.get(runKey(baseKey, runIndex));
			members.push(existing ?? (liveAgentActive ? createLiveBinding(baseKey, runIndex, runs) : undefined));
		}
		const missingStandalone = members.some((binding) => binding === undefined);
		const resolved = missingStandalone
			? createStandaloneBindings(baseKey, runs)
			: members.filter((binding): binding is ThoughtBinding => binding !== undefined);
		// Registry rebuilds retain ancestor components for refresh, but fresh
		// replacements may already have bound. Never let an older retained
		// component steal those bindings back during the refresh pass.
		if (
			resolved.some((binding) =>
				[...binding.member.instances].some((peer) => (instanceOrder.get(peer) ?? 0) > (order ?? 0)),
			)
		) {
			knownInstances.delete(instance);
			return resolved.map(presentation);
		}
		messageBinding = { members: resolved };
		bindingByInstance.set(instance, messageBinding);
		knownInstances.add(instance);
	}

	// A streaming message can gain another native run after its first binding.
	const baseKey = messageKey(message);
	for (let runIndex = messageBinding.members.length; runIndex < runs.count; runIndex++) {
		const existing = memberByKey.get(runKey(baseKey, runIndex));
		const binding = existing ?? (liveAgentActive ? createLiveBinding(baseKey, runIndex, runs) : undefined);
		if (binding) messageBinding.members.push(binding);
		else {
			messageBinding.members.push(
				createStandaloneBinding(baseKey, runIndex, runs, messageBinding.members[runIndex - 1]),
			);
		}
	}

	// Attribute the message to every group it feeds (idempotent; Set). This is
	// what lets the merged label aggregate exactly this message's tool stats.
	if (message !== null && typeof message === "object") {
		for (const binding of messageBinding.members) binding.group.messages.add(message);
		// An old component refreshed by Ctrl+T must not contribute its tools to
		// the new request. Bindings, not the time of a UI refresh, define ownership.
		if (liveAgentActive && messageBinding.members.some((binding) => binding.group.live)) liveMessages.add(message);
	}

	for (let runIndex = 0; runIndex < runs.count; runIndex++) {
		const binding = messageBinding.members[runIndex];
		if (!binding) continue;
		// A chat rebuild replaces the native component for this thinking run.
		// Detached predecessors must not vote on disclosure state or be refreshed
		// back into the group (an old open override otherwise defeats re-close).
		for (const previous of binding.member.instances) {
			if (previous === instance) continue;
			knownInstances.delete(previous);
			bindingByInstance.delete(previous);
		}
		binding.member.instances.clear();
		binding.member.instances.add(instance);
		binding.member.complete = runs.complete[runIndex] === true;
		// Final message content may differ from its streaming key. Bind that
		// stable signature too so a same-process component rebuild finds the run.
		if (binding.member.complete) memberByKey.set(runKey(baseKey, runIndex), binding);
		if (durations[runIndex] !== undefined) binding.member.duration = durations[runIndex];
		if (liveAgentActive && runs.breakAfter[runIndex] && currentLiveGroup === binding.group) {
			closeCurrentLiveGroup();
		}
	}
	for (const binding of messageBinding.members) {
		if (!binding.group.live && binding.group.members.every((member) => member.complete)) {
			binding.group.ended = true;
		}
	}
	return messageBinding.members.map(presentation);
}

/** Start grouping assistant thinking messages for one user request. */
export function beginAgentThoughtRun(): void {
	// Fail closed if a host starts another request without delivering agent_end:
	// finalize the prior groups rather than orphaning zero-trace labels forever.
	if (liveAgentActive) finishAgentThoughtRun();
	liveAgentActive = true;
	currentLiveGroup = undefined;
	liveGroups = [];
	liveMessages = new Set();
}

/** Finalize all contiguous groups and rebuild every bound group leader.
 *
 * Run-level merge: all groups of the batch (one agent run) pool their stats —
 * the FIRST group's leader renders the single run line (`◈ Thought N times ·
 * Called M tools` with run totals); every later group leader stays zero-trace
 * (its thinking remains reachable via the run click and Ctrl+T). This keeps inter-round
 * commentary from fragmenting the summary into per-segment labels. */
export function finishAgentThoughtRun(): void {
	const groups = liveGroups;
	const messages = [...liveMessages];
	liveAgentActive = false;
	currentLiveGroup = undefined;
	liveGroups = [];
	liveMessages = new Set();
	finalizeRunGroups(groups, messages);
	refreshInstances(groups.flatMap((group) => group.members.flatMap((member) => [...member.instances])));
}

function finalizeRunGroups(groups: readonly ThoughtGroup[], messages: readonly object[]): void {
	if (groups.length === 0) return; // Tools-only runs keep their own ◈ disclosure.
	const runMessages = [...new Set([...messages, ...groups.flatMap((group) => [...group.messages])])];
	const runThoughts = groups.reduce((count, group) => count + group.members.length, 0);
	const runStats = mergedStatsFor(runMessages);
	for (const message of runMessages) publishEndedGroupMessage(message);
	for (const [index, group] of groups.entries()) {
		group.live = false;
		group.ended = true;
		group.runGroups = groups;
		group.runMessages = runMessages;
		group.runFirst = index === 0;
		group.runStats = runStats;
		group.runTotalThoughts = runThoughts;
	}
}

function refreshInstances(instances: readonly object[]): void {
	for (const instance of new Set(instances)) {
		if (!knownInstances.has(instance)) continue;
		const target = instance as AssistantTarget;
		if (typeof target.updateContent !== "function" || target.lastMessage === undefined) continue;
		try {
			target.updateContent(target.lastMessage, target.isStreaming);
		} catch {
			knownInstances.delete(instance);
		}
	}
}

function toggleMembers(instance: object, runIndex: number, wholeRun: boolean): readonly ThoughtMember[] {
	const group = bindingByInstance.get(instance)?.members[runIndex]?.group;
	if (!group?.ended) return [];
	return (wholeRun ? (group.runGroups ?? [group]) : [group]).flatMap((candidate) => candidate.members);
}

export function isThoughtGroupExpanded(instance: object, runIndex: number, wholeRun = false): boolean {
	return toggleMembers(instance, runIndex, wholeRun).some((member) =>
		[...member.instances].some((raw) => {
			const target = raw as AssistantTarget;
			return !(target.thinkingVisibilityOverrides?.get(member.runIndex) ?? target.hideThinkingBlock ?? false);
		}),
	);
}

/** Explicitly set all runs of a segment, or the entire merged agent run. */
export function setThoughtGroupOpen(instance: object, runIndex: number, open: boolean, wholeRun = false): boolean {
	const members = toggleMembers(instance, runIndex, wholeRun);
	let changed = false;
	for (const member of members) {
		for (const raw of member.instances) {
			const target = raw as AssistantTarget;
			if (target.thinkingVisibilityOverrides instanceof Map) {
				target.thinkingVisibilityOverrides.set(member.runIndex, !open);
			} else {
				// Older native components have only message-wide thinking visibility.
				target.hideThinkingBlock = !open;
			}
			changed = true;
		}
	}
	if (changed) refreshInstances(members.flatMap((member) => [...member.instances]));
	return changed;
}

/** Plain labels stay segment-local; merged labels opt into the entire run. */
export function toggleThoughtGroup(instance: object, runIndex: number, wholeRun = false): boolean {
	return setThoughtGroupOpen(instance, runIndex, !isThoughtGroupExpanded(instance, runIndex, wholeRun), wholeRun);
}

interface EntryLike {
	readonly id?: unknown;
	readonly type?: unknown;
	readonly message?: { readonly role?: unknown };
}

/** Rebuild historical contiguous groups, split only by substantive assistant text. */
export function rebuildAgentThoughtRunsFromEntries(entries: readonly EntryLike[] | undefined): void {
	const previousInstances = [...knownInstances];
	memberByKey = new Map();
	bindingByInstance = new WeakMap();
	entryKeyByMessage = new WeakMap();
	knownInstances = new Set(previousInstances);
	currentLiveGroup = undefined;
	liveGroups = [];
	liveMessages = new Set();
	liveAgentActive = false;
	if (!Array.isArray(entries)) return;
	let group: ThoughtGroup | undefined;
	let batch: ThoughtGroup[] = [];
	let batchMessages: object[] = [];
	const closeGroup = () => {
		if (group) {
			group.ended = true;
			batch.push(group);
			// Restore-path twin of finishAgentThoughtRun's publication.
			for (const message of group.messages) publishEndedGroupMessage(message);
		}
		group = undefined;
	};
	const closeBatch = () => {
		finalizeRunGroups(batch, batchMessages);
		batch = [];
		batchMessages = [];
	};
	for (const entry of entries) {
		if (entry?.type !== "message") continue;
		const message = entry.message;
		if (message?.role === "user") {
			closeGroup();
			// A user message ends the agent-run batch: pool its groups' stats
			// into the first group's run line (restore twin of finishAgentThoughtRun).
			closeBatch();
			continue;
		}
		if (message?.role !== "assistant") continue;
		batchMessages.push(message);
		if (message && typeof message === "object" && typeof entry.id === "string") {
			entryKeyByMessage.set(message, `entry:${entry.id}`);
		}
		const runs = parseThinkingRuns(message, false);
		if (runs.count === 0) {
			if (runs.hasVisibleText) closeGroup();
			continue;
		}
		const baseKey = messageKey(message);
		const fallbackKey = fallbackMessageKey(message);
		for (let runIndex = 0; runIndex < runs.count; runIndex++) {
			if (runs.breakBefore[runIndex]) closeGroup();
			group ??= createGroup(false, "history");
			const binding = appendMember(group, baseKey, runIndex, true);
			if (message !== null && typeof message === "object") group.messages.add(message);
			if (fallbackKey !== baseKey) memberByKey.set(runKey(fallbackKey, runIndex), binding);
			if (runs.breakAfter[runIndex]) closeGroup();
		}
	}
	closeGroup();
	closeBatch();
}

/** Refresh components retained across a session-tree/rebind registry rebuild. */
export function refreshObservedThoughtComponents(): void {
	refreshInstances([...knownInstances]);
}

/** Refresh only the components of segments covering `message` — the turn_end
 *  path: newly published stats must reach exactly those labels (a full
 *  refresh would rebuild every observed component on every turn). */
export function refreshThoughtComponentsForMessage(message: unknown): void {
	if (message === null || typeof message !== "object") return;
	const instances = new Set<object>();
	for (const binding of memberByKey.values()) {
		if (!binding.group.messages.has(message)) continue;
		for (const member of binding.group.members) for (const instance of member.instances) instances.add(instance);
	}
	if (instances.size > 0) refreshInstances([...instances]);
}

/** Event-path attribution for the current request, including thinking-less
 * continuations/tools before its first thought. Never borrow a prior request's
 * group. Messages without a group still enter the run-wide finalize pool. */
export function attributeMessageToLatestGroup(message: unknown): boolean {
	if (!liveAgentActive || message === null || typeof message !== "object") return false;
	// Track tools-before-thinking as well; finalizeRunGroups pools every message
	// of THIS run. Never borrow a group from a previous user request.
	liveMessages.add(message);
	for (const group of liveGroups) if (group.messages.has(message)) return true;
	const runs = parseThinkingRuns(message, false);
	if (runs.count === 0 && runs.hasVisibleText) closeCurrentLiveGroup();
	const latest = liveGroups.at(-1);
	if (!latest) return false;
	latest.messages.add(message);
	return true;
}

/** Session/test reset. Process duration storage is owned separately. */
export function resetAgentThoughtRuns(): void {
	memberByKey.clear();
	bindingByInstance = new WeakMap();
	entryKeyByMessage = new WeakMap();
	knownInstances.clear();
	instanceOrder = new WeakMap();
	instanceSequence = 0;
	currentLiveGroup = undefined;
	liveGroups = [];
	liveMessages = new Set();
	liveAgentActive = false;
}
