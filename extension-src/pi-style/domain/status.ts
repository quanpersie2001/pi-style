import type { ResolvedTheme, SemanticToken } from "./theme.js";

export const STATUS_SEGMENT_IDS = [
	"pi",
	"model",
	"thinking",
	"path",
	"git",
	"context_pct",
	"context_total",
	"auto_compact",
	"token_in",
	"token_out",
	"cache_read",
	"cache_write",
	"cost",
	"time_spent",
	"time",
	"hostname",
	"session",
	"extension_statuses",
] as const;
export type StatusSegmentId = (typeof STATUS_SEGMENT_IDS)[number] | (string & {});
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type ContextState = "low" | "medium" | "high" | "critical";

export interface GitSnapshot {
	readonly available: boolean;
	readonly branch: string | null;
	readonly staged: number;
	readonly unstaged: number;
	readonly untracked: number;
	readonly ahead?: number;
	readonly behind?: number;
	readonly refreshing: boolean;
	readonly error?: string;
}

export interface ContextSnapshot {
	readonly currentTokens?: number;
	readonly windowTokens?: number;
	readonly percent?: number;
	readonly state?: ContextState;
	readonly autoCompacting?: boolean;
	readonly customCompaction?: string;
}

export interface UsageSnapshot {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheReadTokens: number;
	readonly cacheWriteTokens: number;
	readonly cost?: number;
	readonly currency?: string;
	readonly subscriptionMode?: "api" | "subscription" | "unknown";
	readonly streaming: boolean;
}

export interface ExtensionStatus {
	readonly key: string;
	readonly value: string;
}

export interface StatusSnapshot {
	readonly model?: string;
	readonly thinkingLevel?: ThinkingLevel;
	readonly cwd?: string;
	readonly git?: GitSnapshot;
	readonly context?: ContextSnapshot;
	readonly usage?: UsageSnapshot;
	readonly hostname?: string;
	readonly sessionName?: string | undefined;
	readonly sessionId?: string | undefined;
	readonly sessionStartedAt?: number;
	readonly extensionStatuses?: readonly ExtensionStatus[];
}

export interface StatusSegmentOptions {
	readonly disabled?: boolean;
	readonly label?: string;
	readonly [key: string]: unknown;
}

export interface SegmentContext {
	readonly snapshot: StatusSnapshot;
	readonly theme: ResolvedTheme;
	readonly options: Readonly<Record<string, StatusSegmentOptions | undefined>>;
	readonly width: number;
}

export interface SegmentRenderResult {
	readonly visible: boolean;
	readonly content: string;
	readonly compactContent?: string;
	readonly minWidth?: number;
	readonly truncatable?: boolean;
}

export interface StatusSegment {
	readonly id: StatusSegmentId;
	readonly defaultPriority: number;
	readonly essential?: boolean;
	readonly overflow?: "primary" | "secondary" | "drop";
	render(context: SegmentContext): SegmentRenderResult;
}

export interface StatusLayout {
	readonly left: readonly StatusSegmentId[];
	readonly right: readonly StatusSegmentId[];
	readonly secondary: readonly StatusSegmentId[];
}

export interface StatusRenderResult {
	readonly primary: string;
	readonly secondary?: string;
	readonly lines: readonly string[];
	readonly visibleSegments: readonly StatusSegmentId[];
}

function segment(
	id: StatusSegmentId,
	priority: number,
	render: StatusSegment["render"],
	essential = false,
): StatusSegment {
	return { id, defaultPriority: priority, essential, overflow: essential ? "primary" : "secondary", render };
}

export function createBuiltinSegments(): ReadonlyMap<StatusSegmentId, StatusSegment> {
	const segments: StatusSegment[] = [
		segment("pi", 10, ({ theme }) => ({
			visible: true,
			content: `${theme.glyph("pi")} pi`,
			compactContent: theme.glyph("pi"),
		})),
		segment(
			"model",
			100,
			({ snapshot }) => ({
				visible: Boolean(snapshot.model),
				content: snapshot.model ?? "",
				compactContent: snapshot.model ?? "",
			}),
			true,
		),
		segment(
			"thinking",
			95,
			({ snapshot }) => ({
				visible: Boolean(snapshot.thinkingLevel),
				content: snapshot.thinkingLevel ? `think:${snapshot.thinkingLevel}` : "",
				compactContent: snapshot.thinkingLevel ? `t:${snapshot.thinkingLevel}` : "",
			}),
			true,
		),
		segment("path", 80, ({ snapshot }) => ({
			visible: Boolean(snapshot.cwd),
			content: snapshot.cwd ?? "",
			compactContent: snapshot.cwd?.split(/[\\/]/).filter(Boolean).at(-1) ?? "",
		})),
		segment("git", 75, ({ snapshot, theme }) => {
			const git = snapshot.git;
			if (!git?.available || !git.branch) return { visible: false, content: "" };
			const counts = `${git.staged ? ` +${git.staged}` : ""}${git.unstaged ? ` *${git.unstaged}` : ""}${git.untracked ? ` ?${git.untracked}` : ""}`;
			return {
				visible: true,
				content: `${theme.glyph("git")} ${git.branch}${counts}`,
				compactContent: `${theme.glyph("git")} ${git.branch}`,
			};
		}),
		segment(
			"context_pct",
			90,
			({ snapshot }) => {
				const percent = contextPercent(snapshot.context ?? {});
				return {
					visible: percent !== undefined,
					content: percent === undefined ? "" : `ctx:${Math.round(percent)}%`,
					compactContent: percent === undefined ? "" : `${Math.round(percent)}%`,
				};
			},
			true,
		),
		segment("context_total", 60, ({ snapshot }) => ({
			visible: snapshot.context?.currentTokens !== undefined && snapshot.context.windowTokens !== undefined,
			content:
				snapshot.context?.currentTokens !== undefined && snapshot.context.windowTokens !== undefined
					? `${snapshot.context.currentTokens}/${snapshot.context.windowTokens}`
					: "",
		})),
		segment("auto_compact", 55, ({ snapshot }) => ({
			visible: Boolean(snapshot.context?.autoCompacting || snapshot.context?.customCompaction),
			content: snapshot.context?.customCompaction ?? "compacting",
			compactContent: "compact",
		})),
		segment("token_in", 50, ({ snapshot }) => ({
			visible: snapshot.usage?.inputTokens !== undefined,
			content: `in:${snapshot.usage?.inputTokens ?? 0}`,
			compactContent: `i:${snapshot.usage?.inputTokens ?? 0}`,
		})),
		segment("token_out", 50, ({ snapshot }) => ({
			visible: snapshot.usage?.outputTokens !== undefined,
			content: `out:${snapshot.usage?.outputTokens ?? 0}`,
			compactContent: `o:${snapshot.usage?.outputTokens ?? 0}`,
		})),
		segment("cache_read", 40, ({ snapshot }) => ({
			visible: Boolean(snapshot.usage?.cacheReadTokens),
			content: `cache:${snapshot.usage?.cacheReadTokens ?? 0}`,
			compactContent: `cr:${snapshot.usage?.cacheReadTokens ?? 0}`,
		})),
		segment("cache_write", 35, ({ snapshot }) => ({
			visible: Boolean(snapshot.usage?.cacheWriteTokens),
			content: `cw:${snapshot.usage?.cacheWriteTokens ?? 0}`,
		})),
		segment("cost", 65, ({ snapshot }) => ({
			visible: snapshot.usage?.cost !== undefined && snapshot.usage.cost > 0,
			content: snapshot.usage?.cost === undefined ? "" : `$${snapshot.usage.cost.toFixed(2)}`,
			compactContent: snapshot.usage?.cost === undefined ? "" : `$${snapshot.usage.cost.toFixed(2)}`,
		})),
		segment("time_spent", 25, ({ snapshot }) => ({
			visible: snapshot.sessionStartedAt !== undefined,
			content: snapshot.sessionStartedAt === undefined ? "" : formatElapsed(Date.now() - snapshot.sessionStartedAt),
			compactContent:
				snapshot.sessionStartedAt === undefined ? "" : formatElapsed(Date.now() - snapshot.sessionStartedAt),
		})),
		segment("time", 20, () => ({
			visible: true,
			content: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
			compactContent: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
		})),
		segment("hostname", 20, ({ snapshot }) => ({
			visible: Boolean(snapshot.hostname),
			content: snapshot.hostname ?? "",
		})),
		segment("session", 20, ({ snapshot }) => ({
			visible: Boolean(snapshot.sessionName || snapshot.sessionId),
			content: snapshot.sessionName ?? snapshot.sessionId ?? "",
		})),
		segment("extension_statuses", 30, ({ snapshot }) => ({
			visible: Boolean(snapshot.extensionStatuses?.length),
			content: snapshot.extensionStatuses?.map((item) => `${item.key}:${item.value}`).join(" ") ?? "",
		})),
	];
	return new Map(segments.map((item) => [item.id, item]));
}

function formatElapsed(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function contextState(percent: number | undefined): ContextState | undefined {
	if (percent === undefined || !Number.isFinite(percent)) return undefined;
	if (percent >= 90) return "critical";
	if (percent >= 75) return "high";
	if (percent >= 50) return "medium";
	return "low";
}

export function normalizeThinkingLevel(value: unknown): ThinkingLevel {
	return ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value as string)
		? (value as ThinkingLevel)
		: "off";
}

export function contextPercent(
	value: Pick<ContextSnapshot, "currentTokens" | "windowTokens" | "percent">,
): number | undefined {
	const percent =
		value.percent ??
		(value.currentTokens !== undefined && value.windowTokens
			? (value.currentTokens / value.windowTokens) * 100
			: undefined);
	return percent === undefined ? undefined : Math.max(0, Math.min(100, percent));
}

export function contextSemanticToken(state: ContextState): SemanticToken {
	return state === "critical"
		? "contextCritical"
		: state === "high"
			? "contextHigh"
			: state === "medium"
				? "contextMedium"
				: "contextLow";
}
