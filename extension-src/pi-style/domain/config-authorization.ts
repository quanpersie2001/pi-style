import type { NormalizedPiStyleConfig } from "./config-types.js";

export interface TierCAuthorizationInput {
	readonly certifiedHost: boolean;
	readonly coreFlag: boolean;
	readonly surfaceFlag: boolean;
	readonly surface: "messages" | "tools" | "userMessage" | "assistantMessage" | "specialBlocks";
	readonly config: NormalizedPiStyleConfig;
}

/** Persisted and ordinary command state is intentionally not an input: authorization is session-bound. */
export function isTierCAuthorized(input: TierCAuthorizationInput): boolean {
	if (!input.certifiedHost || !input.coreFlag || !input.surfaceFlag || !input.config.enabled) return false;
	if (input.surface === "tools") return input.config.tools.enabled;
	if (input.surface === "userMessage") return input.config.messages.enabled && input.config.messages.userPrefix;
	if (input.surface === "assistantMessage")
		return input.config.messages.enabled && input.config.messages.assistantPrefix;
	if (input.surface === "specialBlocks") return input.config.messages.enabled && input.config.messages.specialBlocks;
	return input.config.messages.enabled;
}
