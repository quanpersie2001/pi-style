import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ConfigFilePort } from "../app/config-storage.js";
import { createPiStyleApp, type PiStyleApp } from "../app/index.js";
import { createCompatibilityCoordinator } from "./compatibility-coordinator.js";
import {
	type CompatibilityCleanupResult,
	type CompatibilityProbeReport,
	disposePiCompatibilityProbe,
} from "./compatibility-probe.js";
import { createPiConfigFilePort, defaultStoragePaths } from "./config-host.js";
import { createConfigSourceAdapter, readSessionAuthorization } from "./config-session.js";
import { buildOperationalState } from "./operational-state.js";

export type CompatibilityTestHooks = {
	dispose?: (report: CompatibilityProbeReport) => CompatibilityCleanupResult;
	filePort?: ConfigFilePort;
	paths?: () => { globalPath: string; projectPath: string };
};

export function createPiStyleSessionCoordinator(pi: ExtensionAPI, hooks: CompatibilityTestHooks = {}) {
	const filePort = hooks.filePort ?? createPiConfigFilePort();
	let cwd = process.cwd();
	let active = false;
	let tuiSession = false;
	const source = createConfigSourceAdapter(pi, filePort, hooks.paths ?? (() => defaultStoragePaths(cwd)));
	const compatibility = createCompatibilityCoordinator(
		(report) => hooks.dispose?.(report) ?? disposePiCompatibilityProbe(report),
	);
	const authorization = readSessionAuthorization(pi);
	compatibility.captureAuthorization(
		authorization.core,
		authorization.user,
		authorization.assistant,
		authorization.tools,
		authorization.ascii,
	);
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
			// Stop the old runtime before touching compatibility ownership. Failed cleanup leaves no stale UI/runtime active.
			if (app.runtime.current) app.sessionShutdown();
			if (compatibility.report) {
				const cleanup = compatibility.dispose();
				if (!cleanup.complete) {
					syncOperational(app.config);
					return;
				}
			}
			cwd = ctx.cwd ?? process.cwd();
			tuiSession = ctx.mode === "tui";
			app.setProjectTrusted(ctx.isProjectTrusted());
			source.setSession(cwd, ctx.isProjectTrusted());
			active = false;
			await app.reload();
			productGate = app.productPolicy.corePatchGate;
			active = true;
			compatibility.install(app.config, ctx.mode === "tui", productGate);
			app.sessionStart(
				{
					mode: ctx.mode,
					hasUI: ctx.hasUI,
					...(ctx.ui ? { ui: ctx.ui } : {}),
					...(ctx.cwd ? { cwd: ctx.cwd } : {}),
					...(ctx.model ? { model: { id: ctx.model.id, name: ctx.model.name } } : {}),
					...(ctx.thinkingLevel ? { thinkingLevel: ctx.thinkingLevel } : {}),
					getContextUsage: ctx.getContextUsage,
					projectTrusted: ctx.isProjectTrusted(),
				},
				event.reason as "startup" | "reload" | "new" | "resume" | "fork",
			);
			syncOperational(app.config);
		},
		shutdown(): void {
			active = false;
			tuiSession = false;
			app.sessionShutdown();
			compatibility.dispose();
		},
	};
}
