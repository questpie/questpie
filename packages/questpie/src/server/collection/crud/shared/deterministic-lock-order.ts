import { Buffer } from "node:buffer";

const compareUtf8 = (left: string, right: string) =>
	Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));

export const lockValueParts = (value: unknown): readonly string[] => [
	typeof value,
	String(value),
];

export function compareLockParts(
	left: readonly string[],
	right: readonly string[],
): number {
	const length = Math.max(left.length, right.length);
	for (let index = 0; index < length; index += 1) {
		const comparison = compareUtf8(left[index] ?? "", right[index] ?? "");
		if (comparison !== 0) return comparison;
	}
	return 0;
}

export const lockPartsKey = (parts: readonly string[]): string =>
	parts.map((part) => `${Buffer.byteLength(part, "utf8")}:${part}`).join("");
