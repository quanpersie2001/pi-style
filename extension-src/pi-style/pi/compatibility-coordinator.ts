import { isTierCAuthorized } from "../domain/config-authorization.js";
import type { NormalizedPiStyleConfig } from "../domain/config-types.js";
import {
	type CompatibilityCleanupResult,
	type CompatibilityProbeReport,
	detectPiVersion,
	disposePiCompatibilityProbe,
	probePiCompatibility,
} from "./compatibility-probe.js";

export interface CompatibilityCoordinator {
	captureAuthorization(
		coreFlag: boolean,
		assistantFlag: boolean,
		specialBlocksFlag: boolean,
		toolsFlag: boolean,
		asciiFlag: boolean,
	): void;
	state(config: NormalizedPiStyleConfig): Readonly<Record<string, unknown>>;
	install(
		config: NormalizedPiStyleConfig,
		tui: boolean,
		productGate?: "omitted" | "allow" | "deny",
	): CompatibilityProbeReport | undefined;
	dispose(): CompatibilityCleanupResult;
	readonly report: CompatibilityProbeReport | undefined;
}

export function createCompatibilityCoordinator(dispose = disposePiCompatibilityProbe): CompatibilityCoordinator {
	let report: CompatibilityProbeReport | undefined;
	let cleanupPending = false;
	let authorization:
		| {
				core: boolean;
				assistant: boolean;
				specialBlocks: boolean;
				tools: boolean;
				ascii: boolean;
		  }
		| undefined;
	return {
		get report() {
			return report;
		},
		captureAuthorization(core, assistant, specialBlocks, tools, ascii) {
			authorization = { core, assistant, specialBlocks, tools, ascii };
		},
		state(config) {
			const version = detectPiVersion();
			const messagesConfigured =
				config.enabled && config.messages.enabled && (config.messages.assistantPrefix || config.messages.specialBlocks);
			const toolsConfigured = config.enabled && config.tools.enabled;
			const surface = (
				feature: "messages" | "tools",
				configured: boolean,
				surfaceAuthorized: boolean,
				subtype?: string,
			) => {
				const records =
					report?.unsupported.filter((item) =>
						feature === "messages" ? item.subtype.includes("message") : item.subtype.includes("tool"),
					) ?? [];
				const failed = records.some((item) => /identity|failed|unsupported shape/i.test(item.reason));
				const fallback = records.some((item) => /fallback|authorization|disabled/i.test(item.reason));
				const authorized = Boolean(authorization?.core && surfaceAuthorized);
				const installedRecord = report?.recordSnapshots.some(
					(item) => item.feature === feature && !item.disposed && (subtype === undefined || item.subtype === subtype),
				);
				return {
					configured,
					authorized,
					installed: Boolean(installedRecord && !failed && authorized && configured),
					conflicted: records.some((item) => item.reason.includes("owner")),
					failed,
					cleanupPending,
					nativeFallback: fallback,
					...(authorized ? {} : { awaitingAuthorization: true }),
				};
			};
			return {
				configured: messagesConfigured || toolsConfigured,
				authorized: authorization?.core ?? false,
				installed: report !== undefined,
				conflicted: report?.unsupported.some((item) => item.reason.includes("identity")) ?? false,
				failed: report?.unsupported.some((item) => item.reason.includes("failed")) ?? false,
				cleanupPending,
				nativeFallbacks: report?.unsupported.filter((item) => item.reason.includes("fallback")).length ?? 0,
				piVersion: version.version ?? report?.piVersion ?? "unknown",
				versionRange: report?.versionRange ?? ">=0.83.0 <0.84.0",
				assistantMessage: surface(
					"messages",
					config.enabled && config.messages.enabled && config.messages.assistantPrefix,
					Boolean(authorization?.assistant),
					"native-assistant-message",
				),
				tools: surface("tools", config.enabled && config.tools.enabled, Boolean(authorization?.tools)),
				specialBlocks: surface(
					"messages",
					config.enabled && config.messages.enabled && config.messages.specialBlocks,
					Boolean(authorization?.core),
				),
			};
		},
		install(config, tui, productGate = "omitted") {
			const productDenied = productGate === "deny";
			if (cleanupPending && !report) cleanupPending = false;
			if (cleanupPending || !tui || !config.enabled || !authorization?.core || productDenied) return undefined;
			const certifiedHost = detectPiVersion().version === "0.83.0";
			const assistantEnabled =
				authorization.assistant &&
				isTierCAuthorized({
					certifiedHost,
					coreFlag: authorization.core,
					surfaceFlag: true,
					surface: "assistantMessage",
					config,
				});
			const specialBlocksEnabled =
				authorization.specialBlocks &&
				isTierCAuthorized({
					certifiedHost,
					coreFlag: authorization.core,
					surfaceFlag: true,
					surface: "specialBlocks",
					config,
				});
			const messagesEnabled = (assistantEnabled || specialBlocksEnabled) && config.messages.enabled;
			const toolsEnabled =
				authorization.tools &&
				isTierCAuthorized({ certifiedHost, coreFlag: authorization.core, surfaceFlag: true, surface: "tools", config });
			if (!messagesEnabled && !toolsEnabled) return undefined;
			const detected = detectPiVersion();
			report = probePiCompatibility(detected.version, {
				config: {
					...config,
					messages: {
						...config.messages,
						enabled: messagesEnabled,
						assistantPrefix: assistantEnabled,
						specialBlocks: messagesEnabled && config.messages.specialBlocks && specialBlocksEnabled,
					},
					tools: {
						...config.tools,
						enabled: toolsEnabled,
					},
				},
				messageSnapshot: {
					assistantPrefix: authorization.ascii ? "[assistant] " : "│ ",
					assistantEnabled,
				},
				toolSnapshot: {
					callMarker: authorization.ascii ? "[tool] " : "[tool] ",
					resultMarker: authorization.ascii ? "[result] " : "[tool:result] ",
					style: config.tools.style === "compact-box" ? "compact-box" : "marker",
				},
			});
			return report;
		},
		dispose() {
			if (!report) {
				cleanupPending = false;
				return { complete: true, retryablePrototypeRecords: 0, retryableToolRecords: 0 };
			}
			const result = dispose(report);
			cleanupPending = !result.complete;
			if (result.complete) {
				report = undefined;
				cleanupPending = false;
			}
			return result;
		},
	};
}
