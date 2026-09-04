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
type ChildrenScanState = { childrenRef: readonly unknown[]; length: number };
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
// Live iterator over the analysis cache's insertion (= recency) order, reused
// across evictions: `keys().next()` allocates a fresh iterator (~1.4µs) each
// call, which dominates the per-insert eviction cost during streaming. A live
// Map iterator skips deleted entries and always hands back the current
// least-recently-used key, so eviction choice is identical to a fresh iterator.
let lineCacheEvictionCursor: Iterator<string, undefined, undefined> | undefined;
// Per-assistant-message guard for the updateContent children scan: skips the
// blank/interim scans when the contentContainer children array is unchanged.
let childrenScanByInstance = new WeakMap<object, ChildrenScanState>();
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
	// Strings are immutable: with no markers, `rest` can alias the line itself
	// instead of allocating a full copy on every analyzed line.
	return index === 0 ? { head: "", rest: line } : { head: line.slice(0, index), rest: line.slice(index) };
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

/** Whether an SGR sequence sets/resets the terminal background color (allocation-free `Number`-equivalent parse). */
function isBackgroundSgr(sequence: string): boolean {
	if (!sequence.startsWith("\x1b[") || !sequence.endsWith("m")) return false;
	// Splits on ";" and applies Number() per token: Number("") === 0, all-digit
	// tokens parse as integers, anything else is NaN (matches no range).
	let value = 0;
	let empty = true;
	let valid = true;
	for (let index = 2; index < sequence.length - 1; index++) {
		const code = sequence.charCodeAt(index);
		if (code === 0x3b) {
			if (valid && matchesBackgroundCode(empty ? 0 : value)) return true;
			value = 0;
			empty = true;
			valid = true;
			continue;
		}
		if (code < 0x30 || code > 0x39) {
			valid = false;
			continue;
		}
		value = value * 10 + (code - 0x30);
		empty = false;
	}
	return valid && matchesBackgroundCode(empty ? 0 : value);
}

function matchesBackgroundCode(value: number): boolean {
	return value === 48 || value === 49 || (value >= 40 && value <= 47) || (value >= 100 && value <= 107);
}

/**
 * Width of a string whose visible content is printable ASCII carrying only
 * escapes pi-tui recognizes (CSI ending in m/G/K/H/J, OSC/APC ending in BEL or
 * ST) — computed in one scan, no Intl.Segmenter pass. Returns undefined whenever
 * the string can leave that domain (tabs, controls, non-ASCII, or
 * unrecognized/unterminated escapes); callers then delegate to `visibleWidth`,
 * which makes the result provably identical to pi-tui's while skipping grapheme
 * segmentation for the streaming-hot line shapes. The escape scan mirrors
 * pi-tui's `extractAnsiCode` exactly (including tab-in-sequence handling, since
 * pi-tui replaces tabs before scanning but still consumes the same sequence).
 */
function certifiedAsciiWidth(value: string): number | undefined {
	let width = 0;
	let index = 0;
	const length = value.length;
	while (index < length) {
		const code = value.charCodeAt(index);
		if (code === 0x1b) {
			const next = index + 1 < length ? value.charCodeAt(index + 1) : -1;
			if (next === 0x5b) {
				// CSI: pi-tui consumes through the first m/G/K/H/J byte.
				let scan = index + 2;
				while (scan < length) {
					const terminator = value.charCodeAt(scan);
					if (
						terminator === 0x6d || // m
						terminator === 0x47 || // G
						terminator === 0x4b || // K
						terminator === 0x48 || // H
						terminator === 0x4a // J
					) {
						index = scan + 1;
						break;
					}
					scan++;
				}
				if (scan >= length) return undefined; // unterminated: pi-tui emits the ESC visibly
				continue;
			}
			if (next === 0x5d || next === 0x5f) {
				// OSC/APC: consumed through BEL or ST (ESC \).
				let scan = index + 2;
				let end = -1;
				while (scan < length) {
					const terminator = value.charCodeAt(scan);
					if (terminator === 0x07) {
						end = scan + 1;
						break;
					}
					if (terminator === 0x1b && scan + 1 < length && value.charCodeAt(scan + 1) === 0x5c) {
						end = scan + 2;
						break;
					}
					scan++;
				}
				if (end < 0) return undefined; // unterminated: delegate
				index = end;
				continue;
			}
			return undefined; // any other escape form: delegate
		}
		if (code < 0x20 || code > 0x7e) return undefined; // tab/control/non-ASCII: delegate
		width++;
		index++;
	}
	return width;
}

/** visibleWidth with a single-scan fast path; identical results, cheaper for streaming-hot lines. */
function certifiedVisibleWidth(value: string): number {
	return certifiedAsciiWidth(value) ?? visibleWidth(value);
}

/**
 * Memoized prefix width: the prefix (typically non-ASCII, e.g. "│ ") always
 * delegates to pi-tui's visibleWidth, and the streaming-hot unique lines evict
 * it from pi-tui's internal FIFO width cache, re-segmenting it every pass.
 * visibleWidth is pure, so a one-entry memo is exactly equivalent.
 */
let prefixWidthMemo: { prefix: string; width: number } | undefined;
function prefixWidthOf(prefix: string): number {
	if (prefixWidthMemo?.prefix === prefix) return prefixWidthMemo.width;
	const width = certifiedVisibleWidth(prefix);
	prefixWidthMemo = { prefix, width };
	return width;
}

function contentText(line: string): string {
	// Fast path: every OSC133 marker contains ESC and the strip loop below copies
	// every non-ESC char verbatim — an ESC-free line is its own content text.
	if (!line.includes("\x1b")) return line;
	// Slice-based build: one concatenation per escape span instead of per char.
	let output = "";
	let sliceStart = 0;
	for (let index = 0; index < line.length; index++) {
		if (line.charCodeAt(index) !== 27) continue;
		output += line.slice(sliceStart, index);
		const next = line[index + 1];
		if (next === "]") {
			index += 2;
			while (index < line.length && line.charCodeAt(index) !== 7) index++;
		} else if (next === "[") {
			index += 2;
			while (index < line.length && (line.charCodeAt(index) < 64 || line.charCodeAt(index) > 126)) index++;
		}
		sliceStart = index + 1;
	}
	output += line.slice(sliceStart);
	// The strip above can never leave an ESC in the output (every ESC consumes at
	// least itself, and both escape branches run to their terminator or end of
	// line), so these marker removals are a provably-untaken safety net.
	if (output.includes("\x1b]133;")) {
		return output.replaceAll(OSC133_ZONE_START, "").replaceAll(OSC133_ZONE_END, "").replaceAll(OSC133_ZONE_FINAL, "");
	}
	return output;
}

/** Whether a BMP code unit is whitespace with exact `\s` regex semantics (ECMAScript WhiteSpace + LineTerminator). */
function isWhitespaceCode(code: number): boolean {
	// Fast path: ASCII whitespace — space, \t, \n, \v, \f, \r.
	if (code === 0x20 || (code >= 0x09 && code <= 0x0d)) return true;
	if (code < 0x80) return false;
	// The non-ASCII members of \s (no surrogates or astral code points are whitespace).
	return (
		code === 0x00a0 ||
		code === 0x1680 ||
		(code >= 0x2000 && code <= 0x200a) ||
		code === 0x2028 ||
		code === 0x2029 ||
		code === 0x202f ||
		code === 0x205f ||
		code === 0x3000 ||
		code === 0xfeff
	);
}

/** Whether the line carries any non-whitespace content, in one ANSI-skipping scan (no content string built, no code-point array, no per-char regex). */
function hasContent(line: string): boolean {
	const length = line.length;
	let index = 0;
	while (index < length) {
		const code = line.charCodeAt(index);
		if (code === 0x1b) {
			// Skip exactly the spans contentText strips: OSC through BEL, CSI through
			// its final byte; a lone ESC drops just itself.
			const next = index + 1 < length ? line.charCodeAt(index + 1) : -1;
			if (next === 0x5d) {
				index += 2;
				while (index < length && line.charCodeAt(index) !== 0x07) index++;
			} else if (next === 0x5b) {
				index += 2;
				while (index < length) {
					const inner = line.charCodeAt(index);
					if (inner >= 64 && inner <= 126) break;
					index++;
				}
			}
			index++;
			continue;
		}
		// Surrogate halves never match \s: an astral code point (or a lone surrogate)
		// always counts as content, equivalent to the previous per-code-point regex.
		if (code >= 0xd800 && code <= 0xdfff) return true;
		if (!isWhitespaceCode(code)) return true;
		index++;
	}
	return false;
}

function getLineAnalysis(line: string): LineAnalysis {
	const cached = lineAnalysisCache.get(line);
	if (cached) {
		messageDecorationTestState.lineCacheHits++;
		// True LRU: re-insert on hit so recency is refreshed; the eviction below then
		// drops the least recently used entry instead of the oldest inserted one.
		lineAnalysisCache.delete(line);
		lineAnalysisCache.set(line, cached);
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
	const hasOscStart = line.startsWith(OSC133_ZONE_START);
	const analysis: LineAnalysis = {
		visibleWidth: certifiedVisibleWidth(line),
		hasContent: hasContent(line),
		oscEnvelope: hasOscStart ? extractOscEnvelope(line) : undefined,
		hasOscStart,
		leadingMarkers,
		isBackgroundWrapped,
		backgroundAnsi,
		backgroundBody,
		backgroundBodyWidth: backgroundBody === undefined ? undefined : certifiedVisibleWidth(backgroundBody),
	};
	lineAnalysisCache.set(line, analysis);
	if (lineAnalysisCache.size > MAX_LINE_ANALYSIS_ENTRIES) {
		let cursor = lineCacheEvictionCursor;
		if (cursor === undefined) cursor = lineAnalysisCache.keys();
		let oldest = cursor.next();
		if (oldest.done) {
			// Every not-yet-visited entry was refreshed past the cursor; restart from the true LRU head.
			cursor = lineAnalysisCache.keys();
			oldest = cursor.next();
		}
		lineCacheEvictionCursor = cursor;
		if (!oldest.done && oldest.value !== undefined) lineAnalysisCache.delete(oldest.value);
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
		continuationLead: string;
	},
	analysis = getLineAnalysis(line),
): string {
	const { firstEnvelope, firstHasStart, multilineEnvelope, prefix, prefixWidth, continuationLead } = options;
	const lead = index === contentIndex ? prefix : index > contentIndex ? continuationLead : "";
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
	const prefixWidth = prefixWidthOf(prefix);
	if (width <= prefixWidth) return undefined;
	const bodyWidth = width - prefixWidth;
	// One cache lookup per line per pass; every later consumer reuses this array
	// instead of re-requesting analysis (and re-churning LRU recency) per line.
	const analyses = nativeLines.map((line) => getLineAnalysis(line));
	const last = nativeLines.at(-1) ?? "";
	const lastAnalysis = analyses[analyses.length - 1] ?? getLineAnalysis(last);
	const multilineEnvelope = nativeLines.length > 1 && last.startsWith(OSC133_ZONE_END + OSC133_ZONE_FINAL);
	// The last line is a content-start candidate only when the envelope is
	// single-line, or when no earlier line carries content. Assistant messages
	// with a single content line render as a multiline envelope whose only body
	// sits on the final line ([OSC133_A, OSC133_END+FINAL+body]); excluding it
	// would drop the prefix for every short assistant reply.
	let firstContentIndex = -1;
	for (let index = 0; index < nativeLines.length; index++) {
		const analysis = analyses[index] ?? getLineAnalysis(nativeLines[index] ?? "");
		if (index !== nativeLines.length - 1 || !multilineEnvelope) {
			if (analysis.hasContent) {
				firstContentIndex = index;
				break;
			}
			continue;
		}
		let earlierHasContent = false;
		for (let earlier = 0; earlier < index; earlier++) {
			if ((analyses[earlier] ?? getLineAnalysis(nativeLines[earlier] ?? "")).hasContent) {
				earlierHasContent = true;
				break;
			}
		}
		if (!earlierHasContent && lastAnalysis.hasContent) firstContentIndex = index;
		break;
	}
	if (firstContentIndex < 0) return nativeLines;
	const firstAnalysis = analyses[0] ?? getLineAnalysis(nativeLines[0] ?? "");
	const firstEnvelope = firstContentIndex === 0 ? firstAnalysis.oscEnvelope : undefined;
	const firstHasStart = firstContentIndex === 0 && firstAnalysis.hasOscStart;
	const continuationLead = " ".repeat(prefixWidth);
	const decorated = nativeLines.map((line, index) =>
		decorateMessageLine(
			line,
			index,
			nativeLines.length - 1,
			firstContentIndex,
			width,
			{
				firstEnvelope,
				firstHasStart,
				multilineEnvelope,
				prefix,
				prefixWidth,
				continuationLead,
			},
			analyses[index],
		),
	);
	if (!decorated.every((line) => certifiedVisibleWidth(line) <= width)) return undefined;
	if (!analyses.every((analysis) => analysis.visibleWidth <= bodyWidth)) return undefined;
	return decorated;
}

export type MessageDecorationSnapshot = Readonly<{
	assistantPrefix: string;
	assistantEnabled: boolean;
	/** Drop the hidden-thinking label row and its trailing spacer (zero-trace collapse). */
	collapseHiddenThinking: boolean;
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
	lineCacheEvictionCursor = undefined;
	childrenScanByInstance = new WeakMap<object, ChildrenScanState>();
}

export function decorateMessageRender(
	original: unknown,
	instance: object,
	args: unknown[],
	snapshot: MessageDecorationSnapshot = {
		assistantPrefix: "│ ",
		assistantEnabled: true,
		collapseHiddenThinking: false,
	},
): unknown {
	if (typeof original !== "function") return undefined;
	const width = typeof args[0] === "number" ? args[0] : 0;
	const prefix = snapshot.assistantPrefix;
	if (!snapshot.assistantEnabled) return Reflect.apply(original, instance, args);
	const prefixWidth = prefixWidthOf(prefix);
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
 * The hidden-thinking placeholder: a Text (setCustomBgFn) whose ANSI-stripped
 * rendered content is empty. Duck-typed on the public shape because
 * pi-coding-agent may resolve its own nested pi-tui copy, so `instanceof`
 * across that module boundary is unreliable.
 *
 * Pi 0.85.0 wraps every thinking-run component (the hidden label Text or the
 * visible thinking Markdown) in a `MouseRegion` for click-to-toggle visibility.
 * `MouseRegion` is render-transparent, so the placeholder check unwraps it first
 * (duck-typed: a `handleMouse` function plus a `child`), keeping the same
 * Text detection for the pre-0.85 bare-Text layout.
 */
function unwrapMouseRegion(child: unknown): unknown {
	const candidate = child as { handleMouse?: unknown; child?: unknown } | undefined;
	if (typeof candidate?.handleMouse !== "function" || candidate.child === undefined) return child;
	return candidate.child;
}

function isBlankTextChild(child: unknown): boolean {
	const candidate = unwrapMouseRegion(child) as
		| { setCustomBgFn?: unknown; render?: (width: number) => string[]; text?: unknown }
		| undefined;
	if (typeof candidate?.setCustomBgFn !== "function" || typeof candidate.render !== "function") return false;
	// pi-tui's Text exposes its raw source text as a plain `.text` property (kept in
	// sync by the constructor and setText). render(0) only wraps/pads that text with
	// spaces and ANSI (both blank under contentText+trim), so the property check is
	// equivalent — and avoids a full Text render per child on every updateContent pass
	// (which would also pollute Text's own width-keyed render cache with width 0).
	if (typeof candidate.text === "string") return contentText(candidate.text).trim() === "";
	return contentText(candidate.render(0).join("\n")).trim() === "";
}

/**
 * Skip the post-update children scans when nothing could have changed:
 * `AssistantMessageComponent.updateContent` starts every pass with
 * `contentContainer.clear()`, and pi-tui's `Container.clear()` assigns a fresh
 * `children` array (children are REPLACED, never mutated in place across passes).
 * An unchanged reference (and length) therefore means the native layout did not
 * rebuild since this instance was last scanned, so the previous scan's collapse
 * is still in effect. Kept per-instance via WeakMap so messages are GC-able.
 */
function childrenUnchangedSinceScan(instance: object, children: readonly unknown[]): boolean {
	const state = childrenScanByInstance.get(instance);
	return state !== undefined && state.childrenRef === children && state.length === children.length;
}

function markChildrenScanned(instance: object, children: readonly unknown[]): void {
	childrenScanByInstance.set(instance, { childrenRef: children, length: children.length });
}

/**
 * Collapse Pi's hidden-thinking placeholder row to zero trace.
 *
 * Native `AssistantMessageComponent.updateContent` renders the thinking block as
 * `Text(theme.italic(theme.fg("thinkingText", label)), outputPad, 0)` plus a
 * trailing `Spacer(1)` — wrapped in a render-transparent `MouseRegion` since
 * Pi 0.85.0. An empty label is still wrapped in ANSI SGR codes, so
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
	},
): unknown {
	if (typeof original !== "function") return undefined;
	const result = Reflect.apply(original, instance, args);
	const target = instance as {
		hideThinkingBlock?: boolean;
		hiddenThinkingLabel?: string;
		contentContainer?: { children?: unknown[] };
	};
	const children = target.contentContainer?.children;
	if (children && !childrenUnchangedSinceScan(instance, children)) {
		// Only meaningful when Pi renders the hidden-block label (hideThinkingBlock)
		// and the extension has blanked that label out ("" — the zero-trace mode).
		if (snapshot.collapseHiddenThinking && target.hideThinkingBlock === true && target.hiddenThinkingLabel === "") {
			for (let index = children.length - 1; index >= 0; index--) {
				if (!isBlankTextChild(children[index])) continue;
				children.splice(index, 1);
				// Drop the Spacer(1) the native layout appends after the thinking run when
				// another visible block follows; the message keeps only its shared top padding.
				if (isSpacerChild(children[index])) children.splice(index, 1);
			}
		}
		markChildrenScanned(instance, children);
	}
	return result;
}

// Special private layouts are intentionally not installed; their prototypes remain native.
