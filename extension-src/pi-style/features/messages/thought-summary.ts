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
	members: ThoughtMember[];
}

type ThoughtBinding = { group: ThoughtGroup; member: ThoughtMember };
type ThoughtMessageBinding = { readonly members: ThoughtBinding[] };

export interface ThoughtGroupPresentation {
	readonly ended: boolean;
	readonly leader: boolean;
	readonly count: number;
	readonly durationMs: number | undefined;
}

let memberByKey = new Map<string, ThoughtBinding>();
let bindingByInstance = new WeakMap<object, ThoughtMessageBinding>();
let entryKeyByMessage = new WeakMap<object, string>();
let knownInstances = new Set<object>();
let currentLiveGroup: ThoughtGroup | undefined;
let liveGroups: ThoughtGroup[] = [];
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
		: `message:${timestamp}:${model}`;
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
	return { id: `${prefix}:${++groupSequence}`, live, ended: false, members: [] };
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
		if (liveAgentActive && runs.hasVisibleText) closeCurrentLiveGroup();
		return [];
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

	for (let runIndex = 0; runIndex < runs.count; runIndex++) {
		const binding = messageBinding.members[runIndex];
		if (!binding) continue;
		binding.member.instances.add(instance);
		binding.member.complete = runs.complete[runIndex] === true;
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
}

/** Finalize all contiguous groups and rebuild every bound group leader. */
export function finishAgentThoughtRun(): void {
	const groups = liveGroups;
	liveAgentActive = false;
	currentLiveGroup = undefined;
	liveGroups = [];
	if (groups.length === 0) return;
	for (const group of groups) {
		group.live = false;
		group.ended = true;
	}
	refreshInstances(groups.flatMap((group) => group.members.flatMap((member) => [...member.instances])));
}

function refreshInstances(instances: readonly object[]): void {
	for (const instance of new Set(instances)) {
		const target = instance as AssistantTarget;
		if (typeof target.updateContent !== "function" || target.lastMessage === undefined) continue;
		try {
			target.updateContent(target.lastMessage, target.isStreaming);
		} catch {
			knownInstances.delete(instance);
		}
	}
}

/** Toggle every native thinking run in the clicked contiguous group. */
export function toggleThoughtGroup(instance: object, runIndex: number): boolean {
	const binding = bindingByInstance.get(instance)?.members[runIndex];
	if (!binding?.group.ended) return false;
	const instances = binding.group.members.flatMap((member) => [...member.instances]);
	let anyVisible = false;
	for (const member of binding.group.members) {
		for (const rawInstance of member.instances) {
			const target = rawInstance as AssistantTarget;
			const hidden = target.thinkingVisibilityOverrides?.get(member.runIndex) ?? target.hideThinkingBlock ?? false;
			if (!hidden) anyVisible = true;
		}
	}
	const expand = !anyVisible;
	let changed = false;
	for (const member of binding.group.members) {
		for (const rawInstance of member.instances) {
			const overrides = (rawInstance as AssistantTarget).thinkingVisibilityOverrides;
			if (!(overrides instanceof Map)) continue;
			overrides.set(member.runIndex, !expand);
			changed = true;
		}
	}
	if (changed) refreshInstances(instances);
	return changed;
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
	liveAgentActive = false;
	if (!Array.isArray(entries)) return;
	let group: ThoughtGroup | undefined;
	const closeGroup = () => {
		if (group) group.ended = true;
		group = undefined;
	};
	for (const entry of entries) {
		if (entry?.type !== "message") continue;
		const message = entry.message;
		if (message?.role === "user") {
			closeGroup();
			continue;
		}
		if (message?.role !== "assistant") continue;
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
			if (fallbackKey !== baseKey) memberByKey.set(runKey(fallbackKey, runIndex), binding);
			if (runs.breakAfter[runIndex]) closeGroup();
		}
	}
	closeGroup();
}

/** Refresh components retained across a session-tree/rebind registry rebuild. */
export function refreshObservedThoughtComponents(): void {
	refreshInstances([...knownInstances]);
}

/** Session/test reset. Process duration storage is owned separately. */
export function resetAgentThoughtRuns(): void {
	memberByKey.clear();
	bindingByInstance = new WeakMap();
	entryKeyByMessage = new WeakMap();
	knownInstances.clear();
	currentLiveGroup = undefined;
	liveGroups = [];
	liveAgentActive = false;
}
