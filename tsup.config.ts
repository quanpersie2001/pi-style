import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		"pi-style": "extension-src/pi-style/pi/index.ts",
	},
	format: ["esm"],
	dts: false,
	sourcemap: true,
	clean: true,
	target: "node20",
	outDir: "dist/extensions",
	external: [
		"@earendil-works/pi-ai",
		"@earendil-works/pi-agent-core",
		"@earendil-works/pi-coding-agent",
		"@earendil-works/pi-tui",
		"typebox",
	],
});
