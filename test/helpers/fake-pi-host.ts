import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionEvent,
	ExtensionUIContext,
	WorkingIndicatorOptions,
} from "@earendil-works/pi-coding-agent";
import { createFakeTheme } from "./fake-theme.js";

export type FakePiMode = "tui" | "rpc" | "json" | "print";

export interface FakePiCapabilities {
	api: boolean;
	header: boolean;
	customEditor: boolean;
	customFooter: boolean;
	workingIndicator: boolean;
	widgets: boolean;
}

export interface FakePiHostOptions {
	mode?: FakePiMode;
	capabilities?: Partial<FakePiCapabilities>;
	initialEditor?: NonNullable<ExtensionUIContext["setEditorComponent"]> extends (factory: infer F) => void ? F : never;
	initialFooter?: Parameters<ExtensionUIContext["setFooter"]>[0];
}

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

const defaultCapabilities: FakePiCapabilities = {
	api: true,
	header: true,
	customEditor: true,
	customFooter: true,
	workingIndicator: true,
	widgets: true,
};

export class FakePiHost {
	readonly mode: FakePiMode;
	readonly capabilities: FakePiCapabilities;
	readonly handlers = new Map<string, Handler[]>();
	readonly commands = new Map<string, unknown>();
	readonly widgets = new Map<string, { content: unknown; placement: "aboveEditor" | "belowEditor" }>();
	readonly notifications: Array<{ message: string; type?: "info" | "warning" | "error" }> = [];
	readonly renderRequests: Array<"tui" | "rpc"> = [];
	readonly workingIndicatorChanges: Array<WorkingIndicatorOptions | undefined> = [];
	readonly ownership = {
		header: { initial: false, current: false, restores: 0 },
		editor: { initial: false, current: false, restores: 0 },
		footer: { initial: false, current: false, restores: 0 },
	};
	readonly theme = createFakeTheme();
	model: unknown;
	thinkingLevel = "off";
	private sessionStarted = false;
	private readonly api: ExtensionAPI;
	private readonly context: ExtensionContext;

	constructor(options: FakePiHostOptions = {}) {
		this.mode = options.mode ?? "tui";
		this.capabilities = { ...defaultCapabilities, ...options.capabilities };
		this.ownership.editor.initial = options.initialEditor !== undefined;
		this.ownership.editor.current = this.ownership.editor.initial;
		this.ownership.footer.initial = options.initialFooter !== undefined;
		this.ownership.footer.current = this.ownership.footer.initial;
		this.api = this.createApi();
		this.context = this.createContext();
	}

	get extensionApi(): ExtensionAPI {
		return this.api;
	}

	get extensionContext(): ExtensionContext {
		return this.context;
	}

	get sessionIsStarted(): boolean {
		return this.sessionStarted;
	}

	requestRender(): void {
		if (this.mode === "tui" || this.mode === "rpc") this.renderRequests.push(this.mode);
	}

	async emit<T extends ExtensionEvent["type"]>(type: T, event: Extract<ExtensionEvent, { type: T }>): Promise<void> {
		for (const handler of this.handlers.get(type) ?? []) await handler(event, this.context);
	}

	private createApi(): ExtensionAPI {
		const partial: Partial<ExtensionAPI> = {
			on: (event, handler) => {
				const list = this.handlers.get(event) ?? [];
				list.push(handler as unknown as Handler);
				this.handlers.set(event, list);
			},
			registerCommand: (name, options) => {
				this.commands.set(name, options);
			},
			registerShortcut: () => {},
			registerFlag: () => {},
			getFlag: () => undefined,
			registerTool: () => {},
			registerMessageRenderer: () => {},
			registerEntryRenderer: () => {},
			sendMessage: () => {},
			sendUserMessage: () => {},
			appendEntry: () => {},
			setSessionName: () => {},
			getSessionName: () => undefined,
			setLabel: () => {},
			exec: async () => ({
				stdout: "",
				stderr: "",
				output: "",
				code: 0,
				exitCode: 0,
				killed: false,
				cancelled: false,
				truncated: false,
			}),
			getActiveTools: () => [],
			getAllTools: () => [],
			setActiveTools: () => {},
			getCommands: () => [],
			setModel: async () => false,
			getThinkingLevel: () => this.thinkingLevel as never,
			setThinkingLevel: (level) => {
				this.thinkingLevel = level;
			},
			registerProvider: () => {},
			unregisterProvider: () => {},
			events: { on: () => () => {}, emit: async () => {}, subscribe: () => () => {} } as never,
		};
		return partial as ExtensionAPI;
	}

	private createContext(): ExtensionContext {
		const ui: ExtensionUIContext = {
			select: async () => undefined,
			confirm: async () => false,
			input: async () => undefined,
			notify: (message, type) => {
				this.notifications.push({ message, type });
			},
			onTerminalInput: () => () => {},
			setStatus: () => {},
			setWorkingMessage: () => {},
			setWorkingVisible: () => {},
			setWorkingIndicator: this.capabilities.workingIndicator
				? (options) => {
						this.workingIndicatorChanges.push(options);
					}
				: () => {},
			setHiddenThinkingLabel: () => {},
			setWidget: this.capabilities.widgets
				? (key, content, options) => {
						if (content === undefined) this.widgets.delete(key);
						else this.widgets.set(key, { content, placement: options?.placement ?? "aboveEditor" });
					}
				: () => {},
			setFooter: this.capabilities.customFooter
				? (factory) => {
						this.ownership.footer.current = factory !== undefined;
						if (factory === undefined) this.ownership.footer.restores++;
					}
				: () => {},
			setHeader: this.capabilities.header
				? (factory) => {
						this.ownership.header.current = factory !== undefined;
						if (factory === undefined) this.ownership.header.restores++;
					}
				: () => {},
			setTitle: () => {},
			custom: async () => {
				this.requestRender();
				return undefined as never;
			},
			pasteToEditor: () => {},
			setEditorText: () => {},
			getEditorText: () => "",
			editor: async () => undefined,
			addAutocompleteProvider: () => {},
			setEditorComponent: this.capabilities.customEditor
				? (factory) => {
						this.ownership.editor.current = factory !== undefined;
						if (factory === undefined) this.ownership.editor.restores++;
					}
				: () => {},
			getEditorComponent: () => undefined,
			get theme() {
				return this.theme;
			},
			getAllThemes: () => [],
			getTheme: () => undefined,
			setTheme: () => ({ success: true }),
			getToolsExpanded: () => false,
			setToolsExpanded: () => {},
		};
		return {
			ui,
			mode: this.mode,
			hasUI: this.mode === "tui" || this.mode === "rpc",
			cwd: "/fake",
			sessionManager: {} as never,
			modelRegistry: {} as never,
			model: undefined,
			scopedModels: [],
			thinkingLevel: "off" as never,
			isIdle: () => true,
			isProjectTrusted: () => true,
			signal: undefined,
			abort: () => {},
			hasPendingMessages: () => false,
			shutdown: () => {},
			getContextUsage: () => undefined,
			compact: () => {},
			getSystemPrompt: () => "",
		};
	}

	async sessionStart(): Promise<void> {
		this.sessionStarted = true;
		await this.emit("session_start", { type: "session_start", reason: "startup" });
	}
	async sessionShutdown(): Promise<void> {
		await this.emit("session_shutdown", { type: "session_shutdown", reason: "quit" });
		this.sessionStarted = false;
	}
}
