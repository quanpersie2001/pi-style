import { visibleWidth } from "../../shared/ansi.js";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";
type OscParts = { start: string; body: string; end: string };
type LineAnalysis = {
	visibleWidth: number;
	hasContent: boolean;
	oscEnvelope: OscParts | undefined;
	hasOscStart: boolean;
	leadingMarkers: { head: string; rest: string };
	isBackgroundWrapped: boolean;
	backgroundAnsi: string;
	backgroundBody: string | undefined;
	backgroundBodyWidth: number | undefined;
};
type DecoratedRenderCacheEntry = {
	nativeRef: readonly string[];
	nativeLines: readonly string[];
	result: readonly string[];
};
type MessageDecorationTestState = {
	decoratePasses: number;
	cacheHits: number;
	cacheMisses: number;
	lineCacheHits: number;
	lineCacheMisses: number;
};

const BG_RESET = "\x1b[49m";
const MAX_RENDER_CACHE_KEYS_PER_INSTANCE = 8;
const MAX_LINE_ANALYSIS_ENTRIES = 4096;

let renderCacheByInstance = new WeakMap<object, Map<string, DecoratedRenderCacheEntry>>();
let lineAnalysisCache = new Map<string, LineAnalysis>();
const messageDecorationTestState: MessageDecorationTestState = {
	decoratePasses: 0,
	cacheHits: 0,
	cacheMisses: 0,
	lineCacheHits: 0,
	lineCacheMisses: 0,
};

function extractOscEnvelope(line: string): OscParts | undefined {
	if (!line.startsWith(OSC133_ZONE_START)) return undefined;
	const bodyEnd = line.indexOf(OSC133_ZONE_END, OSC133_ZONE_START.length);
	if (bodyEnd < 0 || !line.endsWith(OSC133_ZONE_FINAL)) return undefined;
	return { start: OSC133_ZONE_START, body: line.slice(OSC133_ZONE_START.length, bodyEnd), end: line.slice(bodyEnd) };
}

/** Leading zero-width OSC sequences (e.g. OSC133 markers) of a line. */
function splitLeadingMarkers(line: string): { head: string; rest: string } {
	let index = 0;
	while (line.startsWith("\x1b]", index)) {
		const bel = line.indexOf("\x07", index + 2);
		const st = line.indexOf("\x1b\\", index + 2);
		const end = bel === -1 ? st : st === -1 ? bel : Math.min(bel, st);
		if (end === -1) break;
		index = end + 1;
	}
	return { head: line.slice(0, index), rest: line.slice(index) };
}

/** Leading SGR escape sequence of a line ("" when none). */
function leadingSgr(line: string): string {
	if (!line.startsWith("\x1b[")) return "";
	let index = 2;
	while (index < line.length) {
		const code = line.charCodeAt(index);
		if (code >= 64 && code <= 126) return line.slice(0, index + 1);
		index++;
	}
	return "";
}

/** Whether an SGR sequence sets/resets the terminal background color. */
function isBackgroundSgr(sequence: string): boolean {
	if (!sequence.startsWith("\x1b[") || !sequence.endsWith("m")) return false;
	for (const code of sequence.slice(2, -1).split(";")) {
		const value = Number(code);
		if (value === 48 || value === 49) return true;
		if (value >= 40 && value <= 47) return true;
		if (value >= 100 && value <= 107) return true;
	}
	return false;
}

function contentText(line: string): string {
	let output = "";
	for (let index = 0; index < line.length; index++) {
		if (line.charCodeAt(index) !== 27) {
			output += line[index];
			continue;
		}
		const next = line[index + 1];
		if (next === "]") {
			index += 2;
			while (index < line.length && line.charCodeAt(index) !== 7) index++;
			continue;
		}
		if (next === "[") {
			index += 2;
			while (index < line.length && (line.charCodeAt(index) < 64 || line.charCodeAt(index) > 126)) index++;
		}
	}
	return output.replaceAll(OSC133_ZONE_START, "").replaceAll(OSC133_ZONE_END, "").replaceAll(OSC133_ZONE_FINAL, "");
}

function hasContent(line: string): boolean {
	return [...contentText(line)].some((character) => !/\s/u.test(character));
}

function getLineAnalysis(line: string): LineAnalysis {
	const cached = lineAnalysisCache.get(line);
	if (cached) {
		messageDecorationTestState.lineCacheHits++;
		return cached;
	}
	messageDecorationTestState.lineCacheMisses++;
	const leadingMarkers = splitLeadingMarkers(line);
	const backgroundAnsi = leadingSgr(leadingMarkers.rest);
	const isBackgroundWrapped =
		backgroundAnsi !== "" && isBackgroundSgr(backgroundAnsi) && leadingMarkers.rest.endsWith(BG_RESET);
	const backgroundBody = isBackgroundWrapped
		? leadingMarkers.rest.slice(backgroundAnsi.length, leadingMarkers.rest.length - BG_RESET.length)
		: undefined;
	const analysis: LineAnalysis = {
		visibleWidth: visibleWidth(line),
		hasContent: hasContent(line),
		oscEnvelope: extractOscEnvelope(line),
		hasOscStart: line.startsWith(OSC133_ZONE_START),
		leadingMarkers,
		isBackgroundWrapped,
		backgroundAnsi,
		backgroundBody,
		backgroundBodyWidth: backgroundBody === undefined ? undefined : visibleWidth(backgroundBody),
	};
	lineAnalysisCache.set(line, analysis);
	if (lineAnalysisCache.size > MAX_LINE_ANALYSIS_ENTRIES) {
		const oldestKey = lineAnalysisCache.keys().next().value;
		if (oldestKey !== undefined) lineAnalysisCache.delete(oldestKey);
	}
	return analysis;
}

function rebuildAtWidth(
	line: string,
	width: number,
	lead: string,
	leadWidth: number,
	analysis = getLineAnalysis(line),
): string {
	if (
		analysis.isBackgroundWrapped &&
		analysis.backgroundBody !== undefined &&
		analysis.backgroundBodyWidth !== undefined
	) {
		const pad = " ".repeat(Math.max(0, width - leadWidth - analysis.backgroundBodyWidth));
		return `${analysis.leadingMarkers.head}${analysis.backgroundAnsi}${lead}${analysis.backgroundBody}${pad}${BG_RESET}`;
	}
	const pad = " ".repeat(Math.max(0, width - leadWidth - analysis.visibleWidth));
	return `${lead}${line}${pad}`;
}

function decorateMessageLine(
	line: string,
	index: number,
	lastIndex: number,
	contentIndex: number,
	width: number,
	options: {
		firstEnvelope: OscParts | undefined;
		firstHasStart: boolean;
		multilineEnvelope: boolean;
		prefix: string;
		prefixWidth: number;
	},
	analysis = getLineAnalysis(line),
): string {
	const { firstEnvelope, firstHasStart, multilineEnvelope, prefix, prefixWidth } = options;
	const lead = index === contentIndex ? prefix : index > contentIndex ? " ".repeat(prefixWidth) : "";
	const leadWidth = index < contentIndex ? 0 : prefixWidth;
	if (index === contentIndex && firstEnvelope)
		return `${firstEnvelope.start}${rebuildAtWidth(firstEnvelope.body, width, prefix, prefixWidth)}${firstEnvelope.end}`;
	if (index === contentIndex && firstHasStart)
		return `${OSC133_ZONE_START}${rebuildAtWidth(line.slice(OSC133_ZONE_START.length), width, prefix, prefixWidth)}`;
	if (index === lastIndex && multilineEnvelope && index !== contentIndex)
		return `${OSC133_ZONE_END}${OSC133_ZONE_FINAL}${rebuildAtWidth(
			line.slice((OSC133_ZONE_END + OSC133_ZONE_FINAL).length),
			width,
			lead,
			leadWidth,
		)}`;
	if (
		index === contentIndex &&
		index === lastIndex &&
		multilineEnvelope &&
		line.startsWith(OSC133_ZONE_END + OSC133_ZONE_FINAL)
	)
		return `${OSC133_ZONE_END}${OSC133_ZONE_FINAL}${rebuildAtWidth(
			line.slice((OSC133_ZONE_END + OSC133_ZONE_FINAL).length),
			width,
			prefix,
			prefixWidth,
		)}`;
	return rebuildAtWidth(line, width, lead, leadWidth, analysis);
}

function sameLines(left: readonly string[], right: readonly string[]): boolean {
	if (left === right) return true;
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index++) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

function cacheKey(width: number, prefix: string): string {
	return `${width}\u0000${prefix}`;
}

function getRenderCache(instance: object): Map<string, DecoratedRenderCacheEntry> {
	let cache = renderCacheByInstance.get(instance);
	if (!cache) {
		cache = new Map();
		renderCacheByInstance.set(instance, cache);
	}
	return cache;
}

function storeRenderCache(
	instance: object,
	width: number,
	prefix: string,
	native: readonly string[],
	result: readonly string[],
): void {
	const cache = getRenderCache(instance);
	const key = cacheKey(width, prefix);
	if (cache.has(key)) cache.delete(key);
	cache.set(key, { nativeRef: native, nativeLines: [...native], result: [...result] });
	while (cache.size > MAX_RENDER_CACHE_KEYS_PER_INSTANCE) {
		const oldestKey = cache.keys().next().value;
		if (oldestKey === undefined) break;
		cache.delete(oldestKey);
	}
}

function prefixNative(lines: unknown, width: number, prefix: string): string[] | undefined {
	if (!Array.isArray(lines) || lines.length === 0 || !lines.every((line) => typeof line === "string")) return undefined;
	messageDecorationTestState.decoratePasses++;
	const nativeLines = lines as string[];
	const prefixWidth = visibleWidth(prefix);
	if (width <= prefixWidth) return undefined;
	const bodyWidth = width - prefixWidth;
	const first = nativeLines[0] ?? "";
	const last = nativeLines.at(-1) ?? "";
	const lastAnalysis = getLineAnalysis(last);
	const multilineEnvelope = nativeLines.length > 1 && last.startsWith(OSC133_ZONE_END + OSC133_ZONE_FINAL);
	// The last line is a content-start candidate only when the envelope is
	// single-line, or when no earlier line carries content. Assistant messages
	// with a single content line render as a multiline envelope whose only body
	// sits on the final line ([OSC133_A, OSC133_END+FINAL+body]); excluding it
	// would drop the prefix for every short assistant reply.
	const firstContentIndex = nativeLines.findIndex((line, index) => {
		if (index !== nativeLines.length - 1 || !multilineEnvelope) return getLineAnalysis(line).hasContent;
		return (
			!nativeLines.slice(0, index).some((earlier) => getLineAnalysis(earlier).hasContent) && lastAnalysis.hasContent
		);
	});
	if (firstContentIndex < 0) return nativeLines;
	const firstAnalysis = getLineAnalysis(first);
	const firstEnvelope = firstContentIndex === 0 ? firstAnalysis.oscEnvelope : undefined;
	const firstHasStart = firstContentIndex === 0 && firstAnalysis.hasOscStart;
	const decorated = nativeLines.map((line, index) =>
		decorateMessageLine(line, index, nativeLines.length - 1, firstContentIndex, width, {
			firstEnvelope,
			firstHasStart,
			multilineEnvelope,
			prefix,
			prefixWidth,
		}),
	);
	if (!decorated.every((line) => visibleWidth(line) <= width)) return undefined;
	if (!nativeLines.every((line) => getLineAnalysis(line).visibleWidth <= bodyWidth)) return undefined;
	return decorated;
}

export type MessageDecorationSnapshot = Readonly<{
	assistantPrefix: string;
	assistantEnabled: boolean;
	/** Drop the hidden-thinking label row and its trailing spacer (zero-trace collapse). */
	collapseHiddenThinking: boolean;
	/** Hide the text of assistant messages that also carry tool calls (interim narration). */
	hideInterimText: boolean;
}>;

export function __getMessageDecorationTestState(): Readonly<MessageDecorationTestState> {
	return { ...messageDecorationTestState };
}

export function __resetMessageDecorationTestState(): void {
	messageDecorationTestState.decoratePasses = 0;
	messageDecorationTestState.cacheHits = 0;
	messageDecorationTestState.cacheMisses = 0;
	messageDecorationTestState.lineCacheHits = 0;
	messageDecorationTestState.lineCacheMisses = 0;
	renderCacheByInstance = new WeakMap<object, Map<string, DecoratedRenderCacheEntry>>();
	lineAnalysisCache = new Map<string, LineAnalysis>();
}

export function decorateMessageRender(
	original: unknown,
	instance: object,
	args: unknown[],
	snapshot: MessageDecorationSnapshot = {
		assistantPrefix: "│ ",
		assistantEnabled: true,
		collapseHiddenThinking: false,
		hideInterimText: false,
	},
): unknown {
	if (typeof original !== "function") return undefined;
	const width = typeof args[0] === "number" ? args[0] : 0;
	const prefix = snapshot.assistantPrefix;
	if (!snapshot.assistantEnabled) return Reflect.apply(original, instance, args);
	const prefixWidth = visibleWidth(prefix);
	if (width <= prefixWidth) return Reflect.apply(original, instance, args);
	// Exactly one native invocation. If the reduced render cannot be certified, the
	// already-obtained result is the only safe fallback; retrying can mutate state.
	const reducedWidth = width - prefixWidth;
	const native = Reflect.apply(original, instance, [reducedWidth, ...args.slice(1)]);
	if (!Array.isArray(native) || !native.every((line) => typeof line === "string")) return native;
	const cached = getRenderCache(instance).get(cacheKey(width, prefix));
	if (cached && (cached.nativeRef === native || sameLines(cached.nativeLines, native))) {
		messageDecorationTestState.cacheHits++;
		return [...cached.result];
	}
	messageDecorationTestState.cacheMisses++;
	const decorated = prefixNative(native, width, prefix) ?? native;
	storeRenderCache(instance, width, prefix, native, decorated);
	return decorated;
}

/** Spacer-like: renders empty lines and exposes only setLines among these surfaces. */
function isSpacerChild(child: unknown): boolean {
	return typeof (child as { setLines?: unknown } | undefined)?.setLines === "function";
}

/**
 * The assistant TEXT Markdown block: `Markdown(text, pad, 0, theme, undefined,
 * { transform })` — duck-typed by setText + options object + no defaultTextStyle.
 * Thinking Markdown passes a `{ color, italic }` defaultTextStyle and is
 * therefore excluded; plain Text components carry no `options`.
 */
function isInterimTextChild(child: unknown): boolean {
	const candidate = child as { setText?: unknown; options?: unknown; defaultTextStyle?: unknown } | undefined;
	return (
		typeof candidate?.setText === "function" &&
		candidate.options !== undefined &&
		typeof candidate.options === "object" &&
		candidate.defaultTextStyle === undefined
	);
}

/** Whether the message content includes a toolCall item (interim narration marker). */
function hasToolCallItems(message: unknown): boolean {
	if (!message || typeof message !== "object") return false;
	const content = (message as { content?: unknown }).content;
	return (
		Array.isArray(content) &&
		content.some(
			(item) => item !== null && typeof item === "object" && (item as { type?: unknown }).type === "toolCall",
		)
	);
}

/**
 * The hidden-thinking placeholder: a Text (setCustomBgFn) whose ANSI-stripped
 * rendered content is empty. Duck-typed on the public shape because
 * pi-coding-agent may resolve its own nested pi-tui copy, so `instanceof`
 * across that module boundary is unreliable.
 */
function isBlankTextChild(child: unknown): boolean {
	const candidate = child as { setCustomBgFn?: unknown; render?: (width: number) => string[] } | undefined;
	if (typeof candidate?.setCustomBgFn !== "function" || typeof candidate.render !== "function") return false;
	return contentText(candidate.render(0).join("\n")).trim() === "";
}

/**
 * Collapse Pi's hidden-thinking placeholder row to zero trace.
 *
 * Native `AssistantMessageComponent.updateContent` renders the thinking block as
 * `Text(theme.italic(theme.fg("thinkingText", label)), outputPad, 0)` plus a
 * trailing `Spacer(1)`. An empty label is still wrapped in ANSI SGR codes, so
 * `Text.render` cannot treat it as empty (its check is `text.trim() === ""`,
 * and trim does not strip escape sequences) and emits one full-width invisible
 * line. That invisible row plus the surrounding spacers is the "gap" left when
 * the label is hidden. This wrapper runs the native layout, then drops the
 * invisible label row and the spacer the native layout appends after the
 * thinking run, leaving the same single top padding as a text-only message.
 */
export function decorateMessageUpdate(
	original: unknown,
	instance: object,
	args: unknown[],
	snapshot: MessageDecorationSnapshot = {
		assistantPrefix: "│ ",
		assistantEnabled: true,
		collapseHiddenThinking: false,
		hideInterimText: false,
	},
): unknown {
	if (typeof original !== "function") return undefined;
	const result = Reflect.apply(original, instance, args);
	const target = instance as {
		hideThinkingBlock?: boolean;
		hiddenThinkingLabel?: string;
		contentContainer?: { children?: unknown[] };
	};
	// Only meaningful when Pi renders the hidden-block label (hideThinkingBlock)
	// and the extension has blanked that label out ("" — the zero-trace mode).
	if (snapshot.collapseHiddenThinking && target.hideThinkingBlock === true && target.hiddenThinkingLabel === "") {
		const children = target.contentContainer?.children;
		if (children) {
			for (let index = children.length - 1; index >= 0; index--) {
				if (!isBlankTextChild(children[index])) continue;
				children.splice(index, 1);
				// Drop the Spacer(1) the native layout appends after the thinking run when
				// another visible block follows; the message keeps only its shared top padding.
				if (isSpacerChild(children[index])) children.splice(index, 1);
			}
		}
	}
	// Interim narration: assistant messages that carry tool calls use their text
	// only to narrate while working; the tool blocks tell the story. Hide the text
	// so the feed shows the run's summary and the final answer. Deterministic per
	// content — streaming, scroll-back, and resume behave identically. Errors and
	// truncation notices are Text children and stay; if only spacers remain the
	// message becomes zero-trace.
	if (snapshot.hideInterimText && hasToolCallItems(args[0])) {
		const children = target.contentContainer?.children;
		if (children) {
			for (let index = children.length - 1; index >= 0; index--) {
				if (isInterimTextChild(children[index])) children.splice(index, 1);
			}
			if (children.every((child) => isSpacerChild(child))) children.length = 0;
		}
	}
	return result;
}

// Special private layouts are intentionally not installed; their prototypes remain native.
