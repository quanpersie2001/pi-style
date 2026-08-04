import { initTheme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { decorateMessageRender } from "../../extension-src/pi-style/features/messages/index.js";

const ESC = "\x1b";

/** Strip ANSI CSI/OSC sequences while keeping the visible text. */
function stripAnsi(value: string): string {
	let output = "";
	for (let index = 0; index < value.length; index++) {
		if (value[index] !== ESC) {
			output += value[index];
			continue;
		}
		if (value[index + 1] === "]") {
			index += 2;
			while (index < value.length && value.charCodeAt(index) !== 7) index++;
			continue;
		}
		if (value[index + 1] === "[") {
			index += 2;
			while (index < value.length && (value.charCodeAt(index) < 64 || value.charCodeAt(index) > 126)) index++;
		}
	}
	return output;
}

/** Leading SGR sequence of a line after zero-width OSC markers, when present. */
function leadingSgr(line: string): string {
	let index = 0;
	while (line.startsWith("\x1b]", index)) {
		const end = line.indexOf("\x07", index + 2);
		if (end === -1) return "";
		index = end + 1;
	}
	if (!line.startsWith(`${ESC}[`, index)) return "";
	const sgrStart = index;
	index += 2;
	while (index < line.length) {
		const code = line.charCodeAt(index);
		if (code >= 64 && code <= 126) return line.slice(sgrStart, index + 1);
		index++;
	}
	return "";
}

/** Whether an SGR sequence sets the terminal background color. */
function isBackgroundSgr(sequence: string): boolean {
	for (const code of sequence.slice(2, -1).split(";")) {
		const value = Number(code);
		if (value === 48 || value === 49) return true;
		if (value >= 40 && value <= 47) return true;
		if (value >= 100 && value <= 107) return true;
	}
	return false;
}

describe("user-message prefix decoration", () => {
	it("keeps every row flush to the container edges with full background coverage", () => {
		initTheme("dark", false);
		const component = new UserMessageComponent("hello world\nsecond line");
		const decorated = decorateMessageRender(
			"native-user-message",
			component.render.bind(component),
			component,
			[40],
		) as string[];

		// Every row must span the full container width — no short padding rows.
		for (const line of decorated) expect(visibleWidth(line)).toBe(40);

		// Every row keeps the native userMessageBg background (padding rows included).
		for (const line of decorated) expect(isBackgroundSgr(leadingSgr(line))).toBe(true);

		// The content row's background band starts at column 0: the background SGR
		// must precede the prompt prefix, not sit after it (that shifted the band
		// right while keeping the full width, producing a staircase box).
		const contentRow = decorated.find((line) => stripAnsi(line).includes("hello world"));
		expect(contentRow).toBeDefined();
		expect(isBackgroundSgr(leadingSgr(contentRow ?? ""))).toBe(true);
		expect(stripAnsi(contentRow ?? "").indexOf("❯")).toBe(0);

		// Continuation aligns under the text after prompt + gap + panel padding.
		const continuation = decorated.find((line) => stripAnsi(line).includes("second line"));
		expect(stripAnsi(contentRow ?? "").indexOf("hello world")).toBe(
			stripAnsi(continuation ?? "").indexOf("second line"),
		);

		// OSC133 envelope markers stay balanced.
		const joined = decorated.join("\n");
		expect(joined.split("\x1b]133;A\x07").length - 1).toBe(1);
		expect(joined.split("\x1b]133;B\x07\x1b]133;C\x07").length - 1).toBe(1);
	});

	it("covers the prefix with the background for single-line messages too", () => {
		initTheme("dark", false);
		const component = new UserMessageComponent("single line");
		const decorated = decorateMessageRender(
			"native-user-message",
			component.render.bind(component),
			component,
			[40],
		) as string[];
		for (const line of decorated) expect(visibleWidth(line)).toBe(40);
		const contentRow = decorated.find((line) => stripAnsi(line).includes("single line"));
		expect(isBackgroundSgr(leadingSgr(contentRow ?? ""))).toBe(true);
		expect(stripAnsi(contentRow ?? "").indexOf("❯")).toBe(0);
	});

	it("preserves nested markdown foreground colors inside the re-wrapped line", () => {
		initTheme("dark", false);
		const component = new UserMessageComponent("**bold** text");
		const decorated = decorateMessageRender(
			"native-user-message",
			component.render.bind(component),
			component,
			[40],
		) as string[];
		const contentRow = decorated.find((line) => stripAnsi(line).includes("bold"));
		expect(contentRow).toBeDefined();
		expect(isBackgroundSgr(leadingSgr(contentRow ?? ""))).toBe(true);
		// Nested fg escapes survive the rebuild and the row closes with the bg reset.
		expect(contentRow?.includes(`${ESC}[`)).toBe(true);
		expect(contentRow?.endsWith("\x1b[49m")).toBe(true);
	});
});
