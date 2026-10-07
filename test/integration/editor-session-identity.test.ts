import { describe, expect, it } from "vitest";
import { EDITOR_COLOR_ENTRY_TYPE } from "../../extension-src/pi-style/pi/editor-color.js";
import piStyleExtension from "../../extension-src/pi-style/pi/index.js";
import { FakePiHost } from "../helpers/fake-pi-host.js";

type ColorCommand = { handler(args: string, ctx: FakePiHost["extensionContext"]): Promise<void> };

describe("editor session identity", () => {
	it("reads --color, keeps /color session-scoped, and rejects invalid input", async () => {
		const host = new FakePiHost({ flags: { color: "#abc" } });
		Object.assign(host.extensionApi, { getSessionName: () => "Expand brand components" });
		piStyleExtension(host.extensionApi);
		expect(host.registeredFlags.has("color")).toBe(true);
		await host.sessionStart();
		const factory = host.extensionContext.ui.getEditorComponent();
		expect(factory).toBeDefined();
		const editor = factory?.(
			{ requestRender() {}, terminal: { rows: 24 } } as never,
			{ borderColor: (text: string) => text, selectList: {} } as never,
			{ matches: () => false } as never,
		);
		expect(editor?.render(80)[0]).toContain("Expand brand components");
		expect(editor?.render(80)[0]).toContain("\x1b[38;2;170;187;204m");
		await host.emit("session_info_changed", { type: "session_info_changed", name: "Renamed task" });
		expect(editor?.render(80)[0]).toContain("Renamed task");
		expect(host.commands.has("color")).toBe(true);
		expect(host.extensionContext.ui).toBeDefined();
		const command = host.commands.get("color") as ColorCommand;
		await command.handler("not-a-color", host.extensionContext);
		expect(host.appendedEntries).toHaveLength(0);
		await command.handler("#00FA83", host.extensionContext);
		expect(editor?.render(80)[0]).toContain("\x1b[38;2;0;250;131m");
		expect(host.appendedEntries.at(-1)).toEqual({ customType: EDITOR_COLOR_ENTRY_TYPE, data: { color: "#00fa83" } });
		await command.handler("off", host.extensionContext);
		expect(editor?.render(80)[0]).not.toContain("\x1b[38;2;0;250;131m");
		expect(host.appendedEntries.at(-1)?.data).toEqual({ color: null });
		await host.sessionShutdown();
	});

	it("restores only the active branch's saved color, overriding the CLI default", async () => {
		const host = new FakePiHost({
			flags: { color: "#abc" },
			sessionEntries: [{ type: "custom", customType: EDITOR_COLOR_ENTRY_TYPE, data: { color: "#123456" } }],
		});
		piStyleExtension(host.extensionApi);
		await host.sessionStart();
		const command = host.commands.get("color") as ColorCommand;
		await command.handler("", host.extensionContext);
		expect(host.notifications.at(-1)?.message).toContain("#123456");
		await host.sessionShutdown();
	});
});
