// Boxed bash tool renderer
// (renderCall/renderResult only).

import { highlightCode } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { stripAnsi } from "../../../shared/ansi.js";
import type { BoxTheme } from "../../../shared/box.js";
import {
	boxedToolWidthKey,
	formatBoxedFooter,
	formatToolOutputLine,
	getTextOutput,
	renderBoxedToolCall,
	renderBoxedToolResult,
	replaceTabs,
	shortenPath,
} from "../../../shared/box.js";
import { safeTruncateToWidth, truncateAtCodePointBoundary } from "../../../shared/render-budget.js";
import {
	type GrepMatch,
	groupMatchesByFile,
	parseFindOutput,
	parseGrepBareOutput,
	parseGrepOutput,
	parseLsLongOutput,
	parseLsOutput,
	pluralForm,
	renderGrepTree,
	renderOutputTree,
	SEARCH_ICON,
	TREE_INDENT,
} from "./output-tree.js";
import { getStateElapsedMs, getToolsRenderConfig } from "./session-config.js";
import { type BoxedToolContext, type BoxedToolDefinition, noteExecutionStart } from "./shared.js";

const MAX_LINE_CHARS = 2000;
const ESC = "\x1b";
const BASH_TOOL_NOTICE_PATTERN = /^\[Showing (?:last|lines)\b.*\. Full output: .+\]$/;
const BG_ANSI_PATTERN = new RegExp(`${ESC}\\[4[0-9;]*m`, "g");
const SHELL_VAR_PATTERN = /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/;
const SHELL_OP_PATTERN = /^(?:&&|\|\||>>|>&|\|&|[|&;()<>])$/;

function highlightBashFallback(line: string): string {
	try {
		const highlighted = highlightCode(line, "bash")[0] ?? line;
		// Strip background colors to avoid clashing with badge/parens styling
		return highlighted.replace(BG_ANSI_PATTERN, "");
	} catch {
		return line;
	}
}

function normalizeShellWord(word: string): string {
	return word.replace(/^(['"])(.*)\1$/, "$2");
}

function colorShellWord(theme: BoxTheme, word: string, commandExpected: boolean): string {
	const normalized = normalizeShellWord(word);
	if (/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(normalized)) return theme.fg("syntaxVariable", word);
	if (normalized.startsWith("-")) return theme.fg("syntaxKeyword", word);
	if (normalized.includes("/") || /^\.{1,2}(?:\/|$)/.test(normalized)) return theme.fg("syntaxVariable", word);
	if (SHELL_VAR_PATTERN.test(normalized)) return theme.fg("syntaxVariable", word);
	return commandExpected ? theme.fg("syntaxFunction", word) : theme.fg("syntaxString", word);
}

function tokenizeShellLinePreservingText(line: string): string[] | undefined {
	const tokens: string[] = [];
	let current = "";
	let quote: string | null = null;

	for (let i = 0; i < line.length; i++) {
		const char = line[i] ?? "";
		const next = line[i + 1] ?? "";

		if (quote) {
			current += char;
			if (char === "\\" && next) current += line[++i] ?? "";
			else if (char === quote) quote = null;
			continue;
		}

		if (char === "'" || char === '"') {
			quote = char;
			current += char;
			continue;
		}

		if (/\s/.test(char)) {
			if (current) tokens.push(current);
			current = "";
			tokens.push(char);
			continue;
		}

		if (char === "#" && !current) {
			if (current) tokens.push(current);
			tokens.push(line.slice(i));
			return tokens;
		}

		const two = `${char}${next}`;
		if (SHELL_OP_PATTERN.test(two) || SHELL_OP_PATTERN.test(char)) {
			if (current) tokens.push(current);
			current = "";
			if (SHELL_OP_PATTERN.test(two)) {
				tokens.push(two);
				i++;
			} else {
				tokens.push(char);
			}
			continue;
		}

		current += char;
	}

	if (quote) return undefined;
	if (current) tokens.push(current);
	return tokens;
}

function highlightBashLine(line: string, theme: BoxTheme): string {
	const tokens = tokenizeShellLinePreservingText(line);
	if (!tokens) return highlightBashFallback(line);
	let commandExpected = true;
	return tokens
		.map((token) => {
			if (/^\s+$/.test(token)) return token;
			if (token.startsWith("#")) return theme.fg("syntaxComment", token);
			if (SHELL_OP_PATTERN.test(token)) {
				commandExpected = token === "|" || token === "||" || token === "&&" || token === ";" || token === "&";
				return theme.fg("syntaxOperator", token);
			}
			const styled = colorShellWord(theme, token, commandExpected);
			if (!/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(normalizeShellWord(token))) commandExpected = false;
			return styled;
		})
		.join("");
}

function clampLineLength(line: string, max: number = MAX_LINE_CHARS): string {
	if (line.length <= max) return line;
	return `${truncateAtCodePointBoundary(line, max)}… (truncated)`;
}

function countNewlines(text: string, from: number, to: number): number {
	let count = 0;
	for (let i = from; i < to; i++) {
		if (text.charCodeAt(i) === 10) count++;
	}
	return count;
}

function stripBashToolNoticeLines(text: string): string {
	const filteredLines = text
		.replace(/\r/g, "")
		.split("\n")
		.filter((line) => !BASH_TOOL_NOTICE_PATTERN.test(line.trim()));
	return filteredLines
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trimEnd();
}

function bashWidthKey(rawCommand: string, timeout: unknown): string {
	return boxedToolWidthKey("Bash", `${rawCommand}|${timeout ?? ""}`);
}

function renderBoxedBashCall(
	theme: BoxTheme,
	commandLines: string[],
	context: BoxedToolContext,
	widthKey: string,
): Component {
	const maxCommandLines = 5;
	const shownCount = Math.min(commandLines.length, maxCommandLines + 1);
	const detailLines: string[] = [];
	for (let i = 0; i < shownCount; i++) {
		const prefix = i === 0 ? theme.fg("dim", "$ ") : theme.fg("dim", "> ");
		detailLines.push(`${prefix}${highlightBashLine(commandLines[i] ?? "", theme)}`);
	}
	if (commandLines.length > maxCommandLines + 1) {
		detailLines.push(theme.fg("muted", `... ${commandLines.length - maxCommandLines - 1} more lines`));
	}
	return renderBoxedToolCall(theme, "Bash", detailLines, {
		widthKey,
		isError: Boolean(context.isError),
		isPartial: Boolean(context.isPartial),
		isPending: Boolean(context.isPartial),
	});
}

function formatTimeout(context: BoxedToolContext): string {
	const timeout = context?.args?.timeout ?? 300;
	return `${timeout}s`;
}

function renderBoxedBashResult(
	theme: BoxTheme,
	inner: Component,
	result: unknown,
	context: BoxedToolContext,
	expandHint?: string,
): Component {
	const rawCommand = String(context?.args?.command ?? "...");
	const referenceLines = rawCommand.split("\n").map((line, index) => `${index === 0 ? "$ " : "> "}${line}`);
	return renderBoxedToolResult(theme, inner, {
		widthKey: bashWidthKey(rawCommand, context?.args?.timeout),
		referenceLines,
		footerLines: [
			formatBoxedFooter(theme, result as never, [`timeout ${formatTimeout(context)}`], getElapsed(context)),
		],
		...(expandHint ? { expandHint } : {}),
		isError: context.isError,
		isPartial: Boolean(context.isPartial),
	});
}

function getElapsed(context: BoxedToolContext): number | undefined {
	return getStateElapsedMs(context.state);
}

function createBashResultPreview(
	theme: BoxTheme,
	text: string,
	options: { expanded: boolean },
	color: "toolOutput" | "error",
): Component {
	let cacheKey = "";
	let cacheLines: string[] | null = null;

	return {
		invalidate() {
			cacheKey = "";
			cacheLines = null;
		},
		render(width: number): string[] {
			const bodyWidth = Math.max(1, width);
			const cfg = getToolsRenderConfig();
			const expanded = Boolean(options.expanded);
			const cacheId = `${bodyWidth}|${expanded ? 1 : 0}|${cfg.maxExpandedLines}|${cfg.dimOutput ? 1 : 0}`;
			if (cacheLines && cacheKey === cacheId) return cacheLines;

			if (!expanded) {
				// Collapsed: only process the tail of the output
				const needed = cfg.maxCollapsedLines;
				let totalNewlines = 0;
				let scanFrom = 0; // default: take full text if fewer than needed newlines
				for (let i = text.length - 1; i >= 0; i--) {
					if (text.charCodeAt(i) === 10) {
						totalNewlines++;
						if (totalNewlines === needed) {
							scanFrom = i + 1;
							break;
						}
					}
				}

				if (text.length === 0) {
					cacheKey = cacheId;
					cacheLines = [];
					return cacheLines;
				}

				const tail = replaceTabs(text.slice(scanFrom)).replace(/\r/g, "");
				const shownLines = tail ? tail.split("\n").map((l) => clampLineLength(l)) : [];

				if (shownLines.length === 0) {
					cacheKey = cacheId;
					cacheLines = [];
					return cacheLines;
				}

				const truncatedShown = shownLines.map((line) => {
					const truncated = safeTruncateToWidth(line, bodyWidth, "…");
					if (color === "error") return formatToolOutputLine(theme, truncated, "error");
					return cfg.dimOutput
						? formatToolOutputLine(theme, truncated)
						: formatToolOutputLine(theme, truncated, "text");
				});

				cacheKey = cacheId;
				cacheLines = truncatedShown;
				return cacheLines;
			}

			// Expanded: process all lines
			const normalized = replaceTabs(text);
			const logicalLines = normalized.split("\n").map((l) => clampLineLength(l));
			const hasOutput = !(logicalLines.length === 1 && logicalLines[0] === "");

			if (!hasOutput) {
				cacheKey = cacheId;
				cacheLines = [];
				return cacheLines;
			}

			const truncatedLines = logicalLines.map((line) => safeTruncateToWidth(line, bodyWidth, "…"));
			const expandedLines = truncatedLines.length === 1 && truncatedLines[0] === "" ? [] : truncatedLines;
			const applyColor = (l: string) =>
				color === "error"
					? formatToolOutputLine(theme, l, "error")
					: cfg.dimOutput
						? formatToolOutputLine(theme, l)
						: formatToolOutputLine(theme, l, "text");
			if (cfg.maxExpandedLines > 0 && expandedLines.length > cfg.maxExpandedLines) {
				const truncated = expandedLines.slice(-cfg.maxExpandedLines).map(applyColor);
				const remaining = expandedLines.length - cfg.maxExpandedLines;
				truncated.unshift(theme.fg("dim", `… ${remaining} earlier lines`));
				cacheKey = cacheId;
				cacheLines = truncated;
				return cacheLines;
			}

			cacheKey = cacheId;
			cacheLines = expandedLines.map(applyColor);
			return cacheLines;
		},
	};
}

// ── ls/find/grep/rg command detection ───────────────────────────────────────
// A bash command whose real command is ls/find/grep/rg (after env assignments,
// sudo/env/time prefixes, and path stripping), with no shell metacharacters
// (pipes, redirects, `;`, `&&`, command substitution, subshells, newlines), is
// rendered as the same boxless output tree as the corresponding native tool.
// Everything else keeps the boxed command/response shell.

type BashTreeKind = "ls" | "find" | "grep";

interface BashTreeClass {
	readonly kind: BashTreeKind;
	readonly pattern?: string;
	readonly pathLabel?: string;
	/** grep: exactly one path positional — single-file output (`line: content`)
	 *  is attributed to it. */
	readonly singlePath?: string;
}

const BASH_PREFIX_COMMANDS = new Set(["sudo", "env", "time", "nice", "nohup", "command", "stdbuf", "ionice", "watch"]);
const BASH_GREP_COMMANDS = new Set(["grep", "egrep", "fgrep", "rg"]);
// Pipes (`|`), `;`, and `&` are excluded here: the classifier validates them
// explicitly (allowing `cd X && cmd` chains and a trailing `| head/tail`).
const BASH_SHELL_META_CHARS = new Set(["<", ">", "(", ")", "`"]);

/** Tokenize a single command line, stripping quotes. Returns null on an
 *  unterminated quote. `hasMeta` is true if any shell metacharacter appears
 *  *outside* quotes (so `grep 'a|b' f` stays classifiable). */
function tokenizeCommandLine(line: string): { tokens: string[]; hasMeta: boolean } | null {
	const tokens: string[] = [];
	let current = "";
	let inToken = false;
	let quote: string | null = null;
	let hasMeta = false;
	for (let i = 0; i < line.length; i++) {
		const char = line[i] ?? "";
		if (quote) {
			if (char === "\\" && quote === '"') {
				current += line[++i] ?? "";
				continue;
			}
			if (char === quote) {
				quote = null;
				continue;
			}
			current += char;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			inToken = true;
			continue;
		}
		if (char === " " || char === "\t") {
			if (inToken) {
				tokens.push(current);
				current = "";
				inToken = false;
			}
			continue;
		}
		if (BASH_SHELL_META_CHARS.has(char) || (char === "$" && (line[i + 1] ?? "") === "(")) {
			hasMeta = true;
			continue;
		}
		current += char;
		inToken = true;
	}
	if (quote) return null;
	if (inToken) tokens.push(current);
	return { tokens, hasMeta };
}

/** grep/rg flags that consume a separate value token (`--type ts`). */
const GREP_VALUE_FLAGS = new Set([
	"-e",
	"--regexp",
	"-g",
	"--glob",
	"--type",
	"-t",
	"--include",
	"--exclude",
	"-C",
	"-A",
	"-B",
	"--context",
	"--after-context",
	"--before-context",
	"-m",
	"--max-count",
	"-M",
	"--max-columns",
	"--ignore-file",
]);

/** find flags that consume a separate value token (`-type f`). */
const FIND_VALUE_FLAGS = new Set([
	"-type",
	"-mtime",
	"-atime",
	"-ctime",
	"-size",
	"-maxdepth",
	"-mindepth",
	"-perm",
	"-group",
	"-user",
	"-newer",
]);

function classifyByArgs(kind: BashTreeKind, args: string[]): BashTreeClass {
	const positionals: string[] = [];
	let pattern: string | undefined;
	for (let i = 0; i < args.length; i++) {
		const token = args[i] ?? "";
		if (
			(kind === "grep" && (token === "-e" || token === "--regexp")) ||
			(kind === "find" && (token === "-name" || token === "-iname" || token === "-path" || token === "-ipath"))
		) {
			pattern = args[++i];
			continue;
		}
		if (kind === "grep" && GREP_VALUE_FLAGS.has(token)) {
			i++; // skip the flag and its value
			continue;
		}
		if (kind === "find" && FIND_VALUE_FLAGS.has(token)) {
			i++; // skip the flag and its value
			continue;
		}
		if (token.startsWith("-")) continue;
		positionals.push(token);
	}
	const rawPath = positionals[0] ?? ".";
	const pathLabel = rawPath === "." ? "current directory" : shortenPath(rawPath);
	if (kind === "ls") return { kind, pathLabel };
	if (kind === "find") return { kind, ...(pattern !== undefined ? { pattern } : {}), pathLabel };
	const grepPattern = pattern ?? positionals[0];
	const pathArgs = pattern !== undefined ? positionals : positionals.slice(1);
	const grepPath = pathArgs.join(" ");
	const grepPathLabel = !grepPath || grepPath === "." ? "current directory" : shortenPath(grepPath);
	return {
		kind,
		...(grepPattern !== undefined ? { pattern: grepPattern } : {}),
		pathLabel: grepPathLabel,
		...(pathArgs.length === 1 ? { singlePath: pathArgs[0] ?? "" } : {}),
	};
}

/** `head [-n N]` / `tail [-n N]` truncation pipe tail (allowed at the end). */
function isHeadOrTailTail(tokens: readonly string[]): boolean {
	if (tokens.length === 0 || (tokens[0] !== "head" && tokens[0] !== "tail")) return false;
	for (let i = 1; i < tokens.length; i++) {
		const token = tokens[i] ?? "";
		if (token === "-n") continue;
		if (/^\d+$/.test(token)) continue;
		if (/^-\d+$/.test(token)) continue;
		return false;
	}
	return true;
}

/** Classify a bash command for tree rendering, or null to keep the boxed shell. */
export function classifyBashCommand(command: string): BashTreeClass | null {
	const commandText = String(command ?? "").trim();
	if (!commandText || commandText.includes("\n")) return null;
	const tokenized = tokenizeCommandLine(commandText);
	if (!tokenized || tokenized.hasMeta || tokenized.tokens.length === 0) return null;
	let tokens = tokenized.tokens;

	// Allow a single trailing truncation pipe: `cmd | head [-n] N` / `| tail …`.
	const pipes = tokens.flatMap((token, i) => (token === "|" ? [i] : []));
	if (pipes.length > 0) {
		if (pipes.length > 1) return null;
		const last = pipes[0] ?? -1;
		if (!isHeadOrTailTail(tokens.slice(last + 1))) return null;
		tokens = tokens.slice(0, last);
	}

	let index = 0;
	// Skip leading environment assignments (FOO=bar ...) and prefix commands.
	while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] ?? "")) index++;
	while (index < tokens.length && BASH_PREFIX_COMMANDS.has(tokens[index] ?? "")) index++;
	// `cd <dir> &&` / `cd <dir>;` chains: the last directory becomes the default
	// path when the command itself carries none.
	let cdDir: string | undefined;
	while (
		tokens[index] === "cd" &&
		index + 2 < tokens.length &&
		tokens[index + 1] !== undefined &&
		(tokens[index + 2] === "&&" || tokens[index + 2] === ";")
	) {
		cdDir = tokens[index + 1];
		index += 3;
	}
	const rest = tokens.slice(index);
	if (rest.length === 0 || rest.some((token) => token === "&&" || token === ";" || token === "&")) return null;

	const base = (rest[0] ?? "").split("/").pop() ?? "";
	let kind: BashTreeKind | null = null;
	if (base === "ls") kind = "ls";
	else if (base === "find") kind = "find";
	else if (BASH_GREP_COMMANDS.has(base)) kind = "grep";
	if (!kind) return null;

	const cls = classifyByArgs(kind, rest.slice(1));
	if (cdDir && cls.pathLabel === "current directory") {
		return {
			kind,
			...(cls.pattern !== undefined ? { pattern: cls.pattern } : {}),
			pathLabel: shortenPath(cdDir),
			...(cls.singlePath !== undefined ? { singlePath: cls.singlePath } : {}),
		};
	}
	return cls;
}

function bashTreeHeader(theme: BoxTheme, cls: BashTreeClass, counts?: { files?: number; matches?: number }): string {
	const label = cls.kind === "find" ? "Glob" : cls.kind === "ls" ? "List" : "Grep";
	const hasDetail = Boolean(cls.pattern) || Boolean(counts);
	// ls/find/grep headers carry the magnifying-glass icon in Nerd Font mode.
	const icon = getToolsRenderConfig().nerdFonts ? `${SEARCH_ICON} ` : "";
	const prefix = icon + (hasDetail ? `${label}:` : label);
	const patternPart = cls.pattern ? ` ${theme.fg("text", cls.pattern)}` : "";
	let middle = "";
	if (counts) {
		if (cls.kind === "grep") {
			const matches = counts.matches ?? 0;
			const files = counts.files ?? 0;
			middle = ` ${theme.fg("accent", `${matches} ${pluralForm("match", matches)}`)}${theme.fg("dim", ` · ${files} ${pluralForm("file", files)}`)}`;
		} else {
			const files = counts.files ?? 0;
			middle = ` ${theme.fg("accent", `${files} ${pluralForm("file", files)}`)}`;
		}
	}
	const pathPart =
		cls.pathLabel && cls.pathLabel !== "current directory" ? theme.fg("dim", ` · in ${cls.pathLabel}`) : "";
	return `${typeof theme?.bold === "function" ? theme.bold(prefix) : prefix}${patternPart}${middle}${pathPart}`;
}

/** `ls -l` long-format lines (permissions block) can't be parsed into names
 *  reliably; fall back to the boxed shell for those. A leading `total N`
 *  summary line is skipped before the check. */
function isLongFormatLs(text: string): boolean {
	const first = text
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line.length > 0 && !/^total\s+\d+$/i.test(line));
	return Boolean(first) && /^[bcdlsp-][rwxtsST-]{9}[\s@]/.test(first as string);
}

/** Parsed bash tree output, or null to fall back to the boxed shell
 *  (long-format ls, unparseable grep). */
type ParsedBashTree = { entries: string[] } | { matches: GrepMatch[] };

function parseBashTreeOutput(cls: BashTreeClass, output: string): ParsedBashTree | null {
	if (cls.kind === "ls") {
		// `ls -l`/`ls -la` long format is parsed into names (with `/` for dirs)
		// so bash listings render like the List tool tree.
		if (isLongFormatLs(output)) return { entries: parseLsLongOutput(output) };
		return { entries: parseLsOutput(output) };
	}
	if (cls.kind === "find") return { entries: parseFindOutput(output) };
	const matches = parseGrepOutput(output);
	if (matches.length === 0 && output.trim().length > 0) {
		// Single-file `rg`/`grep` output is `line: content` with no filename:
		// attribute matches to the command's single path argument.
		if (cls.singlePath) {
			const bare = parseGrepBareOutput(output, cls.singlePath);
			if (bare.length > 0) return { matches: bare };
		}
		return null;
	}
	return { matches };
}

interface BashTreeState {
	readonly cls: BashTreeClass;
	/** Raw command, so the call panel can render the boxed bash call on fallback. */
	readonly command: string;
	/** `parsed` once the result arrives; `fallback` when the boxed shell takes over. */
	parsed?: ParsedBashTree;
	fallback?: boolean;
}

const bashTreeStates = new Map<string, BashTreeState>();

/** Reset all bash tree state (session start/shutdown, new message). */
export function resetBashTreeRegistry(): void {
	bashTreeStates.clear();
}

function renderBashTreeLines(theme: BoxTheme, state: BashTreeState, width: number): string[] {
	const safeWidth = Math.max(1, width);
	const cls = state.cls;
	if (state.parsed && "entries" in state.parsed) {
		const entries = state.parsed.entries;
		return renderOutputTree(theme, bashTreeHeader(theme, cls, { files: entries.length }), entries, safeWidth, {
			moreUnit: "file",
			indent: TREE_INDENT,
			withIcons: getToolsRenderConfig().nerdFonts,
		});
	}
	if (state.parsed && "matches" in state.parsed) {
		const matches = state.parsed.matches;
		return renderGrepTree(
			theme,
			bashTreeHeader(theme, cls, { matches: matches.length, files: groupMatchesByFile(matches).length }),
			matches,
			safeWidth,
			{ indent: TREE_INDENT, withIcons: getToolsRenderConfig().nerdFonts },
		);
	}
	return [safeTruncateToWidth(bashTreeHeader(theme, cls), safeWidth, "…")];
}

/** Empty result component — the tree lives in the call panel, which re-renders
 *  with the parsed output once the result arrives. */
const EMPTY_BASH_TREE_RESULT: Component = {
	invalidate() {},
	render() {
		return [];
	},
};

/** Live panel component for a classified bash command: pending header until the
 *  result arrives, then the parsed output tree. When the result falls back to
 *  the boxed shell, the call renders the boxed bash call instead, so call and
 *  result form one complete box and never duplicate. The state reference is
 *  captured at creation so a registry clear on session reset/resume does not
 *  blank already-rendered panels. */
function renderBashTreePanel(theme: BoxTheme, toolCallId: string, context: BoxedToolContext): Component {
	const state = bashTreeStates.get(toolCallId);
	return {
		invalidate() {},
		render(width: number): string[] {
			if (!state) return [];
			if (state.fallback) {
				return renderBoxedBashCall(
					theme,
					state.command.split("\n"),
					context,
					bashWidthKey(state.command, context?.args?.timeout),
				).render(width);
			}
			return renderBashTreeLines(theme, state, width);
		},
	};
}

export const bashTool: BoxedToolDefinition = {
	call(args, theme, context) {
		noteExecutionStart(context);
		const cls = classifyBashCommand(String(args?.command ?? ""));
		if (cls) {
			bashTreeStates.set(context.toolCallId, { cls, command: String(args?.command ?? "") });
			return renderBashTreePanel(theme, context.toolCallId, context);
		}
		const rawCommand = String(args?.command ?? "...");
		return renderBoxedBashCall(theme, rawCommand.split("\n"), context, bashWidthKey(rawCommand, args?.timeout));
	},
	result(result, options, theme, context) {
		const cls = classifyBashCommand(String(context?.args?.command ?? ""));
		if (cls && !context.isError) {
			const output = stripBashToolNoticeLines(stripAnsi(getTextOutput(result)));
			const parsed = parseBashTreeOutput(cls, output);
			const state = bashTreeStates.get(context.toolCallId);
			if (parsed) {
				if (state) state.parsed = parsed;
				else bashTreeStates.set(context.toolCallId, { cls, command: String(context?.args?.command ?? ""), parsed });
				return EMPTY_BASH_TREE_RESULT;
			}
			// Unparseable output (ls -l, raw rg summary): the boxed shell owns the
			// result; flag the call panel to render nothing so the two don't duplicate.
			if (state) state.fallback = true;
		}
		const raw = getTextOutput(result);
		const outputColor = context.isError ? "error" : "toolOutput";

		if (!options.expanded) {
			const scanLines = getToolsRenderConfig().maxCollapsedLines + 10;
			let nlCount = 0;
			let tailStart = 0;
			for (let i = raw.length - 1; i >= 0; i--) {
				if (raw.charCodeAt(i) === 10) {
					nlCount++;
					if (nlCount >= scanLines) {
						tailStart = i + 1;
						break;
					}
				}
			}
			const tail = stripBashToolNoticeLines(stripAnsi(raw.slice(tailStart)));
			const totalLinesBefore = tailStart > 0 ? countNewlines(raw, 0, tailStart) : 0;
			const inner = createBashResultPreview(theme, tail, options, outputColor);
			return renderBoxedBashResult(theme, inner, result, context, totalLinesBefore > 0 ? "Ctrl+O for more" : undefined);
		}
		const output = stripBashToolNoticeLines(stripAnsi(raw));
		const inner = createBashResultPreview(theme, output, options, outputColor);
		return renderBoxedBashResult(theme, inner, result, context);
	},
};
