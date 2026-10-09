// Presentation-only lookup: Pi's saved Agent tool results bind each run ID to
// its teammate name and optional admitted color. Never resolve an assignment by
// name or read pi-teams state.
import { isHexColor } from "../../../shared/ansi.js";

const teammateByRunId = new Map<string, string>();
const colorByRunId = new Map<string, string>();
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
function runId(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() && value.length <= 256 ? value : undefined;
}
function name(value: unknown): string | undefined {
	return typeof value === "string" && NAME.test(value) ? value : undefined;
}

export function rememberTeammateRun(details: unknown, args?: Record<string, unknown>): void {
	const data = record(details);
	const id = runId(data?.agentId);
	const teammate = name(data?.teammateName) ?? name(args?.name);
	if (id && teammate) {
		if (teammateByRunId.get(id) !== teammate) colorByRunId.delete(id);
		teammateByRunId.set(id, teammate);
	}
	// Colors are authoritative only when published by the owning runtime.
	if (id && teammate && typeof data?.color === "string" && isHexColor(data.color)) colorByRunId.set(id, data.color);
}

export function rememberTeammateResult(agentId: unknown, text: string): void {
	const teammate = /^Teammate: @([A-Za-z0-9][A-Za-z0-9._-]{0,63})(?=\s|$)/m.exec(text)?.[1];
	const id = runId(agentId);
	if (id && teammate) {
		if (teammateByRunId.get(id) !== teammate) colorByRunId.delete(id);
		teammateByRunId.set(id, teammate);
	}
}

export function teammateForRun(agentId: unknown): string | undefined {
	const id = runId(agentId);
	return id ? teammateByRunId.get(id) : undefined;
}

export function teammateColorForRun(agentId: unknown): string | undefined {
	const id = runId(agentId);
	return id ? colorByRunId.get(id) : undefined;
}

export function resetTeammateRuns(): void {
	teammateByRunId.clear();
	colorByRunId.clear();
}

/** Rebuild from the selected session branch, not the full file: forks and
 * session switches must not inherit identities from unrelated runs. */
export function rebuildTeammateRuns(entries: readonly unknown[]): void {
	resetTeammateRuns();
	const argsByCall = new Map<string, Record<string, unknown>>();
	for (const entry of entries) {
		const item = record(entry);
		if (item?.type !== "message") continue;
		const message = record(item.message);
		if (message?.role === "assistant" && Array.isArray(message.content)) {
			for (const part of message.content) {
				const call = record(part);
				if (
					call?.type === "toolCall" &&
					(call.name === "Agent" || call.name === "get_subagent_result") &&
					typeof call.id === "string"
				)
					argsByCall.set(call.id, record(call.arguments) ?? {});
			}
		} else if (message?.role === "toolResult" && message.toolName === "Agent") {
			const args = typeof message.toolCallId === "string" ? argsByCall.get(message.toolCallId) : undefined;
			rememberTeammateRun(message.details, args);
		} else if (message?.role === "toolResult" && message.toolName === "get_subagent_result") {
			const content = Array.isArray(message.content) ? message.content : [];
			const text = content
				.map((part) => record(part))
				.filter((part) => part?.type === "text" && typeof part.text === "string")
				.map((part) => part?.text as string)
				.join("\n");
			const args = typeof message.toolCallId === "string" ? argsByCall.get(message.toolCallId) : undefined;
			rememberTeammateResult(args?.agent_id, text);
		}
	}
}
