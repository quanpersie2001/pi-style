// Consecutive quiet-tool (read/ls/find) call batching.
//
// Groups back-to-back calls of the same quiet tool inside one assistant turn
// into a single collapsible, **boxless** tree panel instead of one boxed panel
// per call. The first call of a batch becomes its leader: the leader's call
// component renders the whole panel (header + tree), reading the live batch
// state on every render pass. Subsequent members render zero lines, so they
// consume no vertical space.
//
// Design notes:
// - No caching in the batch panel: it reads the module-level registry on every
//   render, so member completions (which trigger ui.requestRender via Pi's
//   tool_execution_end handler) are picked up without cross-component
//   invalidation plumbing.
// - Batch boundaries: a new batch starts when the active batch is closed. The
//   active batch closes when a non-batchable tool call is dispatched
//   (boxed/index.ts), when a new message starts (pi/index.ts), and on session
//   reset (session-coordinator.ts). A batch with a single member renders
//   exactly like the pre-batch single-call UI (zero regression).
// - No surrounding box: indentation and tree glyphs (├─/└─) carry the
//   hierarchy; the header line is the summary (` Read (N) · 0.08s`).
// - Errors stay visible: failed members are always rendered inline (even in the
//   collapsed state), with their error text indented beneath the path.
// - Per-file color: members read successfully use the primary (accent) color,
//   failed members use the error color; no word-count metadata.

import type { Component } from "@earendil-works/pi-tui";
import { stripAnsi } from "../../../shared/ansi.js";
import { type BoxTheme, formatToolTitlePrefix } from "../../../shared/box.js";
import { safeTruncateToWidth } from "../../../shared/render-budget.js";
import { getToolsRenderConfig } from "./session-config.js";
import type { BoxedToolContext } from "./shared.js";

/** Quiet tools whose calls group into a single batch panel. */
export const BATCHABLE_TOOL_NAMES: ReadonlySet<string> = new Set(["read", "ls", "find"]);

export function isBatchableTool(toolName: unknown): boolean {
	return typeof toolName === "string" && BATCHABLE_TOOL_NAMES.has(toolName);
}

export interface BatchToolMeta {
	readonly toolName: string;
	/** Human label shown in the batch header (e.g. "Read", "List", "Find"). */
	readonly label: string;
}

export type BatchMemberStatus = "pending" | "running" | "done";

export interface BatchMember {
	readonly toolCallId: string;
	detail: string;
	status: BatchMemberStatus;
	isError: boolean;
	errorText?: string;
}

export interface BatchState {
	readonly meta: BatchToolMeta;
	readonly leaderId: string;
	readonly startedAt: number;
	completedAt?: number;
	closed: boolean;
	readonly members: BatchMember[];
}

/** Tree head limit: only the first few members are listed, the rest collapse. */
const BATCH_TREE_HEAD_LIMIT = 5;
const BATCH_ERROR_LINES = 2;
/** Indent for tree lines below the header. */
const BATCH_TREE_INDENT = "  ";

/** Component rendered for non-leader batch members (zero height). */
export const EMPTY_BATCH_COMPONENT: Component = Object.freeze({
	invalidate() {},
	render() {
		return [];
	},
});

let activeBatch: BatchState | undefined;
const batchByCallId = new Map<string, BatchState>();

/** Close the current batch: no new members join; existing panels keep rendering. */
export function closeActiveBatch(): void {
	if (!activeBatch) return;
	activeBatch.closed = true;
	activeBatch = undefined;
}

/** Reset all batch state (session start/shutdown). */
export function resetBatchRegistry(): void {
	activeBatch = undefined;
	batchByCallId.clear();
}

function createBatch(meta: BatchToolMeta, leaderId: string, detail: string): BatchState {
	const batch: BatchState = {
		meta,
		leaderId,
		startedAt: performance.now(),
		closed: false,
		members: [{ toolCallId: leaderId, detail, status: "pending", isError: false }],
	};
	activeBatch = batch;
	batchByCallId.set(leaderId, batch);
	return batch;
}

/**
 * Register a call renderer invocation. Idempotent per toolCallId: re-fires
 * (updateDisplay on the same component) reuse the call's existing batch, even
 * after the batch was closed.
 */
export function registerBatchCall(
	meta: BatchToolMeta,
	detail: string,
	context: BoxedToolContext,
): { batch: BatchState; isLeader: boolean } {
	const existing = batchByCallId.get(context.toolCallId);
	if (existing) {
		const member = existing.members.find((entry) => entry.toolCallId === context.toolCallId);
		if (member) member.detail = detail;
		return { batch: existing, isLeader: existing.leaderId === context.toolCallId };
	}
	const current = activeBatch;
	if (!current || current.closed || current.meta.toolName !== meta.toolName) {
		closeActiveBatch();
		return { batch: createBatch(meta, context.toolCallId, detail), isLeader: true };
	}
	const member: BatchMember = {
		toolCallId: context.toolCallId,
		detail,
		status: "pending",
		isError: false,
	};
	current.members.push(member);
	batchByCallId.set(context.toolCallId, current);
	return { batch: current, isLeader: false };
}

export interface BatchResultData {
	readonly isPartial: boolean;
	readonly isError: boolean;
	readonly errorText: string | undefined;
}

/**
 * Register a result renderer invocation: updates the member's status/metadata
 * and records batch completion once every member has settled. The member's
 * display detail stays as registered by the call renderer (the result context's
 * args may be normalized differently).
 */
export function registerBatchResult(
	meta: BatchToolMeta,
	data: BatchResultData,
	context: BoxedToolContext,
): { batch: BatchState | undefined; isLeader: boolean } {
	const batch = batchByCallId.get(context.toolCallId);
	if (!batch || batch.meta.toolName !== meta.toolName) return { batch: undefined, isLeader: false };
	const member = batch.members.find((entry) => entry.toolCallId === context.toolCallId);
	if (member) {
		member.status = data.isPartial ? "running" : "done";
		member.isError = !data.isPartial && data.isError;
		if (member.isError && data.errorText !== undefined) member.errorText = data.errorText;
		else delete member.errorText;
	}
	if (batch.completedAt === undefined && batch.members.every((entry) => entry.status === "done")) {
		batch.completedAt = performance.now();
	}
	return { batch, isLeader: batch.leaderId === context.toolCallId };
}

interface BatchStatus {
	readonly total: number;
	readonly done: number;
	readonly failed: number;
	readonly allDone: boolean;
	readonly elapsedMs: number | undefined;
}

function batchStatus(batch: BatchState): BatchStatus {
	let done = 0;
	let failed = 0;
	for (const member of batch.members) {
		if (member.status !== "done") continue;
		done++;
		if (member.isError) failed++;
	}
	const total = batch.members.length;
	const allDone = done === total;
	return {
		total,
		done,
		failed,
		allDone,
		elapsedMs: allDone && batch.completedAt !== undefined ? batch.completedAt - batch.startedAt : undefined,
	};
}

function formatElapsed(theme: BoxTheme, elapsedMs: number): string {
	return theme.fg("dim", ` · ${(elapsedMs / 1000).toFixed(2)}s`);
}

function bold(theme: BoxTheme, text: string): string {
	return typeof theme?.bold === "function" ? theme.bold(text) : text;
}

/** Header line: state glyph + batch label(count) + progress/elapsed (no box). */
function formatBatchHeader(theme: BoxTheme, batch: BatchState, status: BatchStatus): string {
	const label = `${batch.meta.label} (${status.total})`;
	if (status.failed > 0) return theme.fg("error", bold(theme, `✗ ${label} · ${status.failed} failed`));
	if (status.allDone) {
		const glyph = getToolsRenderConfig().batchOpenGlyph;
		const elapsed = status.elapsedMs === undefined ? "" : formatElapsed(theme, status.elapsedMs);
		return `${theme.fg("text", bold(theme, `${glyph} ${label}`))}${elapsed}`;
	}
	if (status.done > 0)
		return `${theme.fg("text", bold(theme, `◌ ${label}`))}${theme.fg("dim", ` · ${status.done}/${status.total}`)}`;
	return bold(theme, formatToolTitlePrefix(theme, label));
}

function memberGlyph(theme: BoxTheme, member: BatchMember, show: boolean): string {
	if (!show) return "";
	if (member.isError) return theme.fg("error", "✗");
	if (member.status === "done") return theme.fg("success", "✓");
	return theme.fg("text", "◌");
}

function renderErrorLines(theme: BoxTheme, errorText: string, width: number): string[] {
	const raw = stripAnsi(errorText)
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (raw.length === 0) return [];
	const prefix = `${theme.fg("borderMuted", "  │  ")}`;
	const out = raw
		.slice(0, BATCH_ERROR_LINES)
		.map((line) => safeTruncateToWidth(`${prefix}${theme.fg("error", line)}`, Math.max(1, width), "…"));
	if (raw.length > BATCH_ERROR_LINES)
		out.push(safeTruncateToWidth(`${prefix}${theme.fg("error", "…")}`, Math.max(1, width), "…"));
	return out;
}

function renderBatchTree(theme: BoxTheme, batch: BatchState, status: BatchStatus, width: number): string[] {
	const showGlyphs = !status.allDone || status.failed > 0;
	const visible = batch.members.slice(0, BATCH_TREE_HEAD_LIMIT);
	const more = batch.members.length - visible.length;
	const lastIndex = visible.length - 1;
	const out: string[] = [];
	for (let i = 0; i < visible.length; i++) {
		const member = visible[i];
		if (!member) continue;
		const branch = i < lastIndex || more > 0 ? "├─" : "└─";
		const glyph = memberGlyph(theme, member, showGlyphs);
		// Primary color for files read successfully, error red for failures.
		const pathColor = member.isError ? "error" : member.status === "done" ? "accent" : "text";
		const line = `${BATCH_TREE_INDENT}${theme.fg("borderMuted", branch)}${glyph ? ` ${glyph}` : ""} ${theme.fg(pathColor, member.detail)}`;
		out.push(safeTruncateToWidth(line, Math.max(1, width), "…"));
		if (member.isError && member.errorText) out.push(...renderErrorLines(theme, member.errorText, width));
	}
	if (more > 0) {
		out.push(
			safeTruncateToWidth(
				`${BATCH_TREE_INDENT}${theme.fg("borderMuted", "└─")} ${theme.fg("dim", `${more} more`)}`,
				Math.max(1, width),
				"…",
			),
		);
	}
	return out;
}

function renderBatchPanelLines(theme: BoxTheme, batch: BatchState, status: BatchStatus, width: number): string[] {
	// The tree stays open in every state: no collapsed single-line summary.
	const lines = [formatBatchHeader(theme, batch, status)];
	lines.push(...renderBatchTree(theme, batch, status, width));
	return lines;
}

/**
 * Leader call component: delegates to the single-call UI while the batch has a
 * single member (no behavior change for lone calls), otherwise renders the live
 * batch panel.
 */
export function renderBatchAwareCall(theme: BoxTheme, batch: BatchState, single: Component): Component {
	return {
		invalidate() {
			single.invalidate?.();
		},
		render(width: number): string[] {
			if (batch.members.length <= 1) return single.render(width);
			return renderBatchPanelLines(theme, batch, batchStatus(batch), width);
		},
	};
}

/**
 * Leader result component: delegates to the single-result UI for lone calls;
 * for real batches the panel lives in the call component, so the result adds
 * nothing.
 */
export function renderBatchAwareResult(batch: BatchState, single: Component): Component {
	return {
		invalidate() {
			single.invalidate?.();
		},
		render(width: number): string[] {
			if (batch.members.length <= 1) return single.render(width);
			return [];
		},
	};
}
