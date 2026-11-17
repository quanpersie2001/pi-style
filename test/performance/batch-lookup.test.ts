import { afterEach, describe, expect, it } from "vitest";
import {
	closeActiveBatch,
	hasFinalBatchOutput,
	registerBatchCall,
	registerBatchResult,
	resetBatchRegistry,
} from "../../extension-src/pi-style/features/tools/boxed/batch.js";
import type { BoxedToolContext } from "../../extension-src/pi-style/features/tools/boxed/shared.js";

const meta = { toolName: "find", label: "Find" };
const final = { isPartial: false, isError: false, errorText: undefined, entries: ["file.ts"] };
function context(toolCallId: string): BoxedToolContext {
	return {
		toolCallId,
		args: {},
		state: {},
		invalidate() {},
		cwd: "/fake",
		executionStarted: true,
		argsComplete: true,
		isPartial: false,
		expanded: false,
		showImages: false,
		isError: false,
	};
}

afterEach(resetBatchRegistry);

describe("indexed batch member lookup", () => {
	it("does not scan member IDs on warm calls, results or final-output checks", () => {
		const contexts = Array.from({ length: 1000 }, (_, i) => context(`find-${i}`));
		const first = contexts[0] as BoxedToolContext;
		const { batch } = registerBatchCall(meta, "/fake", first);
		for (const ctx of contexts.slice(1)) registerBatchCall(meta, "/fake", ctx);
		for (const ctx of contexts) registerBatchResult(meta, final, ctx);
		closeActiveBatch();
		let idReads = 0;
		for (const member of batch.members) {
			const id = member.toolCallId;
			Object.defineProperty(member, "toolCallId", {
				get() {
					idReads++;
					return id;
				},
			});
		}
		const revision = batch.revision;
		for (const ctx of contexts) {
			expect(registerBatchCall(meta, "/fake", ctx).batch).toBe(batch);
			expect(registerBatchResult(meta, final, ctx).batch).toBe(batch);
			expect(hasFinalBatchOutput(ctx.toolCallId)).toBe(true);
		}
		expect(batch.revision).toBe(revision);
		expect(idReads).toBe(0);
		resetBatchRegistry();
		expect(hasFinalBatchOutput(first.toolCallId)).toBe(false);
		expect(registerBatchResult(meta, final, first).batch).toBeUndefined();
		expect(registerBatchCall(meta, "/fake", first).batch).not.toBe(batch);
	});
});
