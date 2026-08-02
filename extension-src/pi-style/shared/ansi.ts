function isFinal(byte: string): boolean {
	return byte >= "@" && byte <= "~";
}
export function stripAnsi(value: string): string {
	let output = "";
	for (let i = 0; i < value.length; i++) {
		if (value.charCodeAt(i) !== 27) {
			output += value[i];
			continue;
		}
		i++;
		if (value[i] === "[") {
			while (i + 1 < value.length && !isFinal(value[i + 1] ?? "")) i++;
			i++;
		} else if (value[i] === "]") {
			while (i + 1 < value.length && value.charCodeAt(i + 1) !== 7) {
				i++;
				if (value.charCodeAt(i) === 27 && value[i + 1] === "\\") {
					i++;
					break;
				}
			}
		}
	}
	return output;
}
export function visibleWidth(value: string): number {
	return [...stripAnsi(value)].length;
}
export function resetAnsi(value: string): string {
	return `${value}\x1b[0m`;
}
export function truncateAnsi(value: string, width: number, ellipsis = "…"): string {
	if (width <= 0) return "";
	if (visibleWidth(value) <= width) return resetAnsi(value);
	let output = "";
	let visible = 0;
	for (let i = 0; i < value.length && visible < width - visibleWidth(ellipsis); i++) {
		if (value.charCodeAt(i) === 27) {
			const start = i;
			i++;
			while (i + 1 < value.length && !isFinal(value[i + 1] ?? "")) i++;
			i++;
			output += value.slice(start, i + 1);
			continue;
		}
		output += value[i];
		visible++;
	}
	return resetAnsi(output + ellipsis);
}
export function wrapAnsi(value: string, width: number): string[] {
	if (width <= 0) return [""];
	const lines: string[] = [];
	let line = "";
	for (const word of value.split(/\s+/)) {
		const next = line ? `${line} ${word}` : word;
		if (visibleWidth(next) <= width) line = next;
		else {
			if (line) lines.push(resetAnsi(line));
			line = truncateAnsi(word, width);
		}
	}
	if (line || lines.length === 0) lines.push(resetAnsi(line));
	return lines;
}
