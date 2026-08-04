import { visibleWidth } from "@earendil-works/pi-tui";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";
type OscParts = { start: string; body: string; end: string };

function extractOscEnvelope(line: string): OscParts | undefined {
	if (!line.startsWith(OSC133_ZONE_START)) return undefined;
	const bodyEnd = line.indexOf(OSC133_ZONE_END, OSC133_ZONE_START.length);
	if (bodyEnd < 0 || !line.endsWith(OSC133_ZONE_FINAL)) return undefined;
	return { start: OSC133_ZONE_START, body: line.slice(OSC133_ZONE_START.length, bodyEnd), end: line.slice(bodyEnd) };
}

const BG_RESET = "\x1b[49m";

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

/**
 * Rebuild a native line so `lead` (prompt prefix / continuation indent) and the
 * full target width are covered by the line's background.
 *
 * Native Box lines (user messages) are `bgAnsi + body + \x1b[49m`; prepending the
 * prefix outside that wrap shifted the input row's background right by the
 * prefix width while keeping the full container width, producing a staircase
 * box (indented left, overflowing right). Rebuilding inside the wrap keeps the
 * background flush across every row; plain (unwrapped) lines are padded to the
 * target width instead so left/right edges stay aligned.
 */
function rebuildAtWidth(line: string, width: number, lead: string): string {
	const { head, rest } = splitLeadingMarkers(line);
	const bgAnsi = leadingSgr(rest);
	if (bgAnsi && isBackgroundSgr(bgAnsi) && rest.endsWith(BG_RESET)) {
		const body = rest.slice(bgAnsi.length, rest.length - BG_RESET.length);
		const pad = " ".repeat(Math.max(0, width - visibleWidth(lead) - visibleWidth(body)));
		return `${head}${bgAnsi}${lead}${body}${pad}${BG_RESET}`;
	}
	const padded = `${lead}${line}`;
	return `${padded}${" ".repeat(Math.max(0, width - visibleWidth(padded)))}`;
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
	},
): string {
	const { firstEnvelope, firstHasStart, multilineEnvelope, prefix } = options;
	const prefixWidth = visibleWidth(prefix);
	const lead = index === contentIndex ? prefix : index > contentIndex ? " ".repeat(prefixWidth) : "";
	if (index === contentIndex && firstEnvelope)
		return `${firstEnvelope.start}${rebuildAtWidth(firstEnvelope.body, width, prefix)}${firstEnvelope.end}`;
	if (index === contentIndex && firstHasStart)
		return `${OSC133_ZONE_START}${rebuildAtWidth(line.slice(OSC133_ZONE_START.length), width, prefix)}`;
	if (index === lastIndex && multilineEnvelope && index !== contentIndex)
		return `${OSC133_ZONE_END}${OSC133_ZONE_FINAL}${rebuildAtWidth(
			line.slice((OSC133_ZONE_END + OSC133_ZONE_FINAL).length),
			width,
			lead,
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
		)}`;
	return rebuildAtWidth(line, width, lead);
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

function prefixNative(lines: unknown, width: number, prefix: string): string[] | undefined {
	if (!Array.isArray(lines) || lines.length === 0 || !lines.every((line) => typeof line === "string")) return undefined;
	const nativeLines = lines as string[];
	const prefixWidth = visibleWidth(prefix);
	if (width <= prefixWidth) return undefined;
	const bodyWidth = width - prefixWidth;
	const first = nativeLines[0] ?? "";
	const last = nativeLines.at(-1) ?? "";
	const multilineEnvelope = nativeLines.length > 1 && last.startsWith(OSC133_ZONE_END + OSC133_ZONE_FINAL);
	// The last line is a content-start candidate only when the envelope is
	// single-line, or when no earlier line carries content. Assistant messages
	// with a single content line render as a multiline envelope whose only body
	// sits on the final line ([OSC133_A, OSC133_END+FINAL+body]); excluding it
	// would drop the prefix for every short assistant reply.
	const firstContentIndex = nativeLines.findIndex((line, index) => {
		if (index !== nativeLines.length - 1 || !multilineEnvelope) return hasContent(line);
		return !nativeLines.slice(0, index).some((earlier) => hasContent(earlier)) && hasContent(line);
	});
	if (firstContentIndex < 0) return nativeLines;
	const firstEnvelope = firstContentIndex === 0 ? extractOscEnvelope(first) : undefined;
	const firstHasStart = firstContentIndex === 0 && first.startsWith(OSC133_ZONE_START);
	const decorated = nativeLines.map((line, index) =>
		decorateMessageLine(line, index, nativeLines.length - 1, firstContentIndex, width, {
			firstEnvelope,
			firstHasStart,
			multilineEnvelope,
			prefix,
		}),
	);
	if (!decorated.every((line) => visibleWidth(line) <= width)) return undefined;
	if (!nativeLines.every((line) => visibleWidth(line) <= bodyWidth)) return undefined;
	return decorated;
}

export type MessageDecorationSnapshot = Readonly<{
	userPrefix: string;
	assistantPrefix: string;
	userEnabled: boolean;
	assistantEnabled: boolean;
}>;

export function decorateMessageRender(
	subtype: "native-user-message" | "native-assistant-message",
	original: unknown,
	instance: object,
	args: unknown[],
	snapshot: MessageDecorationSnapshot = {
		userPrefix: "❯ ",
		assistantPrefix: "│ ",
		userEnabled: true,
		assistantEnabled: true,
	},
): unknown {
	if (typeof original !== "function") return undefined;
	const width = typeof args[0] === "number" ? args[0] : 0;
	const enabled = subtype === "native-user-message" ? snapshot.userEnabled : snapshot.assistantEnabled;
	const prefix = subtype === "native-user-message" ? snapshot.userPrefix : snapshot.assistantPrefix;
	if (!enabled) return Reflect.apply(original, instance, args);
	if (width <= visibleWidth(prefix)) return Reflect.apply(original, instance, args);
	// Exactly one native invocation. If the reduced render cannot be certified, the
	// already-obtained result is the only safe fallback; retrying can mutate state.
	const reducedWidth = width - visibleWidth(prefix);
	const native = Reflect.apply(original, instance, [reducedWidth, ...args.slice(1)]);
	return prefixNative(native, width, prefix) ?? native;
}

// Special private layouts are intentionally not installed; their prototypes remain native.
