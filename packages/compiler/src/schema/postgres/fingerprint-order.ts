import { canonicalBytes, compareAscii } from "../../canonical";

type JsonRecord = Readonly<Record<string, unknown>>;

export function compareFingerprintObjects(
	left: JsonRecord,
	right: JsonRecord,
): number {
	return (
		compareText(left.kind, right.kind) ||
		compareText(left.table, right.table) ||
		compareText(left.name, right.name) ||
		compareText(left.qualifiedIdentity, right.qualifiedIdentity) ||
		compareNullableText(left.attachedTo, right.attachedTo) ||
		compareAscii(canonicalBytes(left), canonicalBytes(right))
	);
}

export function compareFingerprintDependencies(
	left: JsonRecord,
	right: JsonRecord,
): number {
	return (
		compareText(left.kind, right.kind) ||
		compareText(left.schema, right.schema) ||
		compareText(left.name, right.name) ||
		compareNullableText(left.extension, right.extension) ||
		compareAscii(canonicalBytes(left), canonicalBytes(right))
	);
}

function compareText(left: unknown, right: unknown): number {
	return compareAscii(String(left ?? ""), String(right ?? ""));
}

function compareNullableText(left: unknown, right: unknown): number {
	if (left === null && right !== null) return -1;
	if (left !== null && right === null) return 1;
	return compareText(left, right);
}
