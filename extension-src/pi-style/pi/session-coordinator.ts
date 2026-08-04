import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type KeyId, matchesKey } from "@earendil-works/pi-tui";
import type { ConfigFilePort } from "../app/config-storage.js";
import { createPiStyleApp, type PiStyleApp } from "../app/index.js";
import { setSpecialBlockTheme } from "../features/messages/special-blocks.js";
import { setToolsRenderConfig } from "../features/tools/boxed/session-config.js";
import { createCompatibilityCoordinator } from "./compatibility-coordinator.js";
import {
	type CompatibilityCleanupResult,
	type CompatibilityProbeReport,
	disposePiCompatibilityProbe,
} from "./compatibility-probe.js";
import { createPiConfigFilePort, defaultStoragePaths } from "./config-host.js";
import { createConfigSourceAdapter, readSessionAuthorization } from "./config-session.js";
import { buildOperationalState } from "./operational-state.js";
import { collectToolDetails } from "./startup-resources.js";

export type CompatibilityTestHooks = {
	dispose?: (report: CompatibilityProbeReport) => CompatibilityCleanupResult;
	filePort?: ConfigFilePort;
	paths?: (cwd: string) => { globalPath: string; projectPath: string };
	/** Test-only capability seam; Pi's ExtensionContext does not provide a Git runner. */
	gitRunner?: import("../domain/providers.js").GitCommandRunner;
	/** Override the thinking-cycle key binding consumed to suppress Pi's status toast. */
	thinkingCycleKey?: string;
};

const THINKING_CYCLE = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export function createPiStyleSessionCoordinator(pi: ExtensionAPI, hooks: CompatibilityTestHooks = {}) {
	const filePort = hooks.filePort ?? createPiConfigFilePort();
	const gitRunner =
		hooks.gitRunner ??
		({
			run: async (args, commandCwd, timeoutMs, signal) => {
				const result = await pi.exec("git", [...args], {
					cwd: commandCwd,
					timeout: timeoutMs,
					...(signal ? { signal } : {}),
				});
				return { stdout: result.stdout, stderr: result.stderr, code: result.code };
			},
		} satisfies import("../domain/providers.js").GitCommandRunner);
	let cwd = process.cwd();
	let active = false;
	let tuiSession = false;
	let terminalInputUnsubscribe: (() => void) | undefined;
	const source = createConfigSourceAdapter(
		pi,
		filePort,
		hooks.paths ?? ((sessionCwd) => defaultStoragePaths(sessionCwd)),
	);
	const compatibility = createCompatibilityCoordinator(
		(report) => hooks.dispose?.(report) ?? disposePiCompatibilityProbe(report),
	);
	// Initial read may be empty in real Pi (flag values apply after extension load);
	// start() re-reads and re-captures at every session_start.
	let authorization = readSessionAuthorization(pi);
	let productGate: "omitted" | "allow" | "deny" = "omitted";
	const syncOperational = (config: import("../domain/config-types.js").NormalizedPiStyleConfig) => {
		app.setOperationalState(
			buildOperationalState(
				config,
				authorization,
				compatibility,
				app.runtime.current?.installationState,
				app.productPolicy.corePatchGate,
			),
		);
	};
	const app: PiStyleApp = createPiStyleApp(
		undefined,
		{
			load: async (trusted) => {
				source.setSession(cwd, trusted);
				return source.load();
			},
		},
		(config) => {
			productGate = app.productPolicy.corePatchGate;
			if (!active) return;
			if (compatibility.report) {
				const cleanup = compatibility.dispose();
				if (!cleanup.complete) {
					syncOperational(config);
					return;
				}
			}
			compatibility.install(config, tuiSession, productGate);
			syncOperational(config);
		},
	);

	return {
		app,
		async start(event: { reason: string }, ctx: ExtensionContext): Promise<void> {
			// Authorization is session-bound: Pi applies extension flag values only after
			// extension modules finish loading, so flags must be read here (session_start),
			// never at coordinator creation time.
			authorization = readSessionAuthorization(pi);
			compatibility.captureAuthorization(
				authorization.core,
				authorization.user,
				authorization.assistant,
				authorization.specialBlocks,
				authorization.tools,
				authorization.ascii,
			);
			// Replacement is failure-atomic: retain the current runtime until
			// compatibility ownership has been restored successfully.
			if (compatibility.report) {
				const cleanup = compatibility.dispose();
				if (!cleanup.complete) {
					syncOperational(app.config);
					return;
				}
			}
			if (app.runtime.current) app.sessionShutdown();
			cwd = ctx.cwd ?? process.cwd();
			tuiSession = ctx.mode === "tui";
			app.setProjectTrusted(ctx.isProjectTrusted());
			source.setSession(cwd, ctx.isProjectTrusted());
			active = false;
			await app.reload();
			productGate = app.productPolicy.corePatchGate;
			active = true;
			compatibility.install(app.config, ctx.mode === "tui", productGate);
			// Session-scoped render configuration for the boxed tool/message surfaces.
			// Populated once per session (never inside render).
			setToolsRenderConfig(app.config.tools);
			if (ctx.ui?.theme) setSpecialBlockTheme(ctx.ui.theme as never);
			const toolDetails = collectToolDetails(pi.getActiveTools?.(), pi.getAllTools?.());
			app.sessionStart(
				{
					mode: ctx.mode,
					hasUI: ctx.hasUI,
					...(ctx.ui ? { ui: ctx.ui } : {}),
					...(ctx.cwd ? { cwd: ctx.cwd } : {}),
					...(ctx.model
						? {
								model: {
									id: ctx.model.id,
									name: ctx.model.name,
									provider: ctx.model.provider,
									reasoning: ctx.model.reasoning,
								},
							}
						: {}),
					...(ctx.thinkingLevel ? { thinkingLevel: ctx.thinkingLevel } : {}),
					getContextUsage: ctx.getContextUsage,
					projectTrusted: ctx.isProjectTrusted(),
					gitRunner,
				},
				event.reason as "startup" | "reload" | "new" | "resume" | "fork",
				{
					...(typeof ctx.getSystemPrompt === "function" ? { systemPrompt: ctx.getSystemPrompt() } : {}),
					...(toolDetails ? { toolDetails } : {}),
					...(ctx.scopedModels && ctx.scopedModels.length > 0 ? { models: ctx.scopedModels.length } : {}),
				},
			);
			terminalInputUnsubscribe?.();
			terminalInputUnsubscribe = undefined;
			// Consume Pi's default thinking-cycle key and re-issue it through the public API so
			// the footer shows the level without Pi's transient "Thinking level: X" status toast.
			const cycleKey = hooks.thinkingCycleKey ?? "shift+tab";
			if (ctx.mode === "tui" && ctx.ui?.onTerminalInput) {
				terminalInputUnsubscribe = ctx.ui.onTerminalInput((data) => {
					if (!matchesKey(data, cycleKey as KeyId)) return undefined;
					const current = pi.getThinkingLevel?.();
					const index = Math.max(0, THINKING_CYCLE.indexOf(current as (typeof THINKING_CYCLE)[number]));
					const next = THINKING_CYCLE[(index + 1) % THINKING_CYCLE.length];
					pi.setThinkingLevel?.(next as never);
					return { consume: true };
				});
			}
			syncOperational(app.config);
		},
		shutdown(): void {
			active = false;
			tuiSession = false;
			terminalInputUnsubscribe?.();
			terminalInputUnsubscribe = undefined;
			app.sessionShutdown();
			// Tier C prototype patches stay installed across session switches. Pi renders
			// the restored chat (renderBeforeBind) AFTER session_shutdown but BEFORE the
			// next session_start, so disposing here would rebuild the resumed tool and
			// special-block surfaces with native prototypes and they would never be
			// re-decorated (their boxed output is derived once at updateDisplay time and
			// cached; a later frame render does not re-invoke the renderer selectors).
			// The next start() disposes this report (restoring the native identities)
			// and reinstalls before any new render. On process exit (reason "quit") the
			// terminal is torn down immediately after, so retained patches are harmless.
		},
	};
}
