import { visibleWidth } from "@earendil-works/pi-tui";

export function expectLinesFit(lines: readonly string[], width: number): void {
	for (const line of lines) {
		if (visibleWidth(line) > width) {
			throw new Error(`Expected line to fit width ${width}: ${JSON.stringify(line)}`);
		}
	}
}

export function expectNoTerminalUi(renderCount: number, installedUiCount: number): void {
	if (renderCount !== 0 || installedUiCount !== 0) {
		throw new Error("Expected headless mode to avoid terminal UI installation and rendering");
	}
}
