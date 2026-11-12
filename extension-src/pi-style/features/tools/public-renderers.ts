import { stripVTControlCharacters } from "node:util";
import type { ToolRendererResolver, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { getCapabilities } from "@earendil-works/pi-tui";
import {
	formatToolName,
	formatToolParamLines,
	getTextOutput,
	selectRenderLines,
	renderBoxedToolCall as standaloneCall,
	renderBoxedToolResult as standaloneResult,
} from "../../shared/box.js";
import { renderBoxedToolCall, renderBoxedToolResult } from "./boxed/index.js";
import { getToolsRenderConfig } from "./boxed/session-config.js";
import { TEAM_TOOL_NAMES } from "./boxed/teams.js";

// Bash stays entirely on the legacy route: its native streaming callbacks own
// subscriptions for which the public renderer API provides no cleanup contract.
const BUILT_INS = new Set(["read", "write", "edit", "grep", "find", "ls"]);
type Callback = NonNullable<ToolRenderers["renderCall"]>;
type Context = Parameters<Callback>[2];
type Bridge = {
	active(): boolean;
	invoke(receiver: unknown, args: unknown[], boxed: boolean, restoreShell: () => void): unknown;
};
const bridges = new WeakMap<object, Bridge>();
const detachedCallbacks = new WeakSet<object>();

/** Identity certificate, not a tool-name or self-shell exemption. */
export function isDetachedToolRenderer(callback: unknown): boolean {
	return typeof callback === "function" && detachedCallbacks.has(callback);
}

/** Strip untrusted terminal commands before theme styling, retaining LF/tab. */
function detachedText(value: string): string {
	return Array.from(stripVTControlCharacters(value))
		.filter((char) => {
			const code = char.charCodeAt(0);
			return code === 9 || code === 10 || (code >= 32 && (code < 127 || code > 159));
		})
		.join("");
}
// Like boxed session config, policy follows the current session, including
// retained callback definitions created before a replacement coordinator binds.
let compact = false;
let invalidators = new Map<string, { invalidate: () => void; restoreShell: () => void }>();

/** Exact callbacks only; presence of the public API never certifies a native selector. */
export function publicToolRendererBridge(callback: unknown): Bridge | undefined {
	return typeof callback === "function" ? bridges.get(callback) : undefined;
}

/** Default-shell override deliberately matches the legacy compact policy, including
 * extension callbacks using built-in names. No execution definitions are touched. */
export function createPublicToolRenderers() {
	compact = false;
	const caches = new WeakMap<
		object,
		Record<string, { state: Record<string, unknown>; call?: unknown; result?: unknown }>
	>();
	const resolver: ToolRendererResolver = (name, next) => {
		const downstream = next();
		if (
			!BUILT_INS.has(name) ||
			!downstream ||
			(downstream.renderShell !== undefined && downstream.renderShell !== "default")
		)
			return downstream;
		let bridgeDepth = 0;
		const contextFor = (ctx: Context, slot: "call" | "result") => {
			let cache = caches.get(ctx.state);
			if (!cache) {
				cache = {};
				caches.set(ctx.state, cache);
			}
			const boxed = compact && bridgeDepth > 0;
			const mode = boxed ? "compact" : "native";
			cache[mode] ??= { state: {} };
			const bucket = cache[mode];
			return {
				boxed,
				context: { ...ctx, state: bucket.state, lastComponent: bucket[slot] } as Context,
				save: (component: unknown) => {
					bucket[slot] = component;
					return component as ReturnType<Callback>;
				},
			};
		};
		const renderCall: Callback = (args, theme, ctx) => {
			if (!ctx?.state || typeof ctx.state !== "object")
				return downstream.renderCall?.(args, theme, ctx) as ReturnType<Callback>;
			const { boxed, context, save } = contextFor(ctx, "call");
			return save(
				boxed
					? renderBoxedToolCall(name, args as Record<string, unknown>, theme as never, context as never)
					: downstream.renderCall?.(args, theme, context),
			);
		};
		const renderResult: NonNullable<ToolRenderers["renderResult"]> = (result, options, theme, ctx) => {
			if (!ctx?.state || typeof ctx.state !== "object")
				return downstream.renderResult?.(result, options, theme, ctx) as ReturnType<Callback>;
			const { boxed, context, save } = contextFor(ctx, "result");
			return save(
				boxed
					? renderBoxedToolResult(name, result, options, theme as never, context as never)
					: downstream.renderResult?.(result, options, theme, context),
			);
		};
		for (const callback of [renderCall, renderResult])
			bridges.set(callback, {
				active: () => compact,
				invoke(receiver, args, boxed, restoreShell) {
					const ctx = args.at(-1) as Context;
					// Only the certified row selector calls this bridge. Direct public
					// consumers (including HTML export) must not own TUI invalidation.
					invalidators.set(ctx.toolCallId, { invalidate: ctx.invalidate, restoreShell });
					if (boxed) bridgeDepth++;
					try {
						return Reflect.apply(callback, receiver, args);
					} finally {
						if (boxed) bridgeDepth--;
					}
				},
			});
		return {
			...downstream,
			renderShell: "default",
			...(downstream.renderCall ? { renderCall } : {}),
			...(downstream.renderResult ? { renderResult } : {}),
		};
	};
	return {
		resolver,
		configure(enabled: boolean) {
			compact = enabled;
		},
		invalidate() {
			for (const { invalidate } of [...invalidators.values()]) invalidate();
		},
		prune(retain: (id: string) => boolean) {
			for (const [id, row] of invalidators)
				if (!retain(id)) {
					row.restoreShell();
					invalidators.delete(id);
				}
		},
		clear() {
			for (const { restoreShell } of invalidators.values()) restoreShell();
			invalidators = new Map();
		},
	};
}

/** Display-only, row-local public route for detached transcripts. Deliberately
 * bypasses Main's batch/turn/grep/ticker registries: no cross-message batching,
 * live elapsed metadata, execution definitions, or session cwd are borrowed. */
export function detachedToolRenderers(name: string): ToolRenderers | undefined {
	if (!BUILT_INS.has(name) && !TEAM_TOOL_NAMES.has(name)) return undefined;
	const renderers: ToolRenderers = {
		renderShell: "self",
		renderCall(args, theme, ctx) {
			return standaloneCall(theme, formatToolName(name), formatToolParamLines(args).map(detachedText), {
				isError: ctx.isError,
				isPartial: ctx.isPartial,
				isPending: ctx.isPartial,
				running: ctx.executionStarted,
			});
		},
		renderResult(result, options, theme, ctx) {
			const details = result.details as { diff?: unknown; truncation?: { truncated?: boolean } } | undefined;
			const text = detachedText(getTextOutput(result) || (typeof details?.diff === "string" ? details.diff : ""));
			const images =
				!ctx.showImages || !getCapabilities().images
					? result.content
							.filter((block) => block.type === "image")
							.map((block) => `[image: ${detachedText(block.mimeType)}]`)
					: [];
			const output = [text, ...images].filter(Boolean).join("\n");
			const config = getToolsRenderConfig();
			const { lines, omitted } = selectRenderLines(
				output,
				options.expanded ? config.maxExpandedLines : config.maxCollapsedLines,
			);
			return standaloneResult(
				theme,
				() => [
					...lines.map((line) => theme.fg(ctx.isError ? "error" : config.dimOutput ? "dim" : "toolOutput", line)),
					...(details?.truncation?.truncated ? [theme.fg("muted", "[native tool output truncated]")] : []),
					...(options.expanded && omitted > 0
						? [theme.fg("muted", `… ${omitted} more lines omitted by render budget`)]
						: []),
				],
				{
					isError: ctx.isError,
					isPartial: options.isPartial,
					...(options.expanded || omitted <= 0 ? {} : { expandHint: "Ctrl+O for more" }),
				},
			);
		},
	};
	for (const callback of [renderers.renderCall, renderers.renderResult]) if (callback) detachedCallbacks.add(callback);
	return renderers;
}
