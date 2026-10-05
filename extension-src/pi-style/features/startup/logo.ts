import { hexToAnsiPrefix, type ResolvedTheme } from "../../domain/theme.js";
import { fitAnsiWidth, visibleWidth } from "../../shared/ansi.js";

/**
 * Compact startup logo header. Renders the block-art Pi logo in its coral,
 * blue, and gold brand colors plus themed side details, with stacked/truncated
 * fallbacks for narrow widths. Respects the resolved theme's no-color mode.
 */

export const PI_LOGO_LINES = [
	"████████████",
	"████████████",
	"████    ████",
	"████    ████",
	"████████    ████",
	"████████    ████",
	"████        ████",
	"████        ████",
] as const;

const LOGO_COLORS = {
	coral: hexToAnsiPrefix("#f09082"),
	blue: hexToAnsiPrefix("#509bb9"),
	gold: hexToAnsiPrefix("#f0c055"),
} as const;

// Keep the silhouette unchanged: coral cap/dot, blue P, gold i stem.
const COLORED_LOGO_LINES = PI_LOGO_LINES.map((line, row) =>
	line.replace(/█+/g, (blocks, column: number) => {
		const color =
			row < 2 || (row < 4 && column >= 8) ? LOGO_COLORS.coral : column >= 12 ? LOGO_COLORS.gold : LOGO_COLORS.blue;
		// Reset styling so the logo cannot recolor padding or side details.
		return `${color}${blocks}\x1b[0m`;
	}),
);
const LOGO_GAP = "   ";
/** Minimum side-detail width before the logo collapses to stacked lines. */
const LOGO_SIDE_DETAIL_MIN_WIDTH = 12;

/** The block-art logo in fixed brand colors, or plain when NO_COLOR is active. */
export function styledLogoLines(resolved: ResolvedTheme): string[] {
	return resolved.noColor ? [...PI_LOGO_LINES] : [...COLORED_LOGO_LINES];
}

/** Width of the side-detail column next to the block-art logo at a given content width. */
export function logoDetailWidth(width: number): number {
	const logoWidth = Math.max(...PI_LOGO_LINES.map((line) => visibleWidth(line)));
	return Math.max(0, width - logoWidth - visibleWidth(LOGO_GAP));
}

/**
 * Assemble the compact startup header: brand-colored logo with side details when
 * wide enough, stacked logo + details next, and a minimal title/status pair
 * for very narrow terminals. `details` is a column of detail rows — the first
 * is the title, the last is the status, and the rows between are hints — each
 * rendered on its own line, vertically centered beside the logo. Every
 * returned line fits within `width`.
 */
export function compactLogoHeader(resolved: ResolvedTheme, details: readonly string[], width: number): string[] {
	const logoLines = styledLogoLines(resolved);
	const safeWidth = Math.max(1, width);
	const logoWidth = Math.max(...PI_LOGO_LINES.map((line) => visibleWidth(line)));
	const detailWidth = logoDetailWidth(safeWidth);

	if (detailWidth >= LOGO_SIDE_DETAIL_MIN_WIDTH) {
		const detailStartRow = Math.max(0, Math.floor((PI_LOGO_LINES.length - details.length) / 2));
		return PI_LOGO_LINES.map((plainLine, index) => {
			const logoPadding = " ".repeat(Math.max(0, logoWidth - visibleWidth(plainLine)));
			const detailIndex = index - detailStartRow;
			const detailText = details[detailIndex];
			const detail = detailText ? fitAnsiWidth(detailText, detailWidth) : "";
			return `${logoLines[index]}${logoPadding}${detail ? `${LOGO_GAP}${detail}` : ""}`;
		});
	}

	if (safeWidth >= logoWidth) {
		return [...logoLines, ...details.map((detail) => fitAnsiWidth(detail, safeWidth))];
	}

	return [details[0] ?? "", details[details.length - 1] ?? ""].map((detail) => fitAnsiWidth(detail, safeWidth));
}
