export interface UiSnapshot {
	readonly revision: number;
	readonly generation: number;
	readonly model?: string;
	readonly thinkingLevel?: string;
	readonly contextPercent?: number;
}

export function createSnapshot(
	generation: number,
	revision = 0,
	values: Omit<UiSnapshot, "generation" | "revision"> = {},
): UiSnapshot {
	return Object.freeze({ generation, revision, ...values });
}

export function replaceSnapshot(
	current: UiSnapshot,
	generation: number,
	values: Omit<UiSnapshot, "generation" | "revision">,
): UiSnapshot {
	if (current.generation !== generation) return current;
	return createSnapshot(generation, current.revision + 1, values);
}
