import type { SourceInfo, ToolInfo } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { collectToolDetails, toolSourceLabel } from "../../extension-src/pi-style/pi/startup-resources.js";

function tool(name: string, sourceInfo?: SourceInfo): ToolInfo {
	return {
		name,
		description: "",
		parameters: {},
		sourceInfo:
			sourceInfo ?? ({ path: "builtin", source: "builtin", scope: "user", origin: "package" } satisfies SourceInfo),
	} as ToolInfo;
}

describe("startup tool resource collection", () => {
	it("labels builtin tools as core", () => {
		expect(toolSourceLabel({ path: "builtin", source: "builtin", scope: "user", origin: "package" })).toBe("core");
	});

	it("labels npm package sources with the package name", () => {
		expect(
			toolSourceLabel({
				path: "/x/node_modules/@acme/tools/dist/index.js",
				source: "npm:@acme/tools",
				scope: "user",
				origin: "package",
			}),
		).toBe("@acme/tools");
	});

	it("labels file sources with the compact base directory", () => {
		expect(
			toolSourceLabel({
				path: "/x/node_modules/pi-some-ext/src/extension.ts",
				source: "",
				baseDir: "/x/node_modules/pi-some-ext",
				scope: "project",
				origin: "package",
			}),
		).toBe("pi-some-ext");
	});

	it("filters to active tools when an active list is present", () => {
		const details = collectToolDetails(["bash", "edit"], [tool("bash"), tool("edit"), tool("read")]);
		expect(details).toEqual([
			{ source: "core", name: "bash" },
			{ source: "core", name: "edit" },
		]);
	});

	it("keeps all tools when the active list is empty", () => {
		const details = collectToolDetails([], [tool("bash"), tool("read")]);
		expect(details).toHaveLength(2);
	});

	it("returns undefined when there is nothing to show", () => {
		expect(collectToolDetails(["bash"], [])).toBeUndefined();
		expect(collectToolDetails(["bash"], undefined)).toBeUndefined();
	});
});
