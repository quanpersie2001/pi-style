// Presentation-only adapters for pi-teams tools. Never read its files or own its run state.
import type { Component } from "@earendil-works/pi-tui";
import { fgHex, isHexColor, stripAnsi } from "../../../shared/ansi.js";
import type { BoxTheme } from "../../../shared/box.js";
import { safeTruncateToWidth } from "../../../shared/render-budget.js";
import { type BatchToolMeta, EMPTY_BATCH_COMPONENT, registerBatchCall, registerBatchResult } from "./batch.js";
import { getToolsRenderConfig } from "./session-config.js";
import type { BoxedToolDefinition, BoxedToolResult } from "./shared.js";
import { rememberTeammateResult, rememberTeammateRun, teammateColorForRun, teammateForRun } from "./team-run-labels.js";

export const TEAM_TOOL_NAMES: ReadonlySet<string> = new Set([
	"Agent",
	"get_subagent_result",
	"steer_subagent",
	"send_message",
	"team_task_create",
	"team_task_update",
	"team_task_get",
	"team_task_list",
]);

const agentMeta = (mode: string): BatchToolMeta => ({
	toolName: `Agent:${mode}`,
	label: "Teammate",
});
const empty: Component = { render: () => [], invalidate() {} };
const clean = (value: unknown, limit = 220): string =>
	typeof value === "string"
		? stripAnsi(value)
				.replace(/\p{Cc}/gu, " ")
				.trim()
				.slice(0, limit)
		: "";
const short = (value: unknown): string => clean(value, 24);
const rawText = (result: BoxedToolResult): string =>
	(result.content ?? [])
		.filter(
			(part): part is { type: "text"; text: string } =>
				!!part &&
				typeof part === "object" &&
				(part as { type?: unknown }).type === "text" &&
				typeof (part as { text?: unknown }).text === "string",
		)
		.map((part) => part.text)
		.join("\n");
const details = (result: BoxedToolResult): Record<string, unknown> =>
	result.details && typeof result.details === "object" && !Array.isArray(result.details)
		? (result.details as Record<string, unknown>)
		: {};
// Do not assume the pi-teams setting backgroundByDefault: omission does not
// establish an effective mode. Explicit modes split adjacent batches.
const modeKey = (args: Record<string, unknown>): "background" | "foreground" | "unspecified" =>
	args.run_in_background === true ? "background" : args.run_in_background === false ? "foreground" : "unspecified";
const plural = (n: number): string => (n === 1 ? "teammate" : "teammates");
const glyph = (): string => (getToolsRenderConfig().nerdFonts ? "\uf086" : "✉");
// An absent pi-teams color gets the theme's generic accent, not an invented
// teammate-specific color. Keep the ANSI span limited to the @reference.
const styledTeammate = (theme: BoxTheme, label: string, color?: unknown): string =>
	typeof color === "string" && isHexColor(color) ? fgHex(theme, color, label) : theme.fg("accent", label);

function rows(lines: () => string[], max = 8): Component {
	return {
		invalidate() {},
		render(width: number) {
			if (width < 8) return [];
			return lines()
				.slice(0, max)
				.map((line) => safeTruncateToWidth(line, width));
		},
	};
}
function simple(text: string, theme: BoxTheme): Component {
	return rows(() => [theme.fg("dim", text)], 1);
}
function agentDetail(args: Record<string, unknown>, theme: BoxTheme, result?: BoxedToolResult): string {
	const data = details(result ?? {});
	const who = short(data.teammateName) || short(args.name);
	const description = clean(args.description, 100);
	// Color and name are optional metadata from the owning runtime, never
	// inferred from specialist definitions or teammate names.
	const parts = [who ? styledTeammate(theme, `@${who}`, data.color) : description || "Teammate"];
	if (who && description) parts.push(description);
	// Only the admitted model is authoritative; an invocation model can fall back.
	if (typeof data.model === "string") parts.push(clean(data.model, 120).split("/").at(-1)?.slice(0, 48) ?? "");
	if (typeof data.thinking === "string") parts.push(`thinking ${short(data.thinking)}`);
	// Definition pins override max_turns in the invocation. Only an effective
	// limit published by pi-teams is safe to label as the actual maximum.
	if (typeof data.maxTurns === "number" && Number.isSafeInteger(data.maxTurns) && data.maxTurns > 0)
		parts.push(`max ${data.maxTurns} turns`);
	return parts.join(" · ");
}
function agentLine(
	theme: BoxTheme,
	batch: { members: readonly { detail: string; effectiveMode?: "background" | "foreground" }[] },
	mode: string,
	expanded: boolean,
): string[] {
	const members = batch.members;
	const confirmed =
		mode === "unspecified" && members.every((m) => m.effectiveMode === "background")
			? "background"
			: mode === "unspecified" && members.every((m) => m.effectiveMode === "foreground")
				? "foreground"
				: mode;
	const title = `${theme.fg("muted", "●")} Spawn ${members.length === 1 ? "" : `${members.length} `}${confirmed === "unspecified" ? "" : `${confirmed} `}${plural(members.length)}`;
	if (members.length === 1) return [`${title} ${members[0]?.detail ?? ""}`];
	const max = expanded ? members.length : Math.min(3, members.length);
	const lines = [title];
	for (let i = 0; i < max; i++) lines.push(`${i === members.length - 1 ? "└─" : "├─"} ${members[i]?.detail ?? ""}`);
	if (max < members.length) lines.push(`   … ${members.length - max} more · Ctrl+O to expand`);
	return lines;
}

export const agentTool: BoxedToolDefinition = {
	call(args, theme, context) {
		const mode = modeKey(args);
		const known = context.state.teamAgentDetails;
		const cached = known && typeof known === "object" ? { details: known } : undefined;
		const { batch, isLeader } = registerBatchCall(agentMeta(mode), agentDetail(args, theme, cached), context);
		if (!isLeader) return EMPTY_BATCH_COMPONENT;
		return rows(() => agentLine(theme, batch, mode, context.expanded), context.expanded ? 64 : 5);
	},
	result(result, options, theme, context) {
		const mode = modeKey(context.args);
		// Save authoritative admission metadata on Pi's per-call renderer state,
		// so later call re-renders cannot erase it with invocation-only arguments.
		if (!options.isPartial && result.details && typeof result.details === "object") {
			context.state.teamAgentDetails = result.details;
			rememberTeammateRun(result.details, context.args);
		}
		const { batch } = registerBatchCall(agentMeta(mode), agentDetail(context.args, theme, result), context);
		if (!options.isPartial) {
			const member = batch.members.find((item) => item.toolCallId === context.toolCallId);
			const confirmed =
				details(result).background === true
					? "background"
					: typeof details(result).agentId === "string"
						? "foreground"
						: undefined;
			if (member && confirmed) member.effectiveMode = confirmed;
		}
		registerBatchResult(
			agentMeta(mode),
			{
				isPartial: options.isPartial,
				isError: context.isError,
				errorText: context.isError ? clean(rawText(result), 160) : undefined,
			},
			context,
		);
		if (options.isPartial) return empty;
		// Native foreground results may be arbitrarily long: keep them available.
		// Background launch receipts stay in the collapsed call tree.
		const output = rawText(result);
		if (options.expanded && output) return rows(() => stripAnsi(output).split("\n"), 50);
		// Foreground calls return the actual answer here (and do not produce a
		// separate completion notification). Keep a bounded preview visible.
		if (output && (!details(result).agentId || details(result).background !== true))
			return simple(`└─ ${clean(output, 160)}`, theme);
		return empty;
	},
};

function teammateLabel(args: Record<string, unknown>, key: string, theme: BoxTheme): string {
	const value = short(args[key]);
	return value
		? key === "target" && value === "lead"
			? "lead"
			: styledTeammate(theme, `@${value}`, key === "agent_id" ? teammateColorForRun(args[key]) : undefined)
		: "teammate";
}
function messageTool(
	make: (args: Record<string, unknown>, theme: BoxTheme) => string,
	accepted: RegExp,
	confirmation: string,
): BoxedToolDefinition {
	return {
		call: (args, theme, context) =>
			rows(() => [`${make(args, theme)}${context.state.teamMessageAccepted === true ? ` · ${confirmation}` : ""}`], 1),
		result: (result, options, theme, context) => {
			if (options.isPartial) return empty;
			const text = rawText(result);
			if (accepted.test(text)) {
				context.state.teamMessageAccepted = true;
				return empty;
			}
			return rows(() => [theme.fg("error", `└─ ${clean(text, options.expanded ? 2000 : 200)}`)], 1);
		},
	};
}

export const sendMessageTool = messageTool(
	(args, theme) =>
		`${theme.fg("muted", glyph())} Message → ${teammateLabel(args, "target", theme)} · “${clean(args.message, 100)}”`,
	/^Message queued for @/,
	"queued",
);
export const steerTool = messageTool(
	(args, theme) =>
		`${theme.fg("muted", glyph())} Steer ${teammateLabel(args, "agent_id", theme)} · “${clean(args.message, 100)}”`,
	/^Steering accepted/,
	"accepted",
);

// get_subagent_result returns a formatted text record, not structured details.
// A malformed or changed record remains accessible verbatim when expanded.
export const getAgentResultTool: BoxedToolDefinition = {
	call(args, theme) {
		return rows(() => {
			const teammate = teammateForRun(args.agent_id);
			const label = typeof teammate === "string" ? `@${teammate}` : short(args.agent_id) || "teammate";
			const styledLabel = teammate ? styledTeammate(theme, label, teammateColorForRun(args.agent_id)) : label;
			return [`${theme.fg("muted", "●")} Get result ${styledLabel}${args.wait === true ? " · wait" : ""}`];
		}, 1);
	},
	result(result, options, theme, context) {
		if (options.isPartial) return empty;
		const text = stripAnsi(rawText(result));
		const admitted = teammateForRun(context.args.agent_id);
		rememberTeammateResult(context.args.agent_id, text);
		const status = /^Type:.*\| Status: ([a-z_]+)/m.exec(text)?.[1];
		const teammate = /^Teammate: (@[A-Za-z0-9][A-Za-z0-9._-]{0,63})(?=\s|$)/m.exec(text)?.[1];
		const color = teammate === `@${admitted}` ? teammateColorForRun(context.args.agent_id) : undefined;
		if (options.expanded)
			return rows(
				() =>
					text.split("\n").map((line) => {
						const prefix = `Teammate: ${teammate}`;
						return teammate && line.startsWith(prefix)
							? `Teammate: ${styledTeammate(theme, teammate, color)}${line.slice(prefix.length)}`
							: line;
					}),
				50,
			);
		const body = text.split("\n\n").slice(1).join(" ").trim();
		const suffix = `${status ? `${teammate ? " · " : ""}${status}` : ""}${(teammate || status) && body ? " · " : ""}${clean(body || text, 160)}`;
		return rows(
			() => [
				`${theme.fg("dim", "└─ ")}${teammate ? styledTeammate(theme, teammate, color) : ""}${theme.fg("dim", suffix)}`,
			],
			1,
		);
	},
};

type Task = { id?: unknown; title?: unknown; status?: unknown; owner?: unknown; blockedBy?: unknown };
function parseTask(text: string): Task | Task[] | undefined {
	try {
		const value: unknown = JSON.parse(text);
		const valid = (item: unknown): item is Task =>
			!!item &&
			typeof item === "object" &&
			!Array.isArray(item) &&
			typeof (item as Task).title === "string" &&
			typeof (item as Task).status === "string";
		if (valid(value)) return value;
		if (Array.isArray(value) && value.every(valid)) return value;
	} catch {
		/* Preserve the raw result below. */
	}
	return undefined;
}
function taskSummary(task: Task, theme: BoxTheme): string {
	const parts = [clean(task.title, 90), clean(task.status, 30)];
	const owner = short(task.owner);
	if (owner) parts.push(styledTeammate(theme, `@${owner}`));
	if (Array.isArray(task.blockedBy) && task.blockedBy.length) parts.push(`blocked by ${task.blockedBy.length} tasks`);
	return parts.filter(Boolean).join(" · ");
}
function taskTool(verb: string, label: (args: Record<string, unknown>) => string): BoxedToolDefinition {
	return {
		call(args, theme, context) {
			return rows(
				() => [
					`${theme.fg("muted", "●")} ${verb}${verb === "Team tasks" && typeof context.state.teamTaskCount === "number" ? ` · ${context.state.teamTaskCount} tasks` : ""}${label(args) ? ` · ${label(args)}` : ""}`,
				],
				1,
			);
		},
		result(result, options, theme, context) {
			if (options.isPartial) return empty;
			const raw = rawText(result);
			const parsed = parseTask(raw);
			if (!parsed) return rows(() => [theme.fg("dim", `└─ ${clean(raw, options.expanded ? 2000 : 220)}`)], 1);
			if (Array.isArray(parsed)) {
				const max = options.expanded ? Math.min(parsed.length, 50) : Math.min(parsed.length, 4);
				context.state.teamTaskCount = parsed.length;
				return rows(
					() => [
						...parsed
							.slice(0, max)
							.map((task, index) => `${index === parsed.length - 1 ? "└─" : "├─"} ${taskSummary(task, theme)}`),
						...(max < parsed.length ? [`   … ${parsed.length - max} more · Ctrl+O to expand`] : []),
					],
					52,
				);
			}
			return rows(() => [`${theme.fg("dim", "└─ ")}${taskSummary(parsed, theme)}`], 1);
		},
	};
}
export const teamTaskTools: Readonly<Record<string, BoxedToolDefinition>> = {
	team_task_create: taskTool("Create team task", (args) => clean(args.title, 90)),
	team_task_update: taskTool("Update team task", (args) => `${short(args.id)} · ${short(args.status)}`),
	team_task_get: taskTool("Get team task", (args) => short(args.id)),
	team_task_list: taskTool("Team tasks", () => ""),
};
