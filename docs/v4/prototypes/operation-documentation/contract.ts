import {
	canonicalBytes,
	digest,
	hasLoneUnicodeSurrogate,
} from "../../../../packages/compiler/src/canonical";
import type { RuntimeCodec } from "../../../../packages/runtime/src/codec";
import {
	decodeRuntimeCodec,
	encodeRuntimeCodec,
} from "../../../../packages/runtime/src/codec";

const DOMAIN = "questpie-operation-documentation-v1";
const bidiControl = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

type RecordValue = Readonly<Record<string, unknown>>;

export type DocumentationOrigin = Readonly<{
	module: string;
	line: number;
	column: number;
}>;

export class DocumentationDiagnostic extends TypeError {
	readonly code = "QP-COMPOSE-030";
	constructor(
		readonly reason:
			| "exampleCodecMismatch"
			| "exampleLimitExceeded"
			| "invalidText"
			| "missingExampleInput"
			| "missingSummary"
			| "runtimeMintedExample"
			| "unexpectedOperationMember",
		readonly origin: DocumentationOrigin,
		readonly path: readonly string[],
	) {
		super(`${reason} at ${origin.module}:${origin.line}:${origin.column}`);
		this.name = "DocumentationDiagnostic";
	}
}

export interface OperationDescription<Input, Output> {
	readonly summary: string;
	readonly description?: string;
	readonly examples?: readonly Readonly<{ input: Input; output?: Output }>[];
}

export type OperationDocumentationSource = Readonly<{
	identity: `query:${string}` | `mutation:${string}` | `action:${string}`;
	kind: "query" | "mutation" | "action";
	input: RuntimeCodec;
	output: RuntimeCodec;
	describe?: Readonly<{
		summary: string;
		description?: string;
		examples?: readonly Readonly<{ input: unknown; output?: unknown }>[];
	}>;
	origin: DocumentationOrigin;
}>;

export type OperationDocumentationArtifactV1 = Readonly<{
	format: "questpie.operation-documentation";
	version: 1;
	operations: readonly Readonly<{
		identity: string;
		summary: string;
		description?: string;
		examples?: readonly Readonly<{ input: unknown; output?: unknown }>[];
	}>[];
}>;

function record(value: unknown): RecordValue | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as RecordValue)
		: null;
}

function hasForbiddenControl(value: string, allowLineFeed: boolean): boolean {
	for (const character of value) {
		const point = character.codePointAt(0)!;
		if (point <= 0x1f && !(allowLineFeed && point === 0x0a)) return true;
		if (point >= 0x7f && point <= 0x9f) return true;
	}
	return false;
}

export function assertClosedOperationMembers(
	kind: OperationDocumentationSource["kind"],
	value: RecordValue,
	origin: DocumentationOrigin,
): void {
	const common = ["describe", "handler", "input", "name", "network", "output"];
	const allowed = new Set(
		kind === "mutation"
			? [...common, "errors", "issueMappings", "policy"]
			: kind === "action"
				? [...common, "errors", "limits", "policy"]
				: [...common, "query"],
	);
	const member = Object.keys(value)
		.sort()
		.find((key) => !allowed.has(key));
	if (member)
		throw new DocumentationDiagnostic("unexpectedOperationMember", origin, [
			`${kind}:${String(value.name ?? "<unknown>")}`,
			member,
		]);
}

function text(
	value: unknown,
	mode: "summary" | "description",
	origin: DocumentationOrigin,
): string {
	if (typeof value !== "string" || value.length === 0)
		throw new DocumentationDiagnostic(
			mode === "summary" ? "missingSummary" : "invalidText",
			origin,
			["describe", mode],
		);
	const scalars = [...value].length;
	const valid =
		value === value.normalize("NFC") &&
		value.trim() === value &&
		!hasLoneUnicodeSurrogate(value) &&
		!bidiControl.test(value) &&
		!hasForbiddenControl(value, mode === "description") &&
		(mode === "description" || !value.includes("\n")) &&
		(mode === "description" ||
			(!value.includes("\u2028") && !value.includes("\u2029"))) &&
		scalars <= (mode === "summary" ? 120 : 1024);
	if (!valid)
		throw new DocumentationDiagnostic("invalidText", origin, [
			"describe",
			mode,
		]);
	return value;
}

function canonicalExample(
	codec: RuntimeCodec,
	value: unknown,
	origin: DocumentationOrigin,
	path: readonly string[],
): unknown {
	if (hasRuntimeMintedValue(codec, value))
		throw new DocumentationDiagnostic("runtimeMintedExample", origin, path);
	try {
		const decoded = decodeRuntimeCodec(codec, value);
		return encodeRuntimeCodec(codec, decoded);
	} catch {
		throw new DocumentationDiagnostic("exampleCodecMismatch", origin, path);
	}
}

function hasRuntimeMintedValue(codec: RuntimeCodec, value: unknown): boolean {
	if (codec.kind === "cursor") return value !== null && value !== undefined;
	if (codec.kind === "nullable")
		return value === null ? false : hasRuntimeMintedValue(codec.codec, value);
	if (codec.kind === "optional")
		return value === undefined
			? false
			: hasRuntimeMintedValue(codec.codec, value);
	if (codec.kind === "array")
		return (
			Array.isArray(value) &&
			value.some((item) => hasRuntimeMintedValue(codec.items, item))
		);
	if (codec.kind !== "object") return false;
	const input = record(value);
	if (!input) return false;
	return Object.entries(codec.properties).some(
		([key, child]) =>
			Object.hasOwn(input, key) && hasRuntimeMintedValue(child, input[key]),
	);
}

export function compileOperationDocumentation(
	sources: readonly OperationDocumentationSource[],
): Readonly<{
	artifact: OperationDocumentationArtifactV1;
	bytes: string;
	digest: string;
}> {
	const operations = sources
		.filter((source) => source.describe !== undefined)
		.sort((left, right) =>
			left.identity < right.identity
				? -1
				: left.identity > right.identity
					? 1
					: 0,
		)
		.map((source) => {
			const describe = record(source.describe);
			if (!describe)
				throw new DocumentationDiagnostic("missingSummary", source.origin, [
					"describe",
				]);
			const unknown = Object.keys(describe)
				.sort()
				.find((key) => !["description", "examples", "summary"].includes(key));
			if (unknown)
				throw new DocumentationDiagnostic(
					"unexpectedOperationMember",
					source.origin,
					["describe", unknown],
				);
			const summary = text(describe.summary, "summary", source.origin);
			const description =
				describe.description === undefined
					? undefined
					: text(describe.description, "description", source.origin);
			const rawExamples = describe.examples;
			if (rawExamples !== undefined && !Array.isArray(rawExamples))
				throw new DocumentationDiagnostic(
					"exampleCodecMismatch",
					source.origin,
					["describe", "examples"],
				);
			const examples = rawExamples?.map((raw, index) => {
				const example = record(raw);
				if (!example || !Object.hasOwn(example, "input"))
					throw new DocumentationDiagnostic(
						"missingExampleInput",
						source.origin,
						["describe", "examples", String(index)],
					);
				const unexpected = Object.keys(example)
					.sort()
					.find((key) => key !== "input" && key !== "output");
				if (unexpected)
					throw new DocumentationDiagnostic(
						"exampleCodecMismatch",
						source.origin,
						["describe", "examples", String(index), unexpected],
					);
				return {
					input: canonicalExample(source.input, example.input, source.origin, [
						"describe",
						"examples",
						String(index),
						"input",
					]),
					...(Object.hasOwn(example, "output")
						? {
								output: canonicalExample(
									source.output,
									example.output,
									source.origin,
									["describe", "examples", String(index), "output"],
								),
							}
						: {}),
				};
			});
			if (
				examples &&
				new TextEncoder().encode(canonicalBytes(examples)).length > 4096
			)
				throw new DocumentationDiagnostic(
					"exampleLimitExceeded",
					source.origin,
					["describe", "examples"],
				);
			return {
				identity: source.identity,
				summary,
				...(description === undefined ? {} : { description }),
				...(examples === undefined ? {} : { examples }),
			};
		});
	const artifact: OperationDocumentationArtifactV1 = {
		format: "questpie.operation-documentation",
		version: 1,
		operations,
	};
	return {
		artifact,
		bytes: canonicalBytes(artifact),
		digest: digest(DOMAIN, artifact),
	};
}
