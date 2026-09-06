import { compareAscii, digest } from "../canonical";

export {
	projectOperationCodecSchema,
	projectNormalizedOperationCodecSchema,
} from "./schema";

type JsonRecord = Readonly<Record<string, unknown>>;

export type DocumentationEntry = Readonly<{
	identity: string;
	summary: string;
	description?: string;
	examples?: readonly Readonly<{ input: unknown; output?: unknown }>[];
}>;

function invalid(message: string): never {
	throw new TypeError(message);
}

function record(value: unknown): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return invalid("invalid operation projection artifact");
	return value as JsonRecord;
}

export function projectOperationDocumentationEntries(input: {
	readonly documentationBytes: string;
	readonly documentationDigest: string;
}): DocumentationEntry[] {
	const artifact = record(JSON.parse(input.documentationBytes));
	if (
		artifact.format !== "questpie.operation-documentation" ||
		artifact.version !== 1 ||
		!Array.isArray(artifact.operations) ||
		digest("questpie-operation-documentation-v1", artifact) !==
			input.documentationDigest
	)
		return invalid("operation documentation digest mismatch");
	return (artifact.operations as DocumentationEntry[]).toSorted((left, right) =>
		compareAscii(left.identity, right.identity),
	);
}

function escapeJsDoc(value: string): string {
	return value
		.replaceAll("*/", "*\\/")
		.replaceAll("\u2028", "\\u2028")
		.replaceAll("\u2029", "\\u2029");
}

function renderJsDoc(entry: DocumentationEntry): string {
	const lines = [
		entry.summary,
		...(entry.description ? ["", entry.description] : []),
	]
		.flatMap((line) => escapeJsDoc(line).split("\n"))
		.map((line) => {
			const inert = line.replace(/^(\s*)@/u, "$1\\@");
			return inert.length === 0 ? " *" : " * " + inert;
		});
	return ["/**", ...lines, " */"].join("\n");
}

export function projectOperationJsDoc(input: {
	readonly documentationBytes: string;
	readonly documentationDigest: string;
}): Readonly<Record<string, string>> {
	return Object.fromEntries(
		projectOperationDocumentationEntries(input).map((entry) => [
			entry.identity,
			renderJsDoc(entry),
		]),
	);
}
