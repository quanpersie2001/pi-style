import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPublicToolRenderers, detachedToolRenderers } from "../features/tools/public-renderers.js";

/** Optional on older Pi. Registration is once per extension/coordinator lifetime. */
export function registerPublicToolRenderers(pi: ExtensionAPI) {
	const renderers = createPublicToolRenderers();
	const register = (pi as Partial<ExtensionAPI>).registerToolRenderer;
	register?.call(pi, renderers.resolver);
	// Optional versioned display port, not a tool registration API. A fresh
	// revision tells detached consumers to discard only their renderer caches.
	const key = Symbol.for("pi-style.detached-tool-renderers.v1");
	// Keep ownership across a session gap, even while the public port is absent.
	const ownerKey = Symbol.for("pi-style.detached-tool-renderers.owner.v1");
	const host = globalThis as unknown as Record<symbol, unknown>;
	let enabled = false;
	const port = {
		revision: {},
		resolve(name: string) {
			return enabled && host[ownerKey] === port ? detachedToolRenderers(name) : undefined;
		},
	};
	host[ownerKey] = port;
	host[key] = port;
	return {
		...renderers,
		registered: typeof register === "function",
		configure(active: boolean) {
			if (host[ownerKey] !== port) return;
			if (active) host[key] = port;
			renderers.configure(active);
			enabled = active;
			port.revision = {};
		},
		clear() {
			if (host[ownerKey] !== port) return;
			renderers.clear();
			enabled = false;
			port.revision = {};
			if (host[key] === port) delete host[key];
		},
	};
}
