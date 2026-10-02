import { sliceByColumn } from "@earendil-works/pi-tui";
import { safeVisibleWidth } from "../../../shared/render-budget.js";

/** Display-only limit, independent of terminal width. Never use compact paths as keys. */
export const TOOL_PATH_MAX_WIDTH = 60;
const OMITTED_DIRECTORIES = "../../../";

/** Keep the first directory and basename, omitting the middle. Reserve read
 *  line ranges and directory slashes; on tiny terminals prefer the basename.
 *  Call before applying theme/ANSI styling. Raw tool arguments stay untouched. */
export function compactToolPath(path: string, availableWidth = TOOL_PATH_MAX_WIDTH): string {
	const width = Math.max(0, Math.floor(Math.min(TOOL_PATH_MAX_WIDTH, availableWidth)));
	if (width === 0) return "";
	if (safeVisibleWidth(path) <= width) return path;

	const range = /:\d+(?:-\d*)?$/.exec(path)?.[0] ?? "";
	const body = range ? path.slice(0, -range.length) : path;
	const trailingSlash = /[/\\]$/.test(body) ? "/" : "";
	const parts = body.replace(/\\/g, "/").split("/").filter(Boolean);
	const basename = parts.at(-1) ?? body;
	const suffix = `${trailingSlash}${range}`;
	const tail = `${basename}${suffix}`;
	if (parts.length > 1) {
		const root = `${body.startsWith("/") ? "/" : ""}${parts[0]}/`;
		const compact = `${root}${OMITTED_DIRECTORIES}${tail}`;
		if (safeVisibleWidth(compact) <= width) return compact;
		const compactTail = `.../${tail}`;
		if (safeVisibleWidth(compactTail) <= width) return compactTail;
	}
	if (safeVisibleWidth(tail) <= width) return tail;

	// A basename can itself exceed the budget. Middle-clip it, retaining its
	// start and ending (including extension), then append the untouched range.
	const nameWidth = width - safeVisibleWidth(suffix);
	if (nameWidth <= 3) return sliceByColumn(tail, safeVisibleWidth(tail) - width, width, true);
	const remaining = nameWidth - 3;
	const endWidth = Math.min(Math.ceil(remaining / 2), safeVisibleWidth(basename));
	const start = sliceByColumn(basename, 0, remaining - endWidth, true);
	const end = sliceByColumn(basename, safeVisibleWidth(basename) - endWidth, endWidth, true);
	return `${start}...${end}${suffix}`;
}
