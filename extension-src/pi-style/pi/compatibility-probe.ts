import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	AssistantMessageComponent,
	BranchSummaryMessageComponent,
	CompactionSummaryMessageComponent,
	CustomMessageComponent,
	SkillInvocationMessageComponent,
	ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { decorateMessageRender, type MessageDecorationSnapshot } from "../features/messages/index.js";
import { renderSpecialMessageBlock, type SpecialBlockSubtype } from "../features/messages/special-blocks.js";
import { createToolDecorationOwner } from "../features/tools/index.js";
import {
	type CompatibilityRecord,
	currentGeneration,
	installDelegatingPatch,
	nextGeneration,
} from "./compatibility-registry.js";

const PI_VERSION_RANGE = ">=0.83.0 <0.84.0";
const TRUSTED_PI_VERSION = "0.83.0";
const reportStates = new WeakMap<
	object,
	{ records: CompatibilityRecord[]; toolOwner: ReturnType<typeof createToolDecorationOwner> | undefined }
>();
// These fingerprints are coupled to the installed 0.83.0 package source. A matching
// name/arity/hash is evidence of the shipped native method, not a cryptographic proof:
// code loaded before this module could spoof the same function source. We therefore
// fail closed on every unrecorded Pi build and never use module-load capture as trust.
export const TRUSTED_NATIVE_FINGERPRINTS: Readonly<Record<string, string>> = Object.freeze({
	"native-assistant-message:render": "2a39243f",
	"native-compaction-message:updateDisplay": "f8c44e78",
	"native-branch-message:updateDisplay": "415d57b7",
	"native-skill-message:updateDisplay": "48099ea6",
	"native-custom-message:rebuild": "76ae2e3a",
	"tool-call-renderer:getCallRenderer": "951ea0e0",
	"tool-result-renderer:getResultRenderer": "8a25cd71",
});

export const CERTIFICATION_TABLE = Object.freeze({
	"0.83.0": Object.freeze({
		"native-assistant-message:render": Object.freeze({
			feature: "messages",
			subtype: "native-assistant-message",
			target: AssistantMessageComponent.prototype,
			method: "render",
			writable: true,
			configurable: true,
			name: "render",
			arity: 1,
			fingerprint: TRUSTED_NATIVE_FINGERPRINTS["native-assistant-message:render"],
			adapterId: "message-prefix-osc133-v1",
			status: "certified" as const,
		}),
		"tool-call-renderer:getCallRenderer": Object.freeze({
			feature: "tools",
			subtype: "tool-call-renderer",
			target: ToolExecutionComponent.prototype,
			method: "getCallRenderer",
			writable: true,
			configurable: true,
			name: "getCallRenderer",
			arity: 0,
			fingerprint: TRUSTED_NATIVE_FINGERPRINTS["tool-call-renderer:getCallRenderer"],
			adapterId: "tool-renderer-component-v1",
			status: "certified" as const,
		}),
		"tool-result-renderer:getResultRenderer": Object.freeze({
			feature: "tools",
			subtype: "tool-result-renderer",
			target: ToolExecutionComponent.prototype,
			method: "getResultRenderer",
			writable: true,
			configurable: true,
			name: "getResultRenderer",
			arity: 0,
			fingerprint: TRUSTED_NATIVE_FINGERPRINTS["tool-result-renderer:getResultRenderer"],
			adapterId: "tool-renderer-component-v1",
			status: "certified" as const,
		}),
		"native-compaction-message:updateDisplay": Object.freeze({
			feature: "messages",
			subtype: "native-compaction-message",
			target: CompactionSummaryMessageComponent.prototype,
			method: "updateDisplay",
			writable: true,
			configurable: true,
			adapterId: "message-block-boxed-v1",
			status: "certified" as const,
		}),
		"native-branch-message:updateDisplay": Object.freeze({
			feature: "messages",
			subtype: "native-branch-message",
			target: BranchSummaryMessageComponent.prototype,
			method: "updateDisplay",
			writable: true,
			configurable: true,
			adapterId: "message-block-boxed-v1",
			status: "certified" as const,
		}),
		"native-skill-message:updateDisplay": Object.freeze({
			feature: "messages",
			subtype: "native-skill-message",
			target: SkillInvocationMessageComponent.prototype,
			method: "updateDisplay",
			writable: true,
			configurable: true,
			adapterId: "message-block-boxed-v1",
			status: "certified" as const,
		}),
		"native-custom-message:rebuild": Object.freeze({
			feature: "messages",
			subtype: "native-custom-message",
			target: CustomMessageComponent.prototype,
			method: "rebuild",
			writable: true,
			configurable: true,
			adapterId: "message-block-boxed-v1",
			status: "certified" as const,
		}),
	}),
});

export interface CompatibilityDescriptorSnapshot {
	readonly kind: "data" | "accessor";
	readonly value?: unknown;
	readonly get?: unknown;
	readonly set?: unknown;
	readonly writable?: boolean;
	readonly enumerable: boolean;
	readonly configurable: boolean;
}

export interface CompatibilityRecordSnapshot {
	readonly feature: CompatibilityRecord["feature"];
	readonly subtype: CompatibilityRecord["subtype"];
	readonly method: PropertyKey;
	readonly shape: string;
	readonly piVersion: string;
	readonly versionRange: string;
	readonly generation: number;
	readonly disposed: boolean;
	readonly diagnostic: string | undefined;
}

export interface CompatibilityProbeReport {
	attemptedVersion: string;
	matchedCertifiedVersion: string | undefined;
	certificationTable: typeof CERTIFICATION_TABLE;
	piVersion: string;
	versionRange: string;
	generation: number;
	recordSnapshots: readonly CompatibilityRecordSnapshot[];
	unsupported: ReadonlyArray<{ subtype: string; method: PropertyKey; reason: string }>;
	delegationMarkers: readonly string[];
	certification: readonly {
		readonly version: string;
		readonly attemptedVersion: string;
		readonly matchedCertifiedVersion: string | undefined;
		readonly expected: unknown;
		readonly actualPreinstall: CompatibilityDescriptorSnapshot | undefined;
		readonly feature: CompatibilityRecord["feature"];
		readonly subtype: CompatibilityRecord["subtype"];
		readonly target: object;
		readonly method: string;
		readonly descriptor: CompatibilityDescriptorSnapshot | undefined;
		readonly name: string | undefined;
		readonly arity: number | undefined;
		readonly fingerprint: string | undefined;
		readonly adapterId: string | undefined;
		readonly status: "certified" | "native-fallback";
		readonly fallbackReason?: string;
	}[];
	getRuntimeDiagnostics: () => ReadonlyMap<string, number>;
	getFinalDiagnostics: () => Readonly<import("../features/tools/index.js").ToolDiagnosticArchive> | undefined;
	getActiveToolRecordCount: () => number;
	disposeOwner: () => void;
}

export interface TargetSpec {
	feature: CompatibilityRecord["feature"];
	subtype: CompatibilityRecord["subtype"];
	target: object;
	method: string;
	adapterId: string | undefined;
	status: "certified" | "native-fallback";
	fallbackReason?: string;
}

export function fingerprint(value: unknown): string | undefined {
	if (typeof value !== "function") return undefined;
	let hash = 2166136261;
	for (const character of Function.prototype.toString.call(value)) {
		hash ^= character.charCodeAt(0);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

function trustedNativeIdentity(spec: TargetSpec, piVersion: string | undefined): unknown {
	if (piVersion !== TRUSTED_PI_VERSION) return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(spec.target, spec.method);
	const value = descriptor?.value;
	const key = `${spec.subtype}:${spec.method}`;
	if (
		descriptor?.writable !== true ||
		descriptor.configurable !== true ||
		typeof value !== "function" ||
		value.name !== spec.method ||
		value.length !== (spec.method === "render" ? 1 : 0) ||
		fingerprint(value) !== TRUSTED_NATIVE_FINGERPRINTS[key]
	)
		return undefined;
	return value;
}

export const targetSpecs: readonly TargetSpec[] = [
	{
		feature: "messages",
		subtype: "native-assistant-message",
		target: AssistantMessageComponent.prototype,
		method: "render",
		adapterId: "message-prefix-osc133-v1",
		status: "certified",
	},
	{
		feature: "messages",
		subtype: "native-compaction-message",
		target: CompactionSummaryMessageComponent.prototype,
		method: "updateDisplay",
		adapterId: "message-block-boxed-v1",
		status: "certified",
	},
	{
		feature: "messages",
		subtype: "native-branch-message",
		target: BranchSummaryMessageComponent.prototype,
		method: "updateDisplay",
		adapterId: "message-block-boxed-v1",
		status: "certified",
	},
	{
		feature: "messages",
		subtype: "native-skill-message",
		target: SkillInvocationMessageComponent.prototype,
		method: "updateDisplay",
		adapterId: "message-block-boxed-v1",
		status: "certified",
	},
	{
		feature: "messages",
		subtype: "native-custom-message",
		target: CustomMessageComponent.prototype,
		method: "rebuild",
		adapterId: "message-block-boxed-v1",
		status: "certified",
	},
	{
		feature: "tools",
		subtype: "tool-call-renderer",
		target: ToolExecutionComponent.prototype,
		method: "getCallRenderer",
		adapterId: "tool-renderer-component-v1",
		status: "certified",
	},
	{
		feature: "tools",
		subtype: "tool-result-renderer",
		target: ToolExecutionComponent.prototype,
		method: "getResultRenderer",
		adapterId: "tool-renderer-component-v1",
		status: "certified",
	},
];

export interface PiVersionResolution {
	resolvePackageEntry?: (packageName: string) => string;
	readFile?: (path: string) => string;
}

export function detectPiVersion(resolution: PiVersionResolution = {}): {
	version: string | undefined;
	diagnostic?: string;
} {
	const resolvePackageEntry =
		resolution.resolvePackageEntry ??
		((name: string) => {
			try {
				return fileURLToPath(new URL(import.meta.resolve(name)));
			} catch (error) {
				throw new Error(
					`public package entry resolution failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		});
	const readFile = resolution.readFile ?? ((path: string) => readFileSync(path, "utf8"));
	try {
		const entry = resolvePackageEntry("@earendil-works/pi-coding-agent");
		let directory = dirname(entry);
		for (;;) {
			const packagePath = join(directory, "package.json");
			try {
				const packageJson = JSON.parse(readFile(packagePath)) as { name?: string; version?: string };
				if (packageJson.name === "@earendil-works/pi-coding-agent" && typeof packageJson.version === "string")
					return { version: packageJson.version };
			} catch {
				// Walk upward only; package exports may place the entry below the package root.
			}
			const parent = dirname(directory);
			if (parent === directory) break;
			directory = parent;
		}
		return { version: undefined, diagnostic: "Pi package version was not found" };
	} catch (error) {
		return {
			version: undefined,
			diagnostic: `Pi package version detection failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

function descriptorSnapshot(descriptor: PropertyDescriptor | undefined): CompatibilityDescriptorSnapshot | undefined {
	if (!descriptor) return undefined;
	return Object.freeze(
		"value" in descriptor
			? {
					kind: "data",
					value: descriptor.value,
					writable: descriptor.writable === true,
					enumerable: descriptor.enumerable === true,
					configurable: descriptor.configurable === true,
				}
			: {
					kind: "accessor",
					get: descriptor.get,
					set: descriptor.set,
					enumerable: descriptor.enumerable === true,
					configurable: descriptor.configurable === true,
				},
	);
}

function certificationRecord(
	spec: TargetSpec,
	attemptedVersion: string | undefined,
	evidence = Object.getOwnPropertyDescriptor(spec.target, spec.method),
) {
	const descriptor = evidence;
	const value = descriptor?.value;
	return {
		version: attemptedVersion ?? "unknown",
		attemptedVersion: attemptedVersion ?? "unknown",
		matchedCertifiedVersion: attemptedVersion === TRUSTED_PI_VERSION ? TRUSTED_PI_VERSION : undefined,
		expected: undefined,
		actualPreinstall: descriptorSnapshot(descriptor),
		feature: spec.feature,
		subtype: spec.subtype,
		target: spec.target,
		method: spec.method,
		descriptor: descriptorSnapshot(descriptor),
		name: typeof value === "function" ? value.name : undefined,
		arity: typeof value === "function" ? value.length : undefined,
		fingerprint: fingerprint(value),
		adapterId: spec.adapterId,
		status: spec.status,
		...(spec.fallbackReason ? { fallbackReason: spec.fallbackReason } : {}),
	};
}

function versionInRange(version: string | undefined): boolean {
	return version === TRUSTED_PI_VERSION;
}

function shape(target: object, method: string): boolean {
	const descriptor = Object.getOwnPropertyDescriptor(target, method);
	return typeof descriptor?.value === "function" && descriptor.writable === true && descriptor.configurable === true;
}

export interface CompatibilityProbeOptions {
	markers?: Set<string>;
	config?: Readonly<{
		messages: { enabled: boolean; assistantPrefix: boolean; specialBlocks: boolean };
		tools: { enabled: boolean; style: string; maxCollapsedLines: number; maxExpandedLines: number; dimOutput: boolean };
		preset: string;
	}>;
	toolSnapshot?: Readonly<{ callMarker?: string; resultMarker?: string; style?: "marker" | "compact-box" }>;
	messageSnapshot?: MessageDecorationSnapshot;
}

function isSpecialBlock(spec: TargetSpec): boolean {
	return spec.feature === "messages" && spec.status === "certified" && spec.adapterId === "message-block-boxed-v1";
}

function createFallbackRecord(
	spec: TargetSpec,
	piVersion: string | undefined,
	generation: number,
	reason: string,
): CompatibilityRecord {
	return {
		feature: spec.feature,
		subtype: spec.subtype,
		target: spec.target,
		owner: spec.target,
		method: spec.method,
		originalIdentity: Reflect.get(spec.target, spec.method),
		piVersion: piVersion ?? "unknown",
		versionRange: PI_VERSION_RANGE,
		shape: "unsupported",
		diagnostic: reason,
		generation,
		disposed: true,
		disposer: () => {},
	};
}

function probeDiagnostic(spec: TargetSpec, piVersion: string | undefined, identity: unknown): string {
	if (!versionInRange(piVersion)) return "Pi version is unknown or outside the recorded 0.83.0 support build";
	if (!shape(spec.target, spec.method)) return "target method shape is not an own writable/configurable function";
	if (identity === undefined) return "recorded 0.83.0 native fingerprint, name, or arity did not match";
	return "exact native identity verified; certified guarded decoration enabled";
}

function surfaceDisabled(spec: TargetSpec, config: CompatibilityProbeOptions["config"]): boolean {
	if (!config) return false;
	if (spec.feature === "tools") return !config.tools.enabled;
	if (!config.messages.enabled) return true;
	if (spec.subtype === "native-assistant-message") return !config.messages.assistantPrefix;
	if (isSpecialBlock(spec)) return !config.messages.specialBlocks;
	return true;
}

function probeSpec(options: {
	spec: TargetSpec;
	piVersion: string | undefined;
	generation: number;
	markers: Set<string>;
	config?: CompatibilityProbeOptions["config"];
	messageSnapshot: MessageDecorationSnapshot | undefined;
	toolOwner: ReturnType<typeof createToolDecorationOwner> | undefined;
}) {
	const { spec, piVersion, generation, markers, config, toolOwner, messageSnapshot } = options;
	const identity = trustedNativeIdentity(spec, piVersion);
	const diagnostic = probeDiagnostic(spec, piVersion, identity);
	const disabled = surfaceDisabled(spec, config);
	if (disabled) {
		const reason = "native fallback: surface disabled by normalized configuration";
		return { record: createFallbackRecord(spec, piVersion, generation, reason), reason, fallback: true };
	}
	const result = installDelegatingPatch({
		feature: spec.feature,
		subtype: spec.subtype,
		target: spec.target,
		method: spec.method,
		piVersion: piVersion ?? "unknown",
		versionRange: PI_VERSION_RANGE,
		shape: identity !== undefined && versionInRange(piVersion) && shape(spec.target, spec.method),
		generation,
		expectedIdentity: identity,
		hasExpectedIdentity: true,
		diagnostic,
		delegate: (original, target, args) => {
			markers.add(`${spec.subtype}:delegated`);
			if (spec.feature === "tools")
				return (
					toolOwner?.decorateToolRendererSelection(
						spec.subtype as "tool-call-renderer" | "tool-result-renderer",
						original,
						target,
						args,
					) ?? Reflect.apply(original as (...values: unknown[]) => unknown, target, args)
				);
			if (spec.subtype === "native-assistant-message")
				return decorateMessageRender(original, target, args, messageSnapshot);
			return renderSpecialMessageBlock(spec.subtype as SpecialBlockSubtype, original, target, args);
		},
	});
	return {
		record: result.record,
		reason: result.reason ?? result.record.diagnostic ?? "skipped",
		fallback: result.status === "skipped",
	};
}

export function probePiCompatibility(
	piVersion: string | undefined,
	options: Set<string> | CompatibilityProbeOptions = new Set(),
): CompatibilityProbeReport {
	const markers = options instanceof Set ? options : (options.markers ?? new Set<string>());
	const generation = nextGeneration();
	const toolSpecs = targetSpecs.filter((spec) => spec.feature === "tools");
	let toolOwner: ReturnType<typeof createToolDecorationOwner> | undefined;
	if (
		toolSpecs.some((spec) => trustedNativeIdentity(spec, piVersion) !== undefined) &&
		(options instanceof Set || options.config?.tools.enabled !== false)
	) {
		toolOwner = createToolDecorationOwner(options instanceof Set ? {} : options.toolSnapshot);
	}
	const evidence = Object.freeze(
		targetSpecs.map((spec) =>
			Object.freeze({
				subtype: spec.subtype,
				method: spec.method,
				target: spec.target,
				descriptor: Object.getOwnPropertyDescriptor(spec.target, spec.method),
				value: Object.getOwnPropertyDescriptor(spec.target, spec.method)?.value,
			}),
		),
	);
	const evidenceByKey = new Map(evidence.map((item) => [`${item.subtype}:${String(item.method)}`, item]));
	const records: CompatibilityRecord[] = [];
	const unsupported: Array<{ subtype: string; method: PropertyKey; reason: string }> = [];
	const certification: NonNullable<CompatibilityProbeReport["certification"]>[number][] = [];
	for (const spec of targetSpecs) {
		const captured = evidenceByKey.get(`${spec.subtype}:${String(spec.method)}`);
		const preinstallDescriptor = captured?.descriptor;
		const result = probeSpec({
			messageSnapshot: options instanceof Set ? undefined : options.messageSnapshot,
			spec,
			piVersion,
			generation,
			markers,
			config: options instanceof Set ? undefined : options.config,
			toolOwner,
		});
		records.push(result.record);
		const certificate = certificationRecord(spec, piVersion, preinstallDescriptor);
		certification.push({
			...certificate,
			attemptedVersion: piVersion ?? "unknown",
			matchedCertifiedVersion: piVersion === TRUSTED_PI_VERSION ? TRUSTED_PI_VERSION : undefined,
			expected:
				CERTIFICATION_TABLE[TRUSTED_PI_VERSION][
					`${spec.subtype}:${spec.method}` as keyof (typeof CERTIFICATION_TABLE)["0.83.0"]
				],
			actualPreinstall: descriptorSnapshot(preinstallDescriptor),
			status: result.fallback ? "native-fallback" : "certified",
			...(result.fallback ? { fallbackReason: result.reason } : {}),
		});
		if (result.fallback) unsupported.push({ subtype: spec.subtype, method: spec.method, reason: result.reason });
	}
	const report: CompatibilityProbeReport = {
		attemptedVersion: piVersion ?? "unknown",
		matchedCertifiedVersion: piVersion === TRUSTED_PI_VERSION ? TRUSTED_PI_VERSION : undefined,
		certificationTable: CERTIFICATION_TABLE,
		piVersion: piVersion ?? "unknown",
		versionRange: PI_VERSION_RANGE,
		generation: currentGeneration(),
		recordSnapshots: Object.freeze(
			records.map((record) =>
				Object.freeze({
					feature: record.feature,
					subtype: record.subtype,
					method: record.method,
					shape: record.shape,
					piVersion: record.piVersion,
					versionRange: record.versionRange,
					generation: record.generation,
					disposed: record.disposed,
					diagnostic: record.diagnostic,
				}),
			),
		),
		unsupported: Object.freeze(unsupported.map((item) => Object.freeze({ ...item }))),
		delegationMarkers: Object.freeze([...markers]),
		certification: Object.freeze(
			certification.map((item) =>
				Object.freeze({
					...item,
					actualPreinstall: item.actualPreinstall,
				}),
			),
		),
		getRuntimeDiagnostics: () => toolOwner?.getDiagnostics() ?? new Map(),
		getFinalDiagnostics: () => toolOwner?.getFinalArchive(),
		getActiveToolRecordCount: () => toolOwner?.getActiveRecordCount() ?? 0,
		disposeOwner: () => {
			toolOwner?.dispose();
		},
	};
	Object.freeze(report);
	reportStates.set(report, { records, toolOwner });
	return report;
}

export type CompatibilityCleanupResult = Readonly<{
	complete: boolean;
	retryablePrototypeRecords: number;
	retryableToolRecords: number;
	finalDiagnostics?: Readonly<import("../features/tools/index.js").ToolDiagnosticArchive>;
}>;

export function disposePiCompatibilityProbe(report: CompatibilityProbeReport): CompatibilityCleanupResult {
	const state = reportStates.get(report);
	if (!state) return { complete: true, retryablePrototypeRecords: 0, retryableToolRecords: 0 };
	for (const record of state.records) record.disposer();
	report.disposeOwner();
	const retryablePrototypeRecords = state.records.filter((record) => !record.disposed).length;
	const finalDiagnostics = report.getFinalDiagnostics();
	const retryableToolRecords = report.getActiveToolRecordCount();
	const toolOwnerWasCreated = report.recordSnapshots.some(
		(record) => record.feature === "tools" && record.shape === "installed",
	);
	return {
		complete:
			retryablePrototypeRecords === 0 &&
			retryableToolRecords === 0 &&
			(!toolOwnerWasCreated || finalDiagnostics !== undefined),
		retryablePrototypeRecords,
		retryableToolRecords,
		...(finalDiagnostics ? { finalDiagnostics } : {}),
	};
}
