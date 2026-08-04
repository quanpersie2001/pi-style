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

function prefixAtFirstContent(line: string, prefix: string): string {
	let index = 0;
	while (index < line.length) {
		if (line[index] === "\x1b" && line[index + 1] === "[") {
			index += 2;
			while (index < line.length && (line.charCodeAt(index) < 64 || line.charCodeAt(index) > 126)) index++;
			if (index < line.length) index++;
			continue;
		}
		if (/\s/u.test(line[index] ?? "")) {
			index++;
			continue;
		}
		break;
	}
	return `${line.slice(0, index)}${prefix}${line.slice(index)}`;
}

function decorateMessageLine(
	line: string,
	index: number,
	lastIndex: number,
	contentIndex: number,
	options: {
		firstEnvelope: OscParts | undefined;
		firstHasStart: boolean;
		multilineEnvelope: boolean;
		prefix: string;
	},
): string {
	const { firstEnvelope, firstHasStart, multilineEnvelope, prefix } = options;
	const prefixWidth = visibleWidth(prefix);
	if (index === contentIndex && firstEnvelope)
		return `${firstEnvelope.start}${prefixAtFirstContent(firstEnvelope.body, prefix)}${firstEnvelope.end}`;
	if (index === contentIndex && firstHasStart)
		return `${OSC133_ZONE_START}${prefix}${line.slice(OSC133_ZONE_START.length)}`;
	if (index === lastIndex && multilineEnvelope && index !== contentIndex)
		return `${OSC133_ZONE_END}${OSC133_ZONE_FINAL}${line.slice((OSC133_ZONE_END + OSC133_ZONE_FINAL).length)}`;
	if (
		index === contentIndex &&
		index === lastIndex &&
		multilineEnvelope &&
		line.startsWith(OSC133_ZONE_END + OSC133_ZONE_FINAL)
	)
		return `${OSC133_ZONE_END}${OSC133_ZONE_FINAL}${prefix}${line.slice((OSC133_ZONE_END + OSC133_ZONE_FINAL).length)}`;
	if (index === contentIndex) return `${prefix}${line}`;
	return index > contentIndex ? `${" ".repeat(prefixWidth)}${line}` : line;
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
	const decorated = nativeLines.map((line, index) => {
		if (index === firstContentIndex)
			return decorateMessageLine(line, index, nativeLines.length - 1, firstContentIndex, {
				firstEnvelope,
				firstHasStart,
				multilineEnvelope,
				prefix,
			});
		if (index > firstContentIndex && hasContent(line)) return `${" ".repeat(prefixWidth)}${line}`;
		return line;
	});
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
