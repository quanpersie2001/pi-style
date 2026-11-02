import { fileURLToPath, pathToFileURL } from "node:url";
import { getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { Markdown, MouseRegion, Spacer } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	__resetMessageDecorationTestState,
	decorateMessageUpdate,
	setThoughtLabelTheme,
} from "../../extension-src/pi-style/features/messages/index.js";
import {
	renderSpecialMessageBlock,
	setSpecialBlockTheme,
} from "../../extension-src/pi-style/features/messages/special-blocks.js";
import { parseThinkingRuns } from "../../extension-src/pi-style/features/messages/thought-summary.js";
import {
	fingerprint,
	KNOWN_NATIVE_IDENTITIES,
	SUPPORTED_PI_VERSIONS,
	targetSpecs,
} from "../../extension-src/pi-style/pi/compatibility-probe.js";

const snapshot = { assistantPrefix: "│ ", assistantEnabled: true, collapseHiddenThinking: true, thoughtSummary: true };
const theme = { fg: (_color: string, text: string) => text };
afterEach(() => {
	__resetMessageDecorationTestState();
	setSpecialBlockTheme(undefined);
});

it("inserts omitted summaries in mixed visibility order without replacing Markdown slots", () => {
	initTheme("dark", false);
	setThoughtLabelTheme(theme);
	const first = new Markdown("Visible thought", 1, 0, getMarkdownTheme());
	const answer = new Markdown("Answer", 1, 0, getMarkdownTheme());
	const target = {
		hiddenThinkingLabel: "",
		hideThinkingBlock: true,
		isStreaming: false,
		thinkingVisibilityOverrides: new Map([[0, false]]),
		markdownSlots: [first, answer],
		contentContainer: { children: [] as unknown[] },
	};
	const message = {
		content: [
			{ type: "thinking", thinking: "Visible thought" },
			{ type: "text", text: "Answer" },
			{ type: "thinking", thinking: "Hidden thought" },
		],
		stopReason: "stop",
	};
	const native = () => {
		target.contentContainer.children = [new Spacer(1), new MouseRegion(first, () => undefined), new Spacer(1), answer];
	};
	decorateMessageUpdate(native, target, [message, false], snapshot);
	const children = target.contentContainer.children as { render(width: number): string[] }[];
	const output = children.flatMap((child) => child.render(60)).join("\n");
	expect(output.match(/1 thought/g)).toHaveLength(2);
	expect(output.indexOf("Visible thought")).toBeLessThan(output.indexOf("Answer"));
	expect(output.lastIndexOf("1 thought")).toBeGreaterThan(output.indexOf("Answer"));
	expect(children).toContain(answer);
	expect(target.markdownSlots).toEqual([first, answer]);
	decorateMessageUpdate(native, target, [message, false], snapshot);
	expect(target.contentContainer.children).toHaveLength(children.length);
});

it("forwards the native renderer options verbatim, including injected helpers", () => {
	setSpecialBlockTheme(theme);
	const options = { expanded: true, outputPad: 3, keyText: () => "host-key", keyHint: () => "host-hint", future: true };
	const renderer = (_message: unknown, received: typeof options) => {
		expect(received).toBe(options);
		return { render: () => [received.keyText(), received.keyHint()] };
	};
	const target = {
		message: { customType: "fixture" },
		customRenderer: renderer,
		customComponent: undefined as unknown,
		addChild() {},
		removeChild() {},
	};
	const native = () => {
		target.customComponent = target.customRenderer(target.message, options);
	};
	renderSpecialMessageBlock("native-custom-message", native, target, []);
	expect(target.customRenderer).toBe(renderer);
	const output = (target.customComponent as { render(width: number): string[] }).render(60).join("\n");
	expect(output).toContain("host-key");
	expect(output).toContain("host-hint");
});

const runtime =
	process.env.PI_STYLE_TEST_RUNTIME_ROOT ??
	fileURLToPath(new URL("../../node_modules/@earendil-works/pi-coding-agent", import.meta.url));
describe("installed Pi 1.5 artifact certification", () => {
	it.each(["index.js", "bundle/index.js"])(
		"decorates native omitted runs and preserves Markdown reuse in %s",
		async (artifact) => {
			const host = await import(pathToFileURL(`${runtime}/dist/${artifact}`).href);
			host.initTheme("dark", false);
			setThoughtLabelTheme(theme);
			const component = new host.AssistantMessageComponent(undefined, true, host.getMarkdownTheme(), "", 1);
			const native = host.AssistantMessageComponent.prototype.updateContent;
			const message = {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "First thought" },
					{ type: "text", text: "Answer" },
					{ type: "thinking", thinking: "Last thought" },
				],
				stopReason: "stop",
			};
			component.thinkingVisibilityOverrides.set(0, false);
			decorateMessageUpdate(native, component, [message, false], snapshot);
			const markdown = component.markdownSlots.map((slot: { markdown: object }) => slot.markdown);
			let output = component.render(60).join("\n");
			expect(output.match(/1 thought/g)).toHaveLength(2);
			expect(output.lastIndexOf("1 thought")).toBeGreaterThan(output.indexOf("Answer"));
			decorateMessageUpdate(native, component, [message, false], snapshot);
			for (const [index, slot] of component.markdownSlots.entries()) expect(slot.markdown).toBe(markdown[index]);
			output = component.render(60).join("\n");
			expect(output.match(/1 thought/g)).toHaveLength(2);
			component.thinkingVisibilityOverrides.set(0, true);
			component.thinkingVisibilityOverrides.set(1, false);
			decorateMessageUpdate(native, component, [message, false], snapshot);
			output = component.render(60).join("\n");
			expect(output.match(/1 thought/g)).toHaveLength(2);
			expect(output).not.toContain("First thought");
			expect(output.indexOf("Last thought")).toBeGreaterThan(output.indexOf("Answer"));
			const streaming = new host.AssistantMessageComponent(undefined, true, host.getMarkdownTheme(), "", 1);
			decorateMessageUpdate(
				native,
				streaming,
				[{ content: [{ type: "thinking", thinking: "Working" }] }, true],
				snapshot,
			);
			expect(streaming.render(60)).toEqual([]);
		},
	);
	it.each(["index.js", "bundle/index.js"])("keeps native run indices across empty text in %s", async (artifact) => {
		const host = await import(pathToFileURL(`${runtime}/dist/${artifact}`).href);
		host.initTheme("dark", false);
		setThoughtLabelTheme(theme);
		const component = new host.AssistantMessageComponent(undefined, true, host.getMarkdownTheme(), "", 1);
		const native = host.AssistantMessageComponent.prototype.updateContent;
		const message = {
			content: [
				{ type: "thinking", thinking: "First thought" },
				{ type: "text", text: "" },
				{ type: "thinking", thinking: "Second thought" },
				{ type: "text", text: " \t " },
				{ type: "thinking", thinking: "Third thought" },
				{ type: "text", text: "Answer" },
			],
			stopReason: "stop",
		};
		const runs = parseThinkingRuns(message, false);
		expect(runs.count).toBe(3);
		expect(runs.breakBefore).toEqual([false, false, false]);
		expect(runs.breakAfter).toEqual([false, false, true]);
		component.thinkingVisibilityOverrides.set(1, false);
		component.updateContent = (message: unknown, streaming: boolean) =>
			decorateMessageUpdate(native, component, [message, streaming], snapshot);
		component.updateContent(message, false);
		let output = component.render(60).join("\n");
		expect(output.match(/3 thoughts/g)).toHaveLength(1);
		expect(output).toContain("Second thought");
		expect(output).not.toContain("First thought");
		expect(output).not.toContain("Third thought");
		const header = component.contentContainer.children[1];
		expect(header.handleMouse({ type: "click", button: "left" })).toEqual({ handled: true });
		output = component.render(60).join("\n");
		// A mixed group first closes every run, then opens every native index.
		for (const text of ["First thought", "Second thought", "Third thought"]) expect(output).not.toContain(text);
		expect(component.contentContainer.children).toHaveLength(4); // pad, aggregate, spacer, answer: no blank anchors
		component.contentContainer.children[1].handleMouse({ type: "click", button: "left" });
		output = component.render(60).join("\n");
		for (const text of ["First thought", "Second thought", "Third thought"]) expect(output).toContain(text);
		expect(output.match(/3 thoughts/g)).toHaveLength(1);
		expect([...component.thinkingVisibilityOverrides.entries()]).toEqual([
			[1, false],
			[0, false],
			[2, false],
		]);
	});
	it.each(["index.js", "bundle/index.js"])("keeps native custom renderer helpers in %s", async (artifact) => {
		const host = await import(pathToFileURL(`${runtime}/dist/${artifact}`).href);
		host.initTheme("dark", false);
		setSpecialBlockTheme(theme);
		let calls = 0;
		const renderer = (
			_message: unknown,
			options: { keyText: typeof host.keyText; keyHint: typeof host.keyHint; outputPad: number },
		) => {
			calls++;
			expect(options.keyText).toBe(host.keyText);
			expect(options.keyHint).toBe(host.keyHint);
			expect(options.outputPad).toBe(3);
			return { render: () => [options.keyText("app.tools.expand"), options.keyHint("app.tools.expand", "expand")] };
		};
		const component = new host.CustomMessageComponent(
			{ customType: "fixture", content: "fallback" },
			undefined,
			host.getMarkdownTheme(),
			3,
		);
		component.customRenderer = renderer;
		const background = vi.fn((text: string) => `\x1b[48;2;1;2;3m${text}\x1b[49m`);
		component.box.setBgFn(background);
		renderSpecialMessageBlock("native-custom-message", host.CustomMessageComponent.prototype.rebuild, component, []);
		expect(calls).toBe(1);
		expect(component.customRenderer).toBe(renderer);
		expect(component.render(60).join("\n")).toContain("expand");
		expect(component.customComponent).toBeUndefined();
		expect(component.children.filter((child: unknown) => child === component.box)).toHaveLength(1);
		expect(component.box.children).toHaveLength(1);
		expect(background.mock.calls.some(([text]) => text.includes("╭"))).toBe(true);
		expect(background.mock.calls.some(([text]) => /^ +$/.test(text))).toBe(true);
		expect(component.box.render(60).every((line: string) => line.includes("\x1b[48;2;1;2;3m"))).toBe(true);
		renderSpecialMessageBlock("native-custom-message", host.CustomMessageComponent.prototype.rebuild, component, []);
		expect(component.children.filter((child: unknown) => child === component.box)).toHaveLength(1);
		expect(component.box.children).toHaveLength(1);
		expect(component.customRenderer).toBe(renderer);
	});
	it.each(["index.js", "bundle/index.js"])("matches every surface in %s", async (artifact) => {
		const host = await import(pathToFileURL(`${runtime}/dist/${artifact}`).href);
		const classes = [
			"AssistantMessageComponent",
			"AssistantMessageComponent",
			"CompactionSummaryMessageComponent",
			"BranchSummaryMessageComponent",
			"SkillInvocationMessageComponent",
			"InteractiveMode",
			"CustomMessageComponent",
			"InteractiveMode",
			"ToolExecutionComponent",
			"ToolExecutionComponent",
			"BashExecutionComponent",
		];
		for (const [index, spec] of targetSpecs.entries()) {
			const className = classes[index];
			if (!className) throw new Error(`Missing class for ${spec.subtype}`);
			const ctor = host[className];
			const method = spec.kind === "add-method" ? ctor : ctor.prototype[spec.method];
			expect(
				KNOWN_NATIVE_IDENTITIES[`${spec.subtype}:${spec.method}`]?.some(
					(identity) =>
						identity.versions.includes("1.5.0") &&
						identity.name === method.name &&
						identity.arity === method.length &&
						identity.fingerprint === fingerprint(method),
				),
			).toBe(true);
			expect(Object.getOwnPropertyDescriptor(ctor.prototype, spec.method)?.writable ?? spec.kind === "add-method").toBe(
				true,
			);
		}
		expect(SUPPORTED_PI_VERSIONS).toContain("1.5.0");
	});
});
