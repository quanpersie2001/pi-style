// pi-teams custom-message presentation. The message's content remains intact for
// the model and for hosts without pi-style; only this native TUI view changes.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Component, Text } from "@earendil-works/pi-tui";
import { fgHex, isHexColor, stripAnsi } from "../../shared/ansi.js";
import { safeTruncateToWidth } from "../../shared/render-budget.js";
import { getToolsRenderConfig } from "../tools/boxed/session-config.js";

export const TEAMMATE_MESSAGE_TYPES = new Set(["teammate-notification", "teammate-message"]);

const clean = (value: unknown, max = 280): string =>
	typeof value === "string"
		? stripAnsi(value)
				.replace(/\p{Cc}/gu, " ")
				.trim()
				.slice(0, max)
		: "";

export function registerTeammateMessageRenderers(pi: ExtensionAPI): void {
	pi.registerMessageRenderer("teammate-notification", (message, options, theme): Component => {
		const data =
			message.details && typeof message.details === "object" ? (message.details as Record<string, unknown>) : {};
		const who = clean(data.teammateName, 64);
		const content = typeof message.content === "string" ? message.content : "";
		if (data.outcome !== "completed" && data.outcome !== "failed" && data.outcome !== "stopped")
			return new Text(content, 0, 0);
		const outcome = data.outcome === "completed" ? "finished" : data.outcome === "failed" ? "failed" : "stopped";
		const lines = content.split("\n");
		const preview = lines
			.slice(1)
			.map((line) => clean(line))
			.find((line) => line && !line.startsWith("full result:"));
		const path = typeof data.resultFile === "string" ? clean(data.resultFile, 300) : "";
		const subject = who ? `@${who}` : clean(data.agentId, 40) || "teammate";
		return {
			invalidate() {},
			render(width) {
				if (width < 8) return [];
				const nameColor = typeof data.color === "string" && isHexColor(data.color) ? data.color : undefined;
				const statusColor = data.outcome === "completed" ? "success" : data.outcome === "failed" ? "error" : "dim";
				const head = `${theme.fg(statusColor, "●")} Teammate ${nameColor && who ? fgHex(theme, nameColor, subject) : theme.fg("text", subject)} ${outcome}`;
				const secondary = [preview, path].filter(Boolean).join(" · ");
				const output = [head, ...(secondary ? [theme.fg("dim", `  └─ ${secondary}`)] : [])];
				if (options.expanded && content)
					output.push(
						...lines
							.slice(1)
							.filter(Boolean)
							.slice(1)
							.map((line) => theme.fg("dim", `  ${clean(line, 2000)}`)),
					);
				return output.slice(0, options.expanded ? 40 : 2).map((line) => safeTruncateToWidth(line, width));
			},
		};
	});
	pi.registerMessageRenderer("teammate-message", (message, options, theme): Component => {
		const data =
			message.details && typeof message.details === "object" ? (message.details as Record<string, unknown>) : {};
		const from = clean(data.from, 64) || "teammate";
		const senderColor = typeof data.color === "string" && isHexColor(data.color) ? data.color : undefined;
		// The mailbox payload already identifies its sender in the first line.
		const body = typeof message.content === "string" ? message.content.replace(/^Message from @[^\n]+:\s*/, "") : "";
		const content = clean(body, options.expanded ? 2000 : 220);
		return {
			invalidate() {},
			render(width) {
				if (width < 8) return [];
				const label = getToolsRenderConfig().nerdFonts ? "\uf086" : "✉";
				const sender = `@${from} → lead`;
				const styledSender = senderColor ? fgHex(theme, senderColor, sender) : theme.fg("text", sender);
				return [`${theme.fg("muted", label)} ${styledSender} · ${theme.fg("dim", content)}`].map((line) =>
					safeTruncateToWidth(line, width),
				);
			},
		};
	});
}
