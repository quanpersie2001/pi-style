// Tier C compaction-transcript preservation.
//
// Native `compaction_end` handling inside `InteractiveMode.handleEvent`
// clears the chat container and re-renders only the entries that survived the
// compaction cut, so the visible transcript mirrors the model context and
// everything before the cut disappears. This delegate preserves the live
// transcript instead: it swaps `chatContainer` for a detached sink for the
// duration of the native handler — every side effect (terminal progress,
// escape-handler restore, status indicator, queued-message flush, footer
// invalidation, error paths) still executes exactly once through the native
// code — then restores the original container and appends the compaction
// summary block through the same native `addMessageToChat` routing the
// untouched handler would have used (Spacer + CompactionSummaryMessageComponent
// + `setExpanded` sync), so the boxed special-block surface applies to it.
//
// Async timing: `handleEvent` is async and can suspend on `await this.init()`
// BEFORE the event switch (verified 0.85.0 and 0.99.1; the compaction case
// itself is synchronous — the queued-message flush is fired with `void`).
// The container is therefore restored on handler COMPLETION, not on call
// return: when the native call returns an unsettled promise, restoration and
// the summary append wait for that promise, so a suspended handler still
// clears the sink rather than the real chat. Pi processes events through
// `await this.handleEvent(event)` sequentially, so no other event rendering
// can interleave while the sink is installed.
//
// Scope and limits:
// - Only completed live compactions (`compaction_end` carrying a result, not
//   aborted) are intercepted; every other event passes through untouched.
// - The replay/restore path (session resume, tree navigation — the
//   `entry.type === "compaction"` case in the same handler) is NOT
//   intercepted: rebuilt transcripts render the compacted view, matching what
//   the session file retains. Preservation is for the live session view.
// - Rendering-only: session data, context, and compaction semantics are
//   untouched. Fails closed to the native clear-and-rerender whenever the
//   instance shape (`chatContainer` field + `addMessageToChat`) is missing.
// - The sink re-render registers discarded components in pi-style's
//   process-scoped tool/thought registries (same as any native rebuild
//   window); idempotent per toolCallId/message identity, and the retained
//   real components keep rendering from the same registry state.
// - `handleEvent` hosts the whole event switch, so its fingerprint drifts on
//   nearly every Pi release; the delegate is event-type-gated and passes
//   everything else through, keeping behavior risk low between re-records.

import { Container } from "@earendil-works/pi-tui";

interface CompactionResultShape {
	readonly summary?: unknown;
	readonly tokensBefore?: unknown;
	readonly usage?: unknown;
}

interface CompactionEventShape {
	readonly type?: unknown;
	readonly aborted?: unknown;
	readonly result?: CompactionResultShape;
}

interface InteractiveModeLike {
	chatContainer?: unknown;
	addMessageToChat?(message: unknown): unknown;
	addCompactionCostNotice?(notice: unknown): unknown;
	footer?: { invalidate?(): void };
	ui?: { requestRender?(): void };
}

type NativeHandler = (this: object, ...args: unknown[]) => unknown;

function isThenable(value: unknown): value is Promise<unknown> {
	return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

/**
 * Delegating decoration for `InteractiveMode.prototype.handleEvent`. Installs
 * only through the compatibility probe's certified patch pipeline; restores
 * the original method on dispose.
 */
export function decorateCompactionTranscript(original: unknown, instance: object, args: unknown[]): unknown {
	const applyOriginal = () => Reflect.apply(original as NativeHandler, instance, args);
	const event = args[0] as CompactionEventShape | undefined;
	if (
		event?.type !== "compaction_end" ||
		event.aborted === true ||
		!event.result ||
		typeof event.result.summary !== "string" ||
		typeof event.result.tokensBefore !== "number"
	) {
		return applyOriginal();
	}
	const target = instance as InteractiveModeLike;
	const chat = target.chatContainer;
	if (!chat || typeof target.addMessageToChat !== "function") {
		// Fail closed: the native clear-and-rerender is the documented fallback.
		return applyOriginal();
	}
	// Divert every chat mutation the native handler performs into a detached
	// sink for the WHOLE handler execution (see the async-timing note above).
	const sink = new Container();
	target.chatContainer = sink;
	const restore = () => {
		target.chatContainer = chat;
	};
	const appendSummary = () => {
		// Append the summary into the preserved transcript through native routing
		// (Spacer + component + expanded-state sync live in addMessageToChat).
		target.addMessageToChat?.({
			role: "compactionSummary",
			summary: event.result?.summary,
			tokensBefore: event.result?.tokensBefore,
			timestamp: new Date().toISOString(),
		});
		const usage = event.result?.usage;
		if (usage !== undefined && usage !== null && typeof target.addCompactionCostNotice === "function") {
			target.addCompactionCostNotice({ type: "compaction_cost", kind: "compaction", usage });
		}
		target.footer?.invalidate?.();
		target.ui?.requestRender?.();
	};
	let result: unknown;
	try {
		result = applyOriginal();
	} catch (error) {
		restore();
		throw error;
	}
	if (isThenable(result)) {
		return result.then(
			(value) => {
				restore();
				appendSummary();
				return value;
			},
			(error: unknown) => {
				restore();
				throw error;
			},
		);
	}
	restore();
	appendSummary();
	return result;
}
