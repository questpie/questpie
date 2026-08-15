import { createHash } from "node:crypto";

function compareAscii(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function arrayIndex(key: string): number | null {
	if (!/^(?:0|[1-9][0-9]*)$/.test(key)) return null;
	const value = Number(key);
	return Number.isInteger(value) && value <= 4_294_967_294 ? value : null;
}

function compareCanonicalObjectKeys(left: string, right: string): number {
	const leftIndex = arrayIndex(left);
	const rightIndex = arrayIndex(right);
	if (leftIndex !== null && rightIndex !== null) return leftIndex - rightIndex;
	if (leftIndex !== null) return -1;
	if (rightIndex !== null) return 1;
	return compareAscii(left, right);
}

type CanonicalFrame =
	| Readonly<{ key: string; kind: "entry"; value: unknown }>
	| Readonly<{ kind: "leave"; value: object }>
	| Readonly<{ kind: "text"; value: string }>
	| Readonly<{ kind: "value"; value: unknown }>;

export function canonicalBytes(value: unknown): string {
	const active = new Set<object>();
	const output: string[] = [];
	const stack: CanonicalFrame[] = [{ kind: "value", value }];
	while (stack.length > 0) {
		const frame = stack.pop();
		if (!frame) break;
		if (frame.kind === "text") {
			output.push(frame.value);
			continue;
		}
		if (frame.kind === "leave") {
			active.delete(frame.value);
			continue;
		}
		if (frame.kind === "entry") {
			if (frame.value === undefined)
				throw new TypeError(`canonical JSON rejects undefined at ${frame.key}`);
			output.push(`${JSON.stringify(frame.key)}:`);
			stack.push({ kind: "value", value: frame.value });
			continue;
		}
		const item = frame.value;
		if (
			item === null ||
			typeof item === "string" ||
			typeof item === "boolean"
		) {
			output.push(JSON.stringify(item));
			continue;
		}
		if (typeof item === "number") {
			if (!Number.isFinite(item) || Object.is(item, -0))
				throw new TypeError("canonical JSON rejects non-finite numbers and -0");
			output.push(JSON.stringify(item));
			continue;
		}
		if (typeof item !== "object")
			throw new TypeError(`canonical JSON rejects ${typeof item}`);
		if (active.has(item)) throw new TypeError("canonical JSON rejects cycles");
		active.add(item);
		stack.push({ kind: "leave", value: item });
		if (Array.isArray(item)) {
			stack.push({ kind: "text", value: "]" });
			for (let index = item.length - 1; index >= 0; index -= 1) {
				stack.push({
					kind: "value",
					value: index in item ? item[index] : null,
				});
				if (index > 0) stack.push({ kind: "text", value: "," });
			}
			stack.push({ kind: "text", value: "[" });
			continue;
		}
		const entries = Object.entries(item).sort(([left], [right]) =>
			compareCanonicalObjectKeys(left, right),
		);
		stack.push({ kind: "text", value: "}" });
		for (let index = entries.length - 1; index >= 0; index -= 1) {
			const entry = entries[index];
			if (!entry) continue;
			stack.push({ kind: "entry", key: entry[0], value: entry[1] });
			if (index > 0) stack.push({ kind: "text", value: "," });
		}
		stack.push({ kind: "text", value: "{" });
	}
	return `${output.join("")}\n`;
}

export function digest(domain: string, value: unknown): string {
	return createHash("sha256")
		.update(`${domain}\0`)
		.update(canonicalBytes(value))
		.digest("hex");
}

export function contentDigest(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

export { compareAscii };
