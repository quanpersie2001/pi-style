import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker, type WorkerOptions } from "node:worker_threads";
import type { PreparedPreviewImage, PreviewImageProcessor } from "../features/messages/image-preview-types.js";

/** Injection seams keep unavailable loaders/workers testable without global patches. */
export interface PreviewImageProcessorOptions {
	resolveModuleUrl?: () => string | Promise<string>;
	hostPackageDir?: () => string | undefined | Promise<string | undefined>;
	workerUrl?: URL;
	createWorker?: (url: URL, options: WorkerOptions) => Worker;
	timeoutMs?: number;
}

function importEntry(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	for (const [condition, entry] of Object.entries(value)) {
		if (["node", "import", "default"].includes(condition)) {
			const selected = importEntry(entry);
			if (selected) return selected;
		}
	}
	return undefined;
}

async function resolvePublicRoot(options: PreviewImageProcessorOptions): Promise<string> {
	let directory: string | undefined;
	if (options.hostPackageDir) directory = await options.hostPackageDir();
	else {
		try {
			const api = await import("@earendil-works/pi-coding-agent");
			if (typeof api.getPackageDir === "function") directory = api.getPackageDir();
		} catch {
			// Alias-only and compiled runtimes may not expose a Node-loadable root.
		}
	}
	if (directory) {
		const manifest = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
		const entry =
			manifest.exports === undefined ? manifest.main : importEntry(manifest.exports["."] ?? manifest.exports);
		if (typeof entry !== "string" || !entry.startsWith("./")) throw new Error("No public import entry");
		const target = resolve(directory, entry);
		const inside = relative(directory, target);
		if (inside.startsWith("..") || isAbsolute(inside)) throw new Error("Invalid public import entry");
		return pathToFileURL(target).href;
	}
	return import.meta.resolve("@earendil-works/pi-coding-agent");
}

export function createPreviewImageProcessor(options: PreviewImageProcessorOptions = {}): PreviewImageProcessor {
	let busy = false;
	return async (source, signal) => {
		if (busy || signal.aborted) return undefined;
		busy = true;
		const deadline = Date.now() + (options.timeoutMs ?? 10_000);
		try {
			// Resolution can stall in a loader; abandon its result without ever launching a worker.
			const moduleUrl = await new Promise<string | undefined>((resolve, reject) => {
				const cleanup = () => {
					clearTimeout(timer);
					signal.removeEventListener("abort", abort);
				};
				const abort = () => {
					cleanup();
					resolve(undefined);
				};
				const timer = setTimeout(abort, Math.max(0, deadline - Date.now()));
				signal.addEventListener("abort", abort, { once: true });
				// Only executed on demand, never during factory construction or rendering.
				void Promise.resolve()
					.then(() => (options.resolveModuleUrl ? options.resolveModuleUrl() : resolvePublicRoot(options)))
					.then(
						(url) => {
							cleanup();
							resolve(url);
						},
						(error) => {
							cleanup();
							reject(error);
						},
					);
				if (signal.aborted) abort();
			});
			if (!moduleUrl || signal.aborted || Date.now() >= deadline) return undefined;
			const worker = (options.createWorker ?? ((url, settings) => new Worker(url, settings)))(
				// Source manifest ships this sibling; bundled dist needs an explicit asset copy.
				options.workerUrl ?? new URL("./image-preview-worker.mjs", import.meta.url),
				{ workerData: { moduleUrl, source } },
			);
			return await new Promise<PreparedPreviewImage | undefined>((resolve) => {
				let settling = false;
				const finish = (value: Parameters<typeof resolve>[0] = undefined) => {
					if (settling) return;
					settling = true;
					clearTimeout(timer);
					signal.removeEventListener("abort", abort);
					// An exit is the fallback barrier if termination itself rejects.
					const exited = new Promise<void>((done) => {
						if (worker.threadId === -1) done();
						else worker.once("exit", () => done());
					});
					void worker
						.terminate()
						.catch(() => exited)
						.then(() => resolve(signal.aborted ? undefined : value));
				};
				const abort = () => finish();
				const timer = setTimeout(abort, Math.max(0, deadline - Date.now()));
				worker.once("message", finish);
				worker.once("messageerror", abort);
				worker.once("error", abort);
				worker.once("exit", abort);
				signal.addEventListener("abort", abort, { once: true });
				if (signal.aborted) abort();
			});
		} catch {
			return undefined;
		} finally {
			busy = false;
		}
	};
}
