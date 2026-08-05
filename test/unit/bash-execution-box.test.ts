import { BashExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import {
	renderBashExecutionBox,
	setBashExecutionTheme,
} from "../../extension-src/pi-style/features/tools/bash-execution.js";
import {
	disposePiCompatibilityProbe,
	probePiCompatibility,
} from "../../extension-src/pi-style/pi/compatibility-probe.js";
import { createFakeTheme } from "../helpers/fake-theme.js";

const ESC = "\x1b";
const plain = (line: string) => line.replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");

function fakeUi() {
	return { setInterval() {}, clearInterval() {}, requestRender() {} };
}

function build() {
	return new BashExecutionComponent("echo hi", fakeUi());
}

let report: ReturnType<typeof probePiCompatibility> | undefined;

describe("boxed bash execution display", () => {
	afterEach(() => {
		if (report) {
			disposePiCompatibilityProbe(report);
			report = undefined;
		}
		setBashExecutionTheme(undefined);
	});

	it("renders the running card as a rounded box from the very first frame", () => {
		initTheme("dark", false);
		// Install the certified additive render patch, then construct a fresh
		// component: the box must be present on the FIRST render — no output has
		// been appended yet, so this proves the render patch (not updateDisplay)
		// owns the frame.
		report = probePiCompatibility("0.83.0");
		const bash = report.recordSnapshots.find((record) => record.subtype === "native-bash-execution");
		expect(bash?.shape).toBe("installed");
		setBashExecutionTheme(createFakeTheme() as never);

		const component = build();
		const lines = component.render(50).map(plain);
		expect(lines[0]).toBe("");
		expect(lines[1]?.startsWith("╭─ ➔ Bash ◌ ")).toBe(true);
		expect(lines[1]?.endsWith("╮")).toBe(true);
		expect(lines[2]).toBe(`│${" ".repeat(48)}│`);
		expect(lines[3]).toContain("│  $ echo hi");
		expect(lines.join("\n")).toContain("Running...");
		expect(lines[lines.length - 1]).toContain("◌ Running");
		expect(lines[lines.length - 1]?.startsWith("╰─ ")).toBe(true);
		expect(lines[lines.length - 1]?.endsWith("╯")).toBe(true);
		expect(lines.every((line) => line.length <= 50)).toBe(true);
	});

	it("streams output inside the box and closes with the terminal state", () => {
		initTheme("dark", false);
		report = probePiCompatibility("0.83.0");
		setBashExecutionTheme(createFakeTheme() as never);
		const component = build();
		component.appendOutput("zz");
		const streamed = component.render(50).map(plain).join("\n");
		expect(streamed).toContain("│  zz");
		expect(streamed).toContain("╭─ ➔ Bash ◌");

		component.setComplete(0, false);
		const done = component.render(50).map(plain);
		expect(done.join("\n")).toContain("➔ Bash ✓");
		expect(done[done.length - 1]?.startsWith("╰─ Exit 0 ")).toBe(true);
		expect(done[done.length - 1]?.endsWith("╯")).toBe(true);
		expect(done.join("\n")).not.toContain("➔ Bash ◌");
	});

	it("marks failures and cancellations in the title and footer", () => {
		initTheme("dark", false);
		report = probePiCompatibility("0.83.0");
		setBashExecutionTheme(createFakeTheme() as never);
		const failed = build();
		failed.appendOutput("boom");
		failed.setComplete(2, false);
		const failedLines = failed.render(50).map(plain).join("\n");
		expect(failedLines).toContain("➔ Bash ✗");
		expect(failedLines).toContain("Exit 2");

		const cancelled = build();
		cancelled.setComplete(undefined, true);
		const cancelledLines = cancelled.render(50).map(plain).join("\n");
		expect(cancelledLines).toContain("➔ Bash ✗");
		expect(cancelledLines).toContain("Cancelled");
	});

	it("falls back to the native rendering when no theme is configured", () => {
		initTheme("dark", false);
		report = probePiCompatibility("0.83.0");
		setBashExecutionTheme(undefined);
		const component = build();
		const lines = component.render(50).map(plain);
		expect(lines[1]).toBe("─".repeat(50));
		expect(lines.join("\n")).not.toContain("╭");
		expect(lines.join("\n")).not.toContain("➔ Bash");
	});

	it("renderBashExecutionBox returns undefined without a theme or a content container", () => {
		setBashExecutionTheme(undefined);
		expect(renderBashExecutionBox({ contentContainer: { render() {} } }, [50])).toBeUndefined();
		setBashExecutionTheme(createFakeTheme() as never);
		expect(renderBashExecutionBox({}, [50])).toBeUndefined();
	});
});
