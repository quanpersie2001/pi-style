import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../../extension-src/pi-style/domain/config-normalization.js";
import { createBuiltinSegments } from "../../extension-src/pi-style/domain/status.js";
import { renderStatus } from "../../extension-src/pi-style/domain/status-renderer.js";
import { resolveTheme } from "../../extension-src/pi-style/domain/theme.js";
import { decorateMessageRender } from "../../extension-src/pi-style/features/messages/index.js";
import { renderStartup } from "../../extension-src/pi-style/features/startup/index.js";
import { createToolDecorationOwner } from "../../extension-src/pi-style/features/tools/index.js";

describe("snapshot and adapter rendering", () => {
	it("renders pure status/startup snapshots and exercises message/tool adapters", () => {
		const config = normalizeConfig({ theme: { nerdFonts: "off" } });
		const theme = resolveTheme(undefined, config);
		expect(() =>
			renderStatus({ left: ["model", "git"], right: [], secondary: [] }, { model: "model" }, 80, {
				segments: createBuiltinSegments(),
				theme,
			}),
		).not.toThrow();
		expect(() => renderStartup({ reason: "startup", model: "model" }, config, {}, 80)).not.toThrow();
		let messageCalls = 0;
		decorateMessageRender(
			() => {
				messageCalls++;
				return ["text"];
			},
			{},
			[80],
		);
		expect(messageCalls).toBe(1);
		const owner = createToolDecorationOwner();
		owner.dispose();
		expect(owner.getActiveRecordCount()).toBe(0);
	});
});
