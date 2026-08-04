import { afterEach, describe, expect, it, vi } from "vitest";
import piStyleExtension from "../../extension-src/pi-style/pi/index.js";
import { FakePiHost } from "../helpers/fake-pi-host.js";

function tool(name: string) {
	return { name };
}

describe("pi-style read-only tool activation", () => {
	afterEach(() => vi.useRealTimers());

	it("activates grep/find/ls on session_start when the flag is enabled", async () => {
		const host = new FakePiHost();
		host.allTools = [tool("read"), tool("bash"), tool("edit"), tool("write"), tool("grep"), tool("find"), tool("ls")];
		host.activeTools = ["read", "bash", "edit", "write"];
		piStyleExtension(host.extensionApi);
		await host.sessionStart();
		expect(host.activeTools).toEqual(["read", "bash", "edit", "write", "grep", "find", "ls"]);
	});

	it("leaves the tool set untouched when grep/find/ls are already active", async () => {
		const host = new FakePiHost();
		host.allTools = [tool("grep"), tool("find"), tool("ls")];
		host.activeTools = ["grep", "find", "ls"];
		piStyleExtension(host.extensionApi);
		await host.sessionStart();
		expect(host.activeTools).toEqual(["grep", "find", "ls"]);
	});

	it("does not add tools that are not registered", async () => {
		const host = new FakePiHost();
		host.allTools = [tool("read"), tool("ls")];
		host.activeTools = ["read"];
		piStyleExtension(host.extensionApi);
		await host.sessionStart();
		expect(host.activeTools).toEqual(["read", "ls"]);
	});

	it("respects the pi-style-readonly-tools flag set to false", async () => {
		const host = new FakePiHost({ flags: { "pi-style-readonly-tools": false } });
		host.allTools = [tool("grep"), tool("find"), tool("ls")];
		host.activeTools = ["read"];
		piStyleExtension(host.extensionApi);
		await host.sessionStart();
		expect(host.activeTools).toEqual(["read"]);
	});
});
