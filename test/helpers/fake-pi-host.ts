import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionEvent,
	ExtensionUIContext,
	Theme,
	WorkingIndicatorOptions,
} from "@earendil-works/pi-coding-agent";
import type { GitCommandRunner } from "../../extension-src/pi-style/domain/providers.js";
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
	sessionReason?: "startup" | "reload" | "new" | "resume" | "fork";
	capabilities?: Partial<FakePiCapabilities>;
	initialEditor?: NonNullable<ExtensionUIContext["setEditorComponent"]> extends (factory: infer F) => void ? F : never;
	initialFooter?: Parameters<ExtensionUIContext["setFooter"]>[0];
	systemPrompt?: string;
	flags?: Record<string, boolean | string | undefined>;
	projectTrusted?: boolean;
	cwd?: string;
	/** Active theme name (default "fake"). */
	themeName?: string;
	/** Available themes for getTheme/setTheme; the active theme is registered automatically. */
	themes?: Record<string, Theme>;
	/** Test-only provider seam; production Pi does not expose this on ExtensionContext. */
	gitRunner?: GitCommandRunner;
	/** Session entries surfaced through the fake session manager (usage aggregation). */
	sessionEntries?: readonly unknown[];
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
	readonly registeredTools: unknown[] = [];
	readonly registeredFlags = new Map<string, unknown>();
	readonly registeredMessageRenderers = new Map<string, unknown>();
	readonly registeredEntryRenderers = new Map<string, unknown>();
	readonly appendedEntries: Array<{ customType: string; data?: unknown }> = [];
	activeTools: string[] = [];
	allTools: unknown[] = [];
	readonly widgets = new Map<string, { content: unknown; placement: "aboveEditor" | "belowEditor" }>();
	readonly componentFactories = new Map<
		string,
		(
			tui: { requestRender: () => void },
			theme: Theme,
		) => { render(width: number): string[]; invalidate(): void; dispose?(): void }
	>();
	readonly notifications: Array<{ message: string; type?: "info" | "warning" | "error" }> = [];
	/** Theme names passed to ui.setTheme by the extension under test. */
	readonly setThemeCalls: string[] = [];
	readonly renderRequests: Array<"tui" | "rpc"> = [];
	readonly overlays: Array<{ options?: unknown; handle: { hidden: boolean; disposed: boolean } }> = [];
	readonly workingIndicatorChanges: Array<WorkingIndicatorOptions | undefined> = [];
	terminalInputSubscriptions = 0;
	readonly terminalInputHandlers = new Set<(data: string) => { consume?: boolean; data?: string } | undefined>();

	/** Dispatch raw terminal input through extension handlers; returns true when consumed. */
	emitTerminalInput(data: string): boolean {
		let consumed = false;
		for (const handler of this.terminalInputHandlers) {
			const result = handler(data);
			if (result?.consume) {
				consumed = true;
				break;
			}
		}
		return consumed;
	}
	private headerFactory: Parameters<NonNullable<ExtensionUIContext["setHeader"]>>[0] | undefined;
	readonly ownership = {
		header: { initial: false, current: false, restores: 0 },
		editor: { initial: false, current: false, restores: 0 },
		footer: { initial: false, current: false, restores: 0 },
	};
	private editorFactory: NonNullable<ExtensionUIContext["setEditorComponent"]> extends (factory: infer F) => void
		? F | undefined
		: undefined;
	/** Active theme; ui.setTheme may replace it. */
	theme: Theme;
	private readonly themeRegistry: Map<string, Theme>;
	model: unknown;
	thinkingLevel = "off";
	private sessionStarted = false;
	/** Last label passed to setHiddenThinkingLabel by the extension (undefined = untouched). */
	hiddenThinkingLabel: string | undefined = undefined;
	private readonly api: ExtensionAPI;
	private readonly context: ExtensionContext;
	private readonly sessionReason: NonNullable<FakePiHostOptions["sessionReason"]>;
	private readonly systemPrompt: string;
	private readonly flagValues: Record<string, boolean | string | undefined>;
	private readonly projectTrusted: boolean;
	private readonly cwd: string | undefined;
	readonly gitRunner: GitCommandRunner | undefined;
	readonly sessionEntries: readonly unknown[];

	constructor(options: FakePiHostOptions = {}) {
		this.mode = options.mode ?? "tui";
		this.sessionReason = options.sessionReason ?? "startup";
		this.systemPrompt = options.systemPrompt ?? "";
		this.flagValues = { ...options.flags };
		this.projectTrusted = options.projectTrusted ?? true;
		this.cwd = options.cwd ?? "/fake";
		this.gitRunner = options.gitRunner ?? (async () => ({ stdout: "", stderr: "not a git repository", code: 1 }));
		this.sessionEntries = options.sessionEntries ?? [];
		this.capabilities = { ...defaultCapabilities, ...options.capabilities };
		this.theme = createFakeTheme({ name: options.themeName ?? "fake" });
		this.themeRegistry = new Map(Object.entries(options.themes ?? {}));
		if (!this.themeRegistry.has(this.theme.name ?? "fake"))
			this.themeRegistry.set(this.theme.name ?? "fake", this.theme);
		this.ownership.editor.initial = options.initialEditor !== undefined;
		this.ownership.editor.current = this.ownership.editor.initial;
		this.ownership.footer.initial = options.initialFooter !== undefined;
		this.ownership.footer.current = this.ownership.footer.initial;
		this.editorFactory = options.initialEditor;
		this.api = this.createApi();
		this.context = this.createContext();
	}

	get extensionApi(): ExtensionAPI {
		return this.api;
	}

	get extensionContext(): ExtensionContext {
		return this.context;
	}

	getSystemPrompt(): string {
		return this.systemPrompt;
	}

	get sessionIsStarted(): boolean {
		return this.sessionStarted;
	}

	get currentHeaderFactory(): typeof this.headerFactory {
		return this.headerFactory;
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
			registerFlag: (name, options) => {
				this.registeredFlags.set(name, options);
				// Mirror Pi's extension loader: registerFlag seeds the runtime flag value
				// with its default when the session did not pass an explicit value.
				if (options.default !== undefined && this.flagValues[name] === undefined) {
					this.flagValues[name] = options.default;
				}
			},
			getFlag: (name) => this.flagValues[name],
			registerTool: (tool) => {
				this.registeredTools.push(tool);
			},
			registerMessageRenderer: (customType, renderer) => {
				this.registeredMessageRenderers.set(customType, renderer);
			},
			registerEntryRenderer: (customType, renderer) => {
				this.registeredEntryRenderers.set(customType, renderer);
			},
			sendMessage: () => {},
			sendUserMessage: () => {},
			appendEntry: (customType, data) => {
				this.appendedEntries.push({ customType, data });
			},
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
			getActiveTools: () => [...this.activeTools],
			getAllTools: () => [...this.allTools] as never,
			setActiveTools: (toolNames) => {
				this.activeTools = [...toolNames];
			},
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
		const host = this;
		const ui: ExtensionUIContext = {
			select: async () => undefined,
			confirm: async () => false,
			input: async () => undefined,
			notify: (message, type) => {
				this.notifications.push({ message, type });
			},
			onTerminalInput: (handler) => {
				this.terminalInputSubscriptions++;
				this.terminalInputHandlers.add(handler as never);
				return () => {
					this.terminalInputSubscriptions--;
					this.terminalInputHandlers.delete(handler as never);
				};
			},
			setStatus: () => {},
			setWorkingMessage: () => {},
			setWorkingVisible: () => {},
			setWorkingIndicator: this.capabilities.workingIndicator
				? (options) => {
						this.workingIndicatorChanges.push(options);
					}
				: () => {},
			setHiddenThinkingLabel: (label) => {
				this.hiddenThinkingLabel = label;
			},
			setWidget: this.capabilities.widgets
				? (key, content, options) => {
						if (content === undefined) {
							this.widgets.delete(key);
							this.componentFactories.delete(key);
						} else {
							this.widgets.set(key, { content, placement: options?.placement ?? "aboveEditor" });
							if (typeof content === "function") this.componentFactories.set(key, content as never);
						}
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
						this.headerFactory = factory;
						this.ownership.header.current = factory !== undefined;
						if (factory === undefined) this.ownership.header.restores++;
					}
				: () => {},
			setTitle: () => {},
			custom: async (factory, options) => {
				this.requestRender();
				if (!options?.overlay) return undefined as never;
				const handle = {
					hidden: false,
					disposed: false,
					hide: () => {
						handle.hidden = true;
						handle.disposed = true;
					},
					setHidden: (hidden: boolean) => {
						handle.hidden = hidden;
					},
					isHidden: () => handle.hidden,
					focus: () => {},
					unfocus: () => {},
					isFocused: () => !handle.hidden,
				};
				this.overlays.push({ options: options.overlayOptions, handle });
				options.onHandle?.(handle as never);
				const component = await factory(
					{ requestRender: () => this.requestRender() } as never,
					this.theme,
					{} as never,
					() => {
						handle.hidden = true;
						handle.disposed = true;
					},
				);
				this.componentFactories.set("pi-style.startup.overlay", (() => component) as never);
				return undefined as never;
			},
			pasteToEditor: () => {},
			setEditorText: () => {},
			getEditorText: () => "",
			editor: async () => undefined,
			addAutocompleteProvider: () => {},
			setEditorComponent: this.capabilities.customEditor
				? (factory) => {
						this.editorFactory = factory;
						this.ownership.editor.current = factory !== undefined;
						if (factory === undefined) this.ownership.editor.restores++;
					}
				: () => {},
			getEditorComponent: () => this.editorFactory,
			get theme() {
				return host.theme;
			},
			getAllThemes: () => [...host.themeRegistry.keys()].map((name) => ({ name, path: undefined })),
			getTheme: (name) => host.themeRegistry.get(name),
			setTheme: (themeOrName) => {
				const name = typeof themeOrName === "string" ? themeOrName : ((themeOrName as Theme).name ?? "");
				host.setThemeCalls.push(name);
				const candidate = typeof themeOrName === "string" ? host.themeRegistry.get(name) : (themeOrName as Theme);
				if (!candidate) return { success: false, error: `unknown theme "${name}"` };
				host.theme = candidate;
				return { success: true };
			},
			getToolsExpanded: () => false,
			setToolsExpanded: () => {},
		};
		return {
			ui,
			mode: this.mode,
			hasUI: this.mode === "tui" || this.mode === "rpc",
			cwd: this.cwd ?? "/fake",
			sessionManager: {
				getEntries: () => this.sessionEntries,
			} as never,
			modelRegistry: {} as never,
			model: undefined,
			scopedModels: [],
			thinkingLevel: "off" as never,
			isIdle: () => true,
			isProjectTrusted: () => this.projectTrusted,
			signal: undefined,
			abort: () => {},
			hasPendingMessages: () => false,
			shutdown: () => {},
			getContextUsage: () => undefined,
			compact: () => {},
			getSystemPrompt: () => this.systemPrompt,
		};
	}

	async sessionStart(): Promise<void> {
		this.sessionStarted = true;
		await this.emit("session_start", { type: "session_start", reason: this.sessionReason });
	}
	async sessionShutdown(): Promise<void> {
		await this.emit("session_shutdown", { type: "session_shutdown", reason: "quit" });
		this.sessionStarted = false;
	}
}
