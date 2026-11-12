import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPublicToolRenderers } from "../features/tools/public-renderers.js";

/** Optional on older Pi. Registration is once per extension/coordinator lifetime. */
export function registerPublicToolRenderers(pi: ExtensionAPI) {
	const renderers = createPublicToolRenderers();
	const register = (pi as Partial<ExtensionAPI>).registerToolRenderer;
	register?.call(pi, renderers.resolver);
	return { ...renderers, registered: typeof register === "function" };
}
