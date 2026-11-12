import type { ToolRenderers } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetBatchRegistry } from "../../extension-src/pi-style/features/tools/boxed/batch.js";
import * as boxed from "../../extension-src/pi-style/features/tools/boxed/index.js";
import { stopAllElapsedTickers } from "../../extension-src/pi-style/features/tools/boxed/session-config.js";
import { createToolDecorationOwner } from "../../extension-src/pi-style/features/tools/index.js";
import {
	createPublicToolRenderers,
	publicToolRendererBridge,
} from "../../extension-src/pi-style/features/tools/public-renderers.js";
import { FakePiHost } from "../helpers/fake-pi-host.js";
import { createFakeTheme } from "../helpers/fake-theme.js";

const child = () => ({ render: () => ["native"], invalidate() {} });
const theme = createFakeTheme();
const context = () => ({
	args: { path: "fixture.ts" },
	toolCallId: "fixture",
	invalidate: vi.fn(),
	state: {},
	cwd: "/fake",
	executionStarted: true,
	argsComplete: true,
	isPartial: false,
	expanded: false,
	showImages: false,
	isError: false,
	lastComponent: undefined,
});

afterEach(() => {
	resetBatchRegistry();
	stopAllElapsedTickers();
	vi.restoreAllMocks();
});

describe("public built-in renderer adapter", () => {
	it("resolves fake-host callbacks in native extension registration order", () => {
		const host = new FakePiHost();
		const order: string[] = [];
		for (const name of ["first", "second"]) {
			host.extensionApi.registerToolRenderer((_tool, next) => {
				order.push(name);
				return next();
			});
		}
		host.resolveToolRenderers("read", () => {
			order.push("native");
			return undefined;
		});
		expect(order).toEqual(["first", "second", "native"]);
	});
	it.each(["read", "write", "edit", "grep", "find", "ls"])(
		"wraps default-shell %s without modifying the downstream object",
		(name) => {
			const route = createPublicToolRenderers();
			const downstream = Object.freeze({ renderCall: child, renderResult: child });
			const next = vi.fn(() => downstream);
			const selected = route.resolver(name, next);
			expect(next).toHaveBeenCalledOnce();
			expect(selected?.renderShell).toBe("default");
			expect(publicToolRendererBridge(selected?.renderCall)).toBeDefined();
			expect(downstream.renderCall).toBe(child);
		},
	);

	it("renderer selection never changes execution/schema/prompt fields", () => {
		const route = createPublicToolRenderers();
		const downstream = Object.freeze({
			renderCall: child,
			renderResult: child,
			execute: vi.fn(),
			parameters: Object.freeze({ type: "object" }),
			description: "description",
			promptSnippet: "snippet",
			promptGuidelines: Object.freeze(["guideline"]),
		});
		const selected = route.resolver("read", () => downstream);
		for (const key of ["execute", "parameters", "description", "promptSnippet", "promptGuidelines"] as const) {
			expect(Reflect.get(selected as object, key)).toBe(downstream[key]);
		}
		expect(downstream.execute).not.toHaveBeenCalled();
	});

	it("unknown and self-shell ownership delegates next exactly once", () => {
		const route = createPublicToolRenderers();
		for (const [name, downstream] of [
			["custom", { renderCall: child }],
			["read", { renderShell: "self", renderCall: child }],
		] as const) {
			const next = vi.fn(() => downstream);
			expect(route.resolver(name, next)).toBe(downstream);
			expect(next).toHaveBeenCalledOnce();
		}
		expect(route.resolver("read", () => undefined)).toBeUndefined();
	});

	it("no certified bridge means native delegation, even with compact policy enabled", () => {
		const route = createPublicToolRenderers();
		route.configure(true);
		const native = vi.fn(child);
		const dispatch = vi.spyOn(boxed, "renderBoxedToolCall");
		const selected = route.resolver("read", () => ({ renderCall: native }));
		selected?.renderCall?.({}, theme, context());
		expect(native).toHaveBeenCalledOnce();
		expect(dispatch).not.toHaveBeenCalled();
	});

	it("public owns exactly one visual dispatch; native/compact states and call/result children never mix", () => {
		const route = createPublicToolRenderers();
		const nativeCall = vi.fn(child);
		const nativeResult = vi.fn(child);
		const selected = route.resolver("read", () => ({
			renderCall: nativeCall,
			renderResult: nativeResult,
		})) as ToolRenderers;
		const ctx = context();
		const output = { content: [], details: {} };
		const options = { expanded: false, isPartial: false };
		const nativeChild = selected.renderCall?.(ctx.args, theme, ctx);
		const nativeResultChild = selected.renderResult?.(output, options, theme, ctx);
		const nativeState = nativeCall.mock.calls[0]?.[2]?.state;
		const dispatch = vi.spyOn(boxed, "renderBoxedToolCall");
		const owner = createToolDecorationOwner({ style: "compact-box" });
		const contentBox = { paddingX: 1, paddingY: 1, setBgFn: vi.fn() };
		const instance = { toolName: "read", contentBox, setExpanded: vi.fn() };
		const call = owner.decorateToolRendererSelection("tool-call-renderer", () => selected.renderCall, instance, []) as (
			...args: unknown[]
		) => unknown;
		route.configure(true);
		const compactChild = call(ctx.args, theme, ctx);
		expect(dispatch).toHaveBeenCalledOnce();
		expect(nativeCall).toHaveBeenCalledOnce();
		expect(contentBox.paddingY).toBe(0);
		const compactState = dispatch.mock.calls[0]?.[3]?.state;
		expect(compactState).not.toBe(nativeState);
		route.configure(false);
		call(ctx.args, theme, { ...ctx, lastComponent: compactChild });
		selected.renderResult?.(output, options, theme, { ...ctx, lastComponent: compactChild });
		expect(nativeCall.mock.calls.at(-1)?.[2]).toMatchObject({ state: nativeState, lastComponent: nativeChild });
		expect(nativeResult.mock.calls.at(-1)?.[3]).toMatchObject({ state: nativeState, lastComponent: nativeResultChild });
		expect(contentBox.paddingY).toBe(1);
		route.configure(true);
		call(ctx.args, theme, ctx);
		expect(dispatch.mock.calls.at(-1)?.[3]?.state).toBe(compactState);
		owner.dispose();
		expect(contentBox.paddingY).toBe(1);
	});

	it("only bridged native-mode row contexts own invalidation, never unbridged same-ID consumers", () => {
		const route = createPublicToolRenderers();
		const ctx = context();
		const selected = route.resolver("read", () => ({ renderCall: child }));
		const owner = createToolDecorationOwner({ style: "compact-box" });
		const call = owner.decorateToolRendererSelection("tool-call-renderer", () => selected?.renderCall, {}, []) as (
			...args: unknown[]
		) => unknown;
		call({}, theme, ctx); // bridge is authoritative even before compact is ready
		const exported = { ...context(), invalidate: vi.fn() };
		selected?.renderCall?.({}, theme, exported);
		route.invalidate();
		expect(ctx.invalidate).toHaveBeenCalledOnce();
		expect(exported.invalidate).not.toHaveBeenCalled();
		route.clear();
		route.invalidate();
		expect(ctx.invalidate).toHaveBeenCalledOnce();
		owner.dispose();
	});

	it("unbridged pre-start contexts cannot claim live invalidation", () => {
		const route = createPublicToolRenderers();
		const ctx = context();
		route.resolver("read", () => ({ renderCall: child }))?.renderCall?.({}, theme, ctx);
		route.configure(true);
		route.invalidate();
		expect(ctx.invalidate).not.toHaveBeenCalled();
		route.clear();
	});

	it("malformed row fallback restores only that row's shell", () => {
		const route = createPublicToolRenderers();
		route.configure(true);
		const selected = route.resolver("read", () => ({ renderCall: child }));
		const owner = createToolDecorationOwner({ style: "compact-box" });
		const boxes = [0, 1].map(() => ({ paddingX: 1, paddingY: 1, setBgFn() {} }));
		const calls = boxes.map(
			(contentBox) =>
				owner.decorateToolRendererSelection("tool-call-renderer", () => selected?.renderCall, { contentBox }, []) as (
					...args: unknown[]
				) => unknown,
		);
		calls.forEach((call, i) => {
			call({}, theme, { ...context(), toolCallId: `row-${i}` });
		});
		expect(boxes.map((box) => box.paddingY)).toEqual([0, 0]);
		calls[0]({}, theme, { ...context(), state: undefined });
		expect(boxes.map((box) => box.paddingY)).toEqual([1, 0]);
		route.clear();
		expect(boxes.map((box) => box.paddingY)).toEqual([1, 1]);
		owner.dispose();
	});

	it("bash returns the exact downstream definition and callbacks in every policy mode", () => {
		const route = createPublicToolRenderers();
		const downstream = Object.freeze({ renderCall: vi.fn(child), renderResult: vi.fn(child) });
		for (const enabled of [false, true, false]) {
			route.configure(enabled);
			const next = vi.fn(() => downstream);
			expect(route.resolver("bash", next)).toBe(downstream);
			expect(next).toHaveBeenCalledOnce();
			expect(publicToolRendererBridge(downstream.renderCall)).toBeUndefined();
			expect(publicToolRendererBridge(downstream.renderResult)).toBeUndefined();
		}
		const ctx = { ...context(), isPartial: true };
		const selected = route.resolver("bash", () => downstream);
		selected?.renderCall?.(ctx.args, theme, ctx);
		selected?.renderResult?.({ content: [], details: {} }, { isPartial: true, expanded: false }, theme, ctx);
		expect(downstream.renderCall.mock.calls[0]?.[2]).toBe(ctx);
		expect(downstream.renderResult.mock.calls[0]?.[3]).toBe(ctx);
		route.invalidate();
		expect(ctx.invalidate).not.toHaveBeenCalled();
	});
});
