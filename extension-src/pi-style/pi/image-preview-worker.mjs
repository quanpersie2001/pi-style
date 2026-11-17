import { parentPort, workerData } from "node:worker_threads";

const HEADER_LIMIT = 64 * 1024;
const SOURCE_LIMIT = 20 * 1024 * 1024;
const PNG_LIMIT = 4 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function dimensions(widthPx, heightPx, edge = 16384) {
	return Number.isInteger(widthPx) && Number.isInteger(heightPx) && widthPx > 0 && heightPx > 0 &&
		widthPx <= edge && heightPx <= edge && widthPx * heightPx <= 24_000_000
		? { widthPx, heightPx } : undefined;
}

function decode(data, limit) {
	if (typeof data !== "string" || !data.length || data.length > limit || data.length % 4 ||
		!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return undefined;
	const bytes = Buffer.from(data, "base64");
	return bytes.toString("base64") === data ? bytes : undefined;
}

function pngDimensions(bytes, edge = 16384) {
	if (bytes.length < 45 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
		bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") return undefined;
	const size = dimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20), edge);
	if (!size) return undefined;
	let sawData = false;
	for (let offset = 8; offset + 12 <= bytes.length;) {
		const length = bytes.readUInt32BE(offset);
		const end = offset + length + 12;
		if (end > bytes.length) return undefined;
		const type = bytes.toString("ascii", offset + 4, offset + 8);
		if (type === "acTL" || type === "fcTL" || type === "fdAT") return undefined;
		if (type === "IDAT") {
			if (!sawData && offset + 8 > HEADER_LIMIT) return undefined;
			sawData = true;
		}
		if (type === "IEND") return sawData && length === 0 && end === bytes.length ? size : undefined;
		if (!sawData && end > HEADER_LIMIT) return undefined;
		offset = end;
	}
	return undefined;
}

function jpegDimensions(bytes) {
	if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) return undefined;
	const end = Math.min(bytes.length, HEADER_LIMIT);
	let size;
	for (let offset = 2; offset + 4 <= end;) {
		if (bytes[offset++] !== 0xff) return undefined;
		while (offset < end && bytes[offset] === 0xff) offset++;
		const marker = bytes[offset++];
		if (marker === 0xda) return size;
		const length = bytes.readUInt16BE(offset);
		if (length < 2 || offset + length > end) return undefined;
		// Baseline/extended/progressive still JPEG only; reject unusual coding modes.
		if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
			if (length < 8 || size) return undefined;
			size = dimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
			if (!size) return undefined;
		}
		offset += length;
	}
	return undefined;
}

function webpDimensions(bytes) {
	if (bytes.length < 30 || bytes.toString("ascii", 0, 4) !== "RIFF" ||
		bytes.toString("ascii", 8, 12) !== "WEBP" || bytes.readUInt32LE(4) + 8 !== bytes.length) return undefined;
	let declared;
	let image;
	for (let offset = 12; offset + 8 <= bytes.length;) {
		const type = bytes.toString("ascii", offset, offset + 4);
		const length = bytes.readUInt32LE(offset + 4);
		const start = offset + 8;
		const end = start + length + (length & 1);
		if (end > bytes.length || type === "ANIM" || type === "ANMF") return undefined;
		if (type === "VP8X") {
			if (length !== 10 || declared || bytes[start] & 2) return undefined;
			declared = dimensions(bytes.readUIntLE(start + 4, 3) + 1, bytes.readUIntLE(start + 7, 3) + 1);
			if (!declared) return undefined;
		} else if (type === "VP8 " || type === "VP8L") {
			if (image || start + 10 > HEADER_LIMIT) return undefined;
			if (type === "VP8 " && length >= 10 && bytes.subarray(start + 3, start + 6).equals(Buffer.from([157, 1, 42]))) {
				image = dimensions(bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff);
			} else if (type === "VP8L" && length >= 5 && bytes[start] === 0x2f) {
				const bits = bytes.readUInt32LE(start + 1);
				image = dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
			}
			if (!image) return undefined;
		}
		if (!image && end > HEADER_LIMIT) return undefined;
		offset = end;
		if (offset === bytes.length) {
			return image && (!declared || (image.widthPx === declared.widthPx && image.heightPx === declared.heightPx)) ? image : undefined;
		}
	}
	return undefined;
}

async function prepare() {
	const { source, moduleUrl } = workerData;
	if (!source || !["image/png", "image/jpeg", "image/webp"].includes(source.mimeType)) return undefined;
	const bytes = decode(source.data, Math.ceil(SOURCE_LIMIT / 3) * 4);
	if (!bytes || bytes.length > SOURCE_LIMIT) return undefined;
	const originalDimensions = source.mimeType === "image/png" ? pngDimensions(bytes)
		: source.mimeType === "image/jpeg" ? jpegDimensions(bytes) : webpDimensions(bytes);
	if (!originalDimensions) return undefined;
	// Public import-condition root only. Any host synchronous fallback stays in this worker.
	const api = await import(moduleUrl);
	if (typeof api.resizeImage !== "function" || typeof api.convertToPng !== "function") return undefined;
	const resized = await api.resizeImage(bytes, source.mimeType, { maxWidth: 960, maxHeight: 960, maxBytes: 512 * 1024 });
	if (!resized) return undefined;
	const normalized = await api.convertToPng(resized.data, resized.mimeType);
	if (!normalized || normalized.mimeType !== "image/png") return undefined;
	const png = decode(normalized.data, PNG_LIMIT);
	const size = png && pngDimensions(png, 960);
	return size ? { data: normalized.data, mimeType: "image/png", dimensions: size, originalDimensions } : undefined;
}

try {
	parentPort?.postMessage(await prepare());
} catch {
	parentPort?.postMessage(undefined);
}
