// Boxed tool renderer dispatcher.
//
// Maps Pi tool names to their boxed call/result renderers and falls back to a
// boxed generic renderer for unknown tools. The dispatcher is invoked from the
// tool decoration owner when tools.style === "compact-box".

import type { Component } from "@earendil-works/pi-tui";
import type { BoxTheme } from "../../../shared/box.js";
import { bashTool } from "./bash.js";
import { editTool } from "./edit.js";
import { renderFallbackCall, renderFallbackResult } from "./fallback.js";
import { findTool } from "./find.js";
import { grepTool } from "./grep.js";
import { lsTool } from "./ls.js";
import { getQuickEditToolConfig, quickEditTool } from "./quick-edit.js";
import { readTool } from "./read.js";
import type { BoxedToolContext, BoxedToolDefinition } from "./shared.js";
import { writeTool } from "./write.js";

function quickEditToolFor(toolName: string): BoxedToolDefinition {
	const config = getQuickEditToolConfig(toolName);
	if (!config) throw new Error(`missing quick-edit config for ${toolName}`);
	return quickEditTool(config);
}

const REGISTRY: Readonly<Record<string, BoxedToolDefinition>> = {
	read: readTool,
	write: writeTool,
	edit: editTool,
	bash: bashTool,
	ls: lsTool,
	find: findTool,
	grep: grepTool,
	quick_edit: quickEditToolFor("quick_edit"),
	substitute_edit: quickEditToolFor("substitute_edit"),
	target_edit: quickEditToolFor("target_edit"),
};

export function hasBoxedRenderer(toolName: unknown): boolean {
	return typeof toolName === "string" && Object.hasOwn(REGISTRY, toolName);
}

export function renderBoxedToolCall(
	toolName: unknown,
	args: Record<string, unknown>,
	theme: BoxTheme,
	context: BoxedToolContext,
): Component {
	const tool = typeof toolName === "string" ? REGISTRY[toolName] : undefined;
	if (tool) return tool.call(args, theme, context);
	return renderFallbackCall(toolName, args, theme, context);
}

export function renderBoxedToolResult(
	toolName: unknown,
	result: { content?: readonly unknown[]; details?: unknown },
	options: { expanded: boolean; isPartial: boolean },
	theme: BoxTheme,
	context: BoxedToolContext,
): Component {
	const tool = typeof toolName === "string" ? REGISTRY[toolName] : undefined;
	if (tool) return tool.result(result, options, theme, context);
	return renderFallbackResult(toolName, result, options, theme, context);
}
