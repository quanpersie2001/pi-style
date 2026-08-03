// Special message-block presentation: compaction, skill invocation, branch
// summary, and extension custom (MCP) messages, rendered as boxed blocks.
//
// These patches are pure delegates: the compatibility probe installs them
// through its reversible, generation-tracked wrapper and restores the native
// identity on shutdown. The delegate receives the native method and falls back
// to it whenever the theme or component shape is unavailable.

import { keyText } from "@earendil-works/pi-coding-agent";
import { Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";
import type { BoxTheme } from "../../shared/box.js";
import { setFullTheme } from "../../shared/theme-extras.js";
import { renderBoxedMessageBlock } from "./boxed-block.js";

let cachedTheme: BoxTheme | undefined;

export function setSpecialBlockTheme(theme: BoxTheme | undefined): void {
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
	markdownTheme?: unknown;
	box?: { clear(): void; addChild(child: unknown): void; setBgFn?(fn: (text: string) => string): void };
	customComponent?: unknown;
	customRenderer?: unknown;
	clear?(): void;
	addChild(child: unknown): void;
	removeChild(child: unknown): void;
	setBgFn?(fn: (text: string) => string): void;
}

const EXPAND_HINT = "Ctrl+O to expand";

function expandHint(): string {
	try {
		const text = keyText("app.tools.expand");
		return text ? `${text} to expand` : EXPAND_HINT;
	} catch {
		return EXPAND_HINT;
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

/**
 * Neutralize the native customMessageBg fill for boxed blocks: the boxed block
 * owns its visual boundary, so the parent background is removed (the box sits
 * directly on the terminal/page background).
 */
function neutralizeMessageBlockBackground(target: { setBgFn?(fn: (text: string) => string): void } | undefined): void {
	if (!target) return;
	if (typeof target.setBgFn === "function") target.setBgFn((text) => text);
}

function patchCompaction(instance: MessageBlockInstance, _original: () => void, theme: BoxTheme): boolean {
	const tokensBefore = instance.message?.tokensBefore;
	if (tokensBefore == null) return false;

	if (typeof instance.clear === "function") instance.clear();

	const expanded = Boolean(instance.expanded);
	const summary = typeof instance.message?.summary === "string" ? instance.message.summary : "";
	const markdownTheme = instance.markdownTheme as MarkdownTheme | undefined;

	neutralizeMessageBlockBackground(instance as { setBgFn?(fn: (text: string) => string): void });

	const body = expanded && summary && markdownTheme ? createMarkdownBody(summary, markdownTheme, theme) : () => [];

	const tokenStr = Number(tokensBefore).toLocaleString();
	neutralizeMessageBlockBackground(instance as { setBgFn?(fn: (text: string) => string): void });
	const block = renderBoxedMessageBlock(theme, {
		kind: "Compaction",
		title: `${tokenStr} tokens`,
		...(expanded ? {} : { right: `(${expandHint()})` }),
		body,
		icon: "⊟",
		hasDivider: expanded,
	});
	instance.addChild(block);
	return true;
}

function patchSkill(instance: MessageBlockInstance, _original: () => void, theme: BoxTheme): boolean {
	const skillName = instance.skillBlock?.name;
	if (typeof skillName !== "string" || !skillName) return false;

	if (typeof instance.clear === "function") instance.clear();

	const expanded = Boolean(instance.expanded);
	const content = typeof instance.skillBlock?.content === "string" ? instance.skillBlock.content : "";
	const markdownTheme = instance.markdownTheme as MarkdownTheme | undefined;

	neutralizeMessageBlockBackground(instance as { setBgFn?(fn: (text: string) => string): void });

	const body = expanded && content && markdownTheme ? createMarkdownBody(content, markdownTheme, theme) : () => [];

	const block = renderBoxedMessageBlock(theme, {
		kind: "Skill",
		title: skillName,
		...(expanded ? {} : { right: `(${expandHint()})` }),
		body,
		icon: "⊟",
		hasDivider: expanded,
	});
	instance.addChild(block);
	return true;
}

function patchBranch(instance: MessageBlockInstance, _original: () => void, theme: BoxTheme): boolean {
	if (instance.message == null) return false;

	if (typeof instance.clear === "function") instance.clear();

	const expanded = Boolean(instance.expanded);
	const summary = typeof instance.message?.summary === "string" ? instance.message.summary : "";
	const markdownTheme = instance.markdownTheme as MarkdownTheme | undefined;

	neutralizeMessageBlockBackground(instance as { setBgFn?(fn: (text: string) => string): void });

	const body = expanded && summary && markdownTheme ? createMarkdownBody(summary, markdownTheme, theme) : () => [];

	const block = renderBoxedMessageBlock(theme, {
		kind: "Branch",
		...(expanded ? {} : { right: `(${expandHint()})` }),
		body,
		icon: "⊟",
		hasDivider: expanded,
	});
	instance.addChild(block);
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

	// The boxed shell owns its boundary; drop the native customMessageBg fill.
	neutralizeMessageBlockBackground(instance.box);
	neutralizeMessageBlockBackground(instance as { setBgFn?(fn: (text: string) => string): void });

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
