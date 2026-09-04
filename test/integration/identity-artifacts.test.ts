import { initTheme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { KNOWN_NATIVE_IDENTITIES, targetSpecs } from "../../extension-src/pi-style/pi/compatibility-probe.js";

function fingerprintOf(value: unknown): string | undefined {
	if (typeof value !== "function") return undefined;
	let hash = 2166136261;
	for (const c of Function.prototype.toString.call(value)) {
		hash ^= c.charCodeAt(0);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

/**
 * Verifies every surface's runtime identity on a given pi build certifies
 * against the recorded registry. `sourceOf` maps a surface key to the live
 * function (own method or class constructor for additive installs).
 */
function certifyAgainst(module: Record<string, unknown>, version: string): string[] {
	const misses: string[] = [];
	for (const spec of targetSpecs) {
		const key = `${spec.subtype}:${spec.method}`;
		const proto = (module as Record<string, { prototype?: object }>)[
			spec.kind === "add-method" ? "BashExecutionComponent" : protoNameFor(key)
		]?.prototype;
		const value =
			spec.kind === "add-method"
				? Object.getOwnPropertyDescriptor(proto, "constructor")?.value
				: Object.getOwnPropertyDescriptor(proto, spec.method)?.value;
		const fp = fingerprintOf(value);
		const identities = KNOWN_NATIVE_IDENTITIES[key] ?? [];
		if (!identities.some((identity) => identity.fingerprint === fp && identity.versions.includes(version)))
			misses.push(
				`${version} ${key} fp=${fp ?? "none"} recorded=${identities.map((i) => `${i.fingerprint}@[${i.versions.join(",")}]`).join(" | ")}`,
			);
	}
	return misses;
}

function protoNameFor(key: string): string {
	const map: Record<string, string> = {
		"native-assistant-message": "AssistantMessageComponent",
		"native-compaction-message": "CompactionSummaryMessageComponent",
		"native-branch-message": "BranchSummaryMessageComponent",
		"native-skill-message": "SkillInvocationMessageComponent",
		"native-custom-message": "CustomMessageComponent",
		"tool-call-renderer": "ToolExecutionComponent",
		"tool-result-renderer": "ToolExecutionComponent",
	};
	return map[key.split(":")[0]] ?? "";
}

describe("recorded identity registry vs real pi artifacts", () => {
	it("certifies every surface against the local modular pi build", async () => {
		initTheme("dark", false);
		const local = (await import("@earendil-works/pi-coding-agent")) as unknown as Record<string, unknown>;
		const pkgJson = (await import("node:fs")).readFileSync(
			new URL("../../node_modules/@earendil-works/pi-coding-agent/package.json", import.meta.url),
			"utf8",
		);
		const localVersion = JSON.parse(pkgJson).version as string;
		expect(certifyAgainst(local, localVersion).join("\n")).toBe("");
	});

	it("certifies every surface against the installed pi CLI bundle (the artifact family extensions actually receive)", async () => {
		const { execSync } = await import("node:child_process");
		let bundleUrl: URL | undefined;
		try {
			const piBin = execSync("command -v pi", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
			// pi is typically a symlink into the active node_modules install.
			const real = (await import("node:fs")).realpathSync(piBin);
			const installRoot = real.match(/^(.*@earendil-works\/pi-coding-agent)\/dist\//)?.[1];
			if (installRoot) {
				const candidate = new URL(`file://${installRoot}/dist/bundle/index.js`);
				if ((await import("node:fs")).existsSync(candidate)) bundleUrl = candidate;
			}
		} catch {
			// pi not installed/resolvable in this environment (e.g. CI): skip.
		}
		if (!bundleUrl) return;
		const bundlePkg = JSON.parse(
			(await import("node:fs")).readFileSync(new URL("../../package.json", bundleUrl), "utf8"),
		);
		const bundle = (await import(bundleUrl.href)) as unknown as Record<string, unknown>;
		expect(certifyAgainst(bundle, bundlePkg.version as string).join("\n")).toBe("");
	});
});
