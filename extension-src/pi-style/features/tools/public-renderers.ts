import type { ToolRendererResolver, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { renderBoxedToolCall, renderBoxedToolResult } from "./boxed/index.js";

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
