import type { StatusSnapshot } from "../domain/status.js";

export interface UiSnapshot extends StatusSnapshot {
	readonly revision: number;
	readonly generation: number;
}

export function createSnapshot(generation: number, revision = 0, values: StatusSnapshot = {}): UiSnapshot {
	return Object.freeze({ ...values, generation, revision });
}

export function replaceSnapshot(current: UiSnapshot, generation: number, values: StatusSnapshot): UiSnapshot {
	if (current.generation !== generation) return current;
	return equalStatusSnapshot(current, values) ? current : createSnapshot(generation, current.revision + 1, values);
}

function equalStatusSnapshot(current: StatusSnapshot, next: StatusSnapshot): boolean {
	const currentEntries = Object.entries(current).filter(([key]) => key !== "generation" && key !== "revision");
	const nextEntries = Object.entries(next).filter(([key]) => key !== "generation" && key !== "revision");
	if (currentEntries.length !== nextEntries.length) return false;
	for (const [key, value] of nextEntries) {
		if (!hasOwn(current, key)) return false;
		if (!equalValue((current as Record<string, unknown>)[key], value)) return false;
	}
	return true;
}

function equalValue(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (Array.isArray(left) && Array.isArray(right)) {
		if (left.length !== right.length) return false;
		for (let index = 0; index < left.length; index++) {
			if (!equalValue(left[index], right[index])) return false;
		}
		return true;
	}
	if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	if (leftKeys.length !== rightKeys.length) return false;
	for (const key of rightKeys) {
		if (!hasOwn(left, key)) return false;
		if (!equalValue(left[key], right[key])) return false;
	}
	return true;
}

function hasOwn(value: object, key: string): boolean {
	return Object.hasOwn(value, key);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
