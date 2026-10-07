// Special message-block presentation: compaction, skill invocation, branch
// summary, and extension custom (MCP) messages, rendered as boxed blocks.
//
// These patches are pure delegates: the compatibility probe installs them
// through its reversible, generation-tracked wrapper and restores the native
// identity on shutdown. The delegate receives the native method and falls back
// to it whenever the theme or component shape is unavailable.

import { keyText } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Markdown, type MarkdownTheme, MouseRegion } from "@earendil-works/pi-tui";
import { bgHexAnsi, isHexColor, stripAnsi, truncateAnsi, wrapAnsiBackground } from "../../shared/ansi.js";
import type { BoxTheme } from "../../shared/box.js";
import { getThemeExtra, setFullTheme } from "../../shared/theme-extras.js";
import { renderBoxedMessageBlock } from "./boxed-block.js";

let cachedTheme: BoxTheme | undefined;
const compactionBackgroundOwners = new Set<WeakRef<MessageBlockInstance>>();
let trackedCompactions = new WeakSet<object>();

export function restoreCompactionBackgrounds(): void {
	const nativeTheme = cachedTheme;
	for (const reference of compactionBackgroundOwners) {
		reference.deref()?.setBgFn?.((text) => nativeTheme?.bg?.("customMessageBg", text) ?? text);
	}
	compactionBackgroundOwners.clear();
	trackedCompactions = new WeakSet<object>();
}

export function setSpecialBlockTheme(theme: BoxTheme | undefined): void {
	if (!theme) restoreCompactionBackgrounds();
	for (const reference of compactionBackgroundOwners) {
		if (!reference.deref()) compactionBackgroundOwners.delete(reference);
	}
	cachedTheme = theme;
	if (theme) setFullTheme(theme);
}

export type SpecialBlockSubtype =
	| "native-compaction-message"
	| "native-branch-message"
	| "native-skill-message"
	| "native-custom-message";

export type SpecialBlockCtor = { prototype?: unknown };

export interface SpecialBlockCtors {
	CompactionSummaryMessageComponent?: SpecialBlockCtor;
	SkillInvocationMessageComponent?: SpecialBlockCtor;
	BranchSummaryMessageComponent?: SpecialBlockCtor;
	CustomMessageComponent?: SpecialBlockCtor;
}

/** Structural view of the native message components as used by the patches. */
interface MessageBlockInstance {
	message?: {
		tokensBefore?: unknown;
		summary?: unknown;
		customType?: unknown;
		content?: unknown;
	};
	skillBlock?: { name?: unknown; content?: unknown };
	expanded?: unknown;
	_expanded?: unknown;
	setExpanded?(expanded: boolean): unknown;
	setBgFn?(bgFn?: (text: string) => string): void;
	markdownTheme?: unknown;
	box?: { clear(): void; addChild(child: unknown): void };
	customComponent?: unknown;
	customRenderer?: unknown;
	clear?(): void;
	addChild(child: unknown): void;
	removeChild(child: unknown): void;
}

const EXPAND_HINT = "Ctrl+O to expand";

function expandHint(expanded = false): string {
	try {
		const text = keyText("app.tools.expand");
		return text ? `${text} to ${expanded ? "collapse" : "expand"}` : expanded ? "Ctrl+O to collapse" : EXPAND_HINT;
	} catch {
		return expanded ? "Ctrl+O to collapse" : EXPAND_HINT;
	}
}

function createMarkdownBody(
	text: string,
	markdownTheme: MarkdownTheme | undefined,
	theme: BoxTheme,
): (contentWidth: number) => string[] {
	const md = new Markdown(text || "", 0, 0, markdownTheme as MarkdownTheme, {
		color: (t: string) => theme.fg("customMessageText", t),
	});
	return (contentWidth: number) => md.render(contentWidth);
}

/** Compaction instances already default-expanded once. The compaction summary
 * is the only in-transcript record of the compacted conversation, so the boxed
 * block starts expanded instead of hint-only (native starts collapsed; Ctrl+O
 * or a click can still collapse it afterwards, and a chat rebuild re-applies
 * the default because the fresh component starts from native state again). */
const compactionDefaultExpanded = new WeakSet<object>();

/** Restore the native click-to-toggle affordance around a boxed block: the
 * native layout wraps its content in a MouseRegion, but the boxed replacement
 * clears those children, so without this wrapper clicks would be dead. */
function clickToggleRegion(instance: MessageBlockInstance, block: Component): Component {
	if (typeof instance.setExpanded !== "function") return block;
	return new MouseRegion(block, (event) => {
		if (event.type !== "click" || event.button !== "left") return undefined;
		instance.setExpanded?.(!instance.expanded);
		return { handled: true };
	});
}

/** One genuine summary line, preferring prose over headings/formatting. */
function compactionPreview(summary: string): string {
	const lines = stripAnsi(summary)
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	const line = lines.find((line) => !/^(#{1,6}\s|```|~~~|[-*_]{3,}$)/u.test(line)) ?? lines[0] ?? "";
	return [...line.replace(/^(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/u, "").replace(/[*`]/g, "")]
		.map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? " " : char))
		.join("")
		.trim();
}

function compactionBackground(theme: BoxTheme, text: string): string {
	const color = getThemeExtra(theme, "compactionBgColor");
	// A neutral message surface, not a tool success/pending/error state.
	if (isHexColor(color)) return wrapAnsiBackground(text, bgHexAnsi(theme, color));
	try {
		return theme.bg?.("userMessageBg", text) ?? text;
	} catch {
		return text;
	}
}

function patchCompaction(instance: MessageBlockInstance, _original: () => void, theme: BoxTheme): boolean {
	const tokensBefore = instance.message?.tokensBefore;
	if (tokensBefore == null) return false;

	if (!compactionDefaultExpanded.has(instance)) {
		compactionDefaultExpanded.add(instance);
		if (instance.expanded !== true) instance.expanded = true;
	}

	if (typeof instance.clear === "function") instance.clear();

	const expanded = Boolean(instance.expanded);
	const summary = typeof instance.message?.summary === "string" ? instance.message.summary : "";
	const markdownTheme = instance.markdownTheme as MarkdownTheme | undefined;

	const preview = compactionPreview(summary);
	const body =
		expanded && summary && markdownTheme
			? createMarkdownBody(summary, markdownTheme, theme)
			: (width: number) => (preview ? [theme.fg("customMessageText", truncateAnsi(preview, width, "…"))] : []);

	const tokenStr = Number(tokensBefore).toLocaleString();
	const block = renderBoxedMessageBlock(theme, {
		kind: "Compaction",
		title: `${tokenStr} tokens`,
		right: expandHint(expanded),
		body,
		icon: expanded ? "▾" : "▸",
		compact: true,
	});
	// Change only the public container background, leaving native layout/mouse
	// padding intact. Restore native fill on teardown; weak refs don't retain chat.
	if (instance.setBgFn) {
		instance.setBgFn((text) => compactionBackground(cachedTheme ?? theme, text));
		if (!trackedCompactions.has(instance)) {
			trackedCompactions.add(instance);
			compactionBackgroundOwners.add(new WeakRef(instance));
		}
	}
	instance.addChild(clickToggleRegion(instance, block));
	return true;
}

function patchSkill(instance: MessageBlockInstance, _original: () => void, theme: BoxTheme): boolean {
	const skillName = instance.skillBlock?.name;
	if (typeof skillName !== "string" || !skillName) return false;

	if (typeof instance.clear === "function") instance.clear();

	const expanded = Boolean(instance.expanded);
	const content = typeof instance.skillBlock?.content === "string" ? instance.skillBlock.content : "";
	const markdownTheme = instance.markdownTheme as MarkdownTheme | undefined;

	const body = expanded && content && markdownTheme ? createMarkdownBody(content, markdownTheme, theme) : () => [];

	const block = renderBoxedMessageBlock(theme, {
		kind: "Skill",
		title: skillName,
		...(expanded ? {} : { right: expandHint() }),
		body,
		icon: "⊟",
		hasDivider: expanded,
	});
	instance.addChild(clickToggleRegion(instance, block));
	return true;
}

function patchBranch(instance: MessageBlockInstance, _original: () => void, theme: BoxTheme): boolean {
	if (instance.message == null) return false;

	if (typeof instance.clear === "function") instance.clear();

	const expanded = Boolean(instance.expanded);
	const summary = typeof instance.message?.summary === "string" ? instance.message.summary : "";
	const markdownTheme = instance.markdownTheme as MarkdownTheme | undefined;

	const body = expanded && summary && markdownTheme ? createMarkdownBody(summary, markdownTheme, theme) : () => [];

	const block = renderBoxedMessageBlock(theme, {
		kind: "Branch",
		...(expanded ? {} : { right: expandHint() }),
		body,
		icon: "⊟",
		hasDivider: expanded,
	});
	instance.addChild(clickToggleRegion(instance, block));
	return true;
}

function attachCustomMessageBlock(instance: MessageBlockInstance, block: unknown): boolean {
	if (instance.box && typeof instance.box.clear === "function" && typeof instance.box.addChild === "function") {
		instance.addChild(instance.box);
		instance.box.clear();
		instance.box.addChild(block);
		return true;
	}
	instance.customComponent = block;
	instance.addChild(instance.customComponent);
	return true;
}

function patchCustomMessage(instance: MessageBlockInstance, _original: () => void, theme: BoxTheme): boolean {
	// Remove previous content component
	if (instance.customComponent) {
		instance.removeChild(instance.customComponent);
		instance.customComponent = undefined;
	}
	if (instance.box) instance.removeChild(instance.box);

	// The boxed shell owns its boundary; the native customMessageBg fill stays.

	const rawCustomType = instance.message?.customType;
	const customType = typeof rawCustomType === "string" ? rawCustomType : "Custom";

	// Try custom renderer first, but keep the special block shell/background owned here.
	if (typeof instance.customRenderer === "function") {
		try {
			const component = (instance.customRenderer as (message: unknown, options: object, theme: unknown) => unknown)(
				instance.message,
				{ expanded: instance._expanded },
				theme,
			);
			if (component && typeof (component as { render?: unknown }).render === "function") {
				const block = renderBoxedMessageBlock(theme, {
					kind: "Custom",
					title: customType,
					body: (contentWidth) => (component as { render(width: number): string[] }).render(contentWidth),
					icon: "⊟",
					hasDivider: "auto",
					cache: false,
				});
				attachCustomMessageBlock(instance, block);
				return true;
			}
		} catch {
			// Fall through to default rendering
		}
	}

	// Default rendering: use boxed message block

	// Extract text content
	const rawContent = instance.message?.content;
	let text: string;
	if (typeof rawContent === "string") {
		text = rawContent;
	} else if (Array.isArray(rawContent)) {
		text = rawContent
			.filter((c: unknown) => {
				if (!c || typeof c !== "object") return false;
				return (c as { type?: unknown }).type === "text";
			})
			.map((c) => String((c as { text?: unknown }).text ?? ""))
			.join("\n");
	} else {
		text = "";
	}

	const markdownTheme = instance.markdownTheme as MarkdownTheme | undefined;

	const body = text && markdownTheme ? createMarkdownBody(text, markdownTheme, theme) : () => [];

	const block = renderBoxedMessageBlock(theme, {
		kind: "Custom",
		title: customType,
		body,
		icon: "⊟",
		hasDivider: Boolean(text),
	});

	attachCustomMessageBlock(instance, block);
	return true;
}

/**
 * Delegate invoked by the compatibility probe's wrapper for each special block
 * method. Falls back to the native implementation when the theme cache is
 * empty or the component shape is unsupported.
 */
export function renderSpecialMessageBlock(
	subtype: SpecialBlockSubtype,
	original: unknown,
	thisArg: object,
	args: unknown[],
): unknown {
	const instance = thisArg as unknown as MessageBlockInstance;
	const base = original as (this: object, ...rest: unknown[]) => unknown;
	const applyBase = () => base.apply(thisArg, args);
	// pi-style owns these native custom renderers; another boxed shell would
	// duplicate their frame and padding. Keep Pi's renderer dispatch intact.
	if (
		subtype === "native-custom-message" &&
		(instance.message?.customType === "teammate-notification" || instance.message?.customType === "teammate-message")
	)
		return applyBase();
	const theme = cachedTheme;
	if (!theme) return applyBase();
	try {
		let handled = false;
		if (subtype === "native-compaction-message") handled = patchCompaction(instance, applyBase, theme);
		else if (subtype === "native-skill-message") handled = patchSkill(instance, applyBase, theme);
		else if (subtype === "native-branch-message") handled = patchBranch(instance, applyBase, theme);
		else if (subtype === "native-custom-message") handled = patchCustomMessage(instance, applyBase, theme);
		return handled ? undefined : applyBase();
	} catch {
		return applyBase();
	}
}
