import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../../extension-src/pi-style/domain/config-normalization.js";
import { renderStartup } from "../../extension-src/pi-style/features/startup/index.js";
import { stripAnsi, visibleWidth } from "../../extension-src/pi-style/shared/ansi.js";

const compactConfig = normalizeConfig({
	startup: { mode: "compact", showResources: true },
});

const expandedConfig = normalizeConfig({
	startup: { mode: "compact", showResources: true, alwaysExpanded: true },
});

const snapshot = {
	reason: "startup" as const,
	model: "provider/very-long-model-name",
	thinkingLevel: "high" as const,
	cwd: "/workspace/pi-style",
	context: { percent: 42 },
	resources: {
		contextFiles: 2,
		extensions: 4,
		skills: 3,
		tools: 12,
		models: 3,
		details: [
			{ kind: "system" as const, path: "system prompt", words: 1500, lines: 210 },
			{ kind: "context" as const, path: ".pi/rules/architecture.md", words: 320, lines: 47 },
		],
		toolDetails: [
			{ source: "core", name: "bash" },
			{ source: "core", name: "edit" },
			{ source: "pi-style", name: "profile" },
		],
	},
};

const theme = { fg: (_token: string) => "" };

describe("startup presentation", () => {
	it("renders compact information without invented metadata", () => {
		const lines = renderStartup(snapshot, compactConfig, theme, 120);
		expect(lines.join("\n")).toContain("◆ Resources");
		expect(lines.join("\n")).not.toContain("0 extensions");
	});

	it("keeps the default view to the logo block only", () => {
		const defaults = normalizeConfig({});
		const lines = renderStartup(snapshot, defaults, theme, 120);
		expect(lines.join("\n")).toContain("● ready");
		expect(lines.join("\n")).not.toContain(snapshot.model);
		expect(lines.join("\n")).not.toContain("Resources");
		expect(lines.join("\n")).not.toContain("context");
	});

	it("renders the logo header with title, hints, and ready status", () => {
		const lines = renderStartup(snapshot, compactConfig, theme, 120);
		expect(lines.join("\n")).toContain("pi-style");
		expect(lines.join("\n")).toContain("/ commands");
		expect(lines.join("\n")).toContain("● ready");
	});

	it("heads the startup block with the current project path, not the package name", () => {
		const lines = renderStartup(snapshot, compactConfig, theme, 120);
		// The title slot is the session cwd (the repo being worked in), never a
		// hardcoded "pi-style" brand string.
		expect(stripAnsi(lines.join("\n"))).toContain("/workspace/pi-style");
	});

	it("home-contracts the project path in the heading", () => {
		const home = homedir();
		const lines = renderStartup(
			{ ...snapshot, cwd: `${home}/Workspace/Personal/pi-dev/some-repo` },
			compactConfig,
			theme,
			120,
		);
		const text = stripAnsi(lines.join("\n"));
		expect(text).toContain("~/Workspace/Personal/pi-dev/some-repo");
		expect(text).not.toContain(home);
	});

	it("keeps the repo name (tail) when the project path exceeds the heading width", () => {
		const lines = renderStartup(
			{ ...snapshot, cwd: "/very/long/nested/directory/structure/holding/my-repo" },
			compactConfig,
			theme,
			58,
		);
		const title = stripAnsi(lines.join("\n"));
		expect(title).toContain("my-repo");
		expect(title).toContain("…");
		expect(title).not.toContain("/very/long");
	});

	it("falls back to the project basename, then the brand, when no cwd is known", () => {
		const withBasename = renderStartup({ ...snapshot, cwd: undefined, project: "monorepo" }, compactConfig, theme, 120);
		expect(stripAnsi(withBasename.join("\n"))).toContain("monorepo");
		const brand = renderStartup({ ...snapshot, cwd: undefined, project: undefined }, compactConfig, theme, 120);
		expect(stripAnsi(brand.join("\n"))).toContain("pi-style");
	});

	it("shows resource chips but keeps panels collapsed unless expanded", () => {
		const collapsed = renderStartup(snapshot, compactConfig, theme, 120);
		expect(collapsed.join("\n")).toContain("context 2");
		expect(collapsed.join("\n")).toContain("models 3");
		expect(collapsed.join("\n")).not.toContain("System & Context");
		expect(collapsed.join("\n")).not.toContain("Available Tools");

		const expanded = renderStartup(snapshot, expandedConfig, theme, 120);
		expect(expanded.join("\n")).toContain("System & Context");
		expect(expanded.join("\n")).toContain("Words/Lines");
		expect(expanded.join("\n")).toContain("architecture.md");
		expect(expanded.join("\n")).toContain("Available Tools");
		expect(expanded.join("\n")).toContain("bash");
	});

	it("renders panels in overlay presentation", () => {
		const overlay = renderStartup(snapshot, compactConfig, theme, 120, true);
		expect(overlay.join("\n")).toContain("System & Context");
		expect(overlay.join("\n")).toContain("enter prompt to continue");
	});

	it("omits panels when no detail data is supplied", () => {
		const minimal = renderStartup({ ...snapshot, resources: { contextFiles: 1 } }, expandedConfig, theme, 120);
		expect(minimal.join("\n")).not.toContain("System & Context");
		expect(minimal.join("\n")).toContain("context 1");
	});

	it("degrades every line to the requested width", () => {
		for (const width of [0, 1, 20, 40, 60, 80, 120, 160]) {
			const lines = renderStartup(snapshot, expandedConfig, theme, width, true);
			expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
		}
	});

	it("supports off mode and missing optional data", () => {
		const off = normalizeConfig({ startup: { mode: "off" } });
		expect(renderStartup(snapshot, off, theme, 80)).toEqual([]);
		const minimal = renderStartup({ reason: "startup" }, compactConfig, theme, 80);
		expect(minimal.join("\n")).not.toContain("undefined");
	});

	it("filters non-initial reasons from overlay presentation", () => {
		const reload = renderStartup({ ...snapshot, reason: "reload" }, compactConfig, theme, 80, true);
		expect(reload.join("\n")).toContain("pi-style");
	});
});
