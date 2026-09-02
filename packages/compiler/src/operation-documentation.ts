import {
	decodeRuntimeCodec,
	encodeRuntimeCodec,
	type RuntimeCodec,
} from "@questpie/runtime/codec";

import {
	canonicalBytes,
	compareAscii,
	digest,
	hasLoneUnicodeSurrogate,
} from "./canonical";
import { CompilerDiagnosticError } from "./diagnostic";
import {
	projectCollectionOperationCodecs,
	type CollectionOperationProgramsV1,
} from "./mutation";
import type { EvaluatedExport, NormalizedResource, SourceSpan } from "./types";

const documentationDigestDomain = "questpie-operation-documentation-v1";
const bidiControl = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

type RecordValue = Readonly<Record<string, unknown>>;

export type OperationDocumentationMemberKind =
	| "query"
	| "mutation"
	| "action"
	| "collectionList"
	| "collectionGet"
	| "collectionCreate"
	| "collectionUpdate"
	| "collectionDelete";

export interface DocumentationOrigin {
	readonly module: string;
	readonly line: number;
	readonly column: number;
}

export interface OperationDocumentationSource {
	readonly identity:
		| `query:${string}`
		| `mutation:${string}`
		| `action:${string}`;
	readonly kind: OperationDocumentationMemberKind;
	readonly input: RuntimeCodec;
	readonly output: RuntimeCodec;
	readonly definition: RecordValue;
	readonly origin: DocumentationOrigin;
	readonly memberOrigins?: Readonly<Record<string, DocumentationOrigin>>;
}

export interface OperationDocumentationArtifactV1 {
	readonly format: "questpie.operation-documentation";
	readonly version: 1;
	readonly operations: readonly Readonly<{
		identity: string;
		summary: string;
		description?: string;
		examples?: readonly Readonly<{ input: unknown; output?: unknown }>[];
	}>[];
}

type DocumentationReason =
	| "unexpectedOperationMember"
	| "missingSummary"
	| "invalidText"
	| "missingExampleInput"
	| "exampleCodecMismatch"
	| "runtimeMintedExample"
	| "exampleLimitExceeded";

function invalid(
	reason: DocumentationReason,
	origin: DocumentationOrigin,
	path: readonly string[],
): never {
	throw new CompilerDiagnosticError(
		"QP-COMPOSE-030",
		"invalidDocumentation",
		`Operation documentation is invalid at ${origin.module}:${origin.line}:${origin.column}`,
		{ reason, origin, path },
	);
}

function record(value: unknown): RecordValue | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as RecordValue)
		: null;
}

const allowedMembers = Object.freeze({
	query: ["describe", "handler", "input", "name", "network", "output", "query"],
	mutation: [
		"describe",
		"errors",
		"handler",
		"input",
		"issueMappings",
		"name",
		"network",
		"output",
		"policy",
	],
	action: [
		"describe",
		"errors",
		"handler",
		"input",
		"limits",
		"name",
		"network",
		"output",
		"policy",
	],
	collectionList: ["data", "describe"],
	collectionGet: ["describe", "select"],
	collectionCreate: [
		"describe",
		"errors",
		"input",
		"issueMappings",
		"normalize",
		"select",
		"values",
	],
	collectionUpdate: [
		"describe",
		"errors",
		"input",
		"issueMappings",
		"normalize",
		"select",
		"values",
	],
	collectionDelete: ["describe", "select"],
} as const satisfies Readonly<
	Record<OperationDocumentationMemberKind, readonly string[]>
>);

export function assertClosedOperationDocumentationMembers(
	kind: OperationDocumentationMemberKind,
	definition: RecordValue,
	origin: DocumentationOrigin,
	identity: string,
	memberOrigins: Readonly<Record<string, DocumentationOrigin>> = {},
): void {
	const allowed = new Set<string>(
		kind === "query" && definition.query !== undefined
			? ["describe", "name", "network", "query"]
			: allowedMembers[kind],
	);
	const unexpected = Object.keys(definition)
		.sort(compareAscii)
		.find((member) => !allowed.has(member));
	if (unexpected)
		invalid("unexpectedOperationMember", memberOrigins[unexpected] ?? origin, [
			identity,
			unexpected,
		]);
}

function hasForbiddenControl(value: string, allowLineFeed: boolean): boolean {
	for (const character of value) {
		const point = character.codePointAt(0)!;
		if (point <= 0x1f && !(allowLineFeed && point === 0x0a)) return true;
		if (point >= 0x7f && point <= 0x9f) return true;
	}
	return false;
}

function documentationText(
	value: unknown,
	kind: "summary" | "description",
	origin: DocumentationOrigin,
): string {
	if (typeof value !== "string" || value.length === 0)
		invalid(kind === "summary" ? "missingSummary" : "invalidText", origin, [
			"describe",
			kind,
		]);
	const scalarCount = [...value].length;
	const valid =
		value === value.normalize("NFC") &&
		value.trim() === value &&
		!hasLoneUnicodeSurrogate(value) &&
		!bidiControl.test(value) &&
		!hasForbiddenControl(value, kind === "description") &&
		(kind === "description" || !value.includes("\n")) &&
		(kind === "description" ||
			(!value.includes("\u2028") && !value.includes("\u2029"))) &&
		scalarCount <= (kind === "summary" ? 120 : 1_024);
	if (!valid) invalid("invalidText", origin, ["describe", kind]);
	return value;
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
	const object = record(value);
	if (!object) return false;
	return Object.entries(codec.properties).some(
		([key, child]) =>
			Object.hasOwn(object, key) && hasRuntimeMintedValue(child, object[key]),
	);
}

function canonicalExample(
	codec: RuntimeCodec,
	value: unknown,
	origin: DocumentationOrigin,
	path: readonly string[],
): unknown {
	if (hasRuntimeMintedValue(codec, value))
		invalid("runtimeMintedExample", origin, path);
	try {
		return encodeRuntimeCodec(codec, decodeRuntimeCodec(codec, value));
	} catch {
		invalid("exampleCodecMismatch", origin, path);
	}
}

export function compileOperationDocumentation(
	sources: readonly OperationDocumentationSource[],
): Readonly<{
	artifact: OperationDocumentationArtifactV1;
	bytes: string;
	digest: string;
}> {
	const operations = [...sources]
		.sort((left, right) => compareAscii(left.identity, right.identity))
		.flatMap((source) => {
			assertClosedOperationDocumentationMembers(
				source.kind,
				source.definition,
				source.origin,
				source.identity,
				source.memberOrigins,
			);
			if (source.definition.describe === undefined) return [];
			const describe = record(source.definition.describe);
			if (!describe)
				invalid("missingSummary", source.origin, ["describe", "summary"]);
			const unexpected = Object.keys(describe)
				.sort(compareAscii)
				.find(
					(member) =>
						member !== "summary" &&
						member !== "description" &&
						member !== "examples",
				);
			if (unexpected)
				invalid("unexpectedOperationMember", source.origin, [
					"describe",
					unexpected,
				]);
			const summary = documentationText(
				describe.summary,
				"summary",
				source.origin,
			);
			const description =
				describe.description === undefined
					? undefined
					: documentationText(
							describe.description,
							"description",
							source.origin,
						);
			const rawExamples = describe.examples;
			if (rawExamples !== undefined && !Array.isArray(rawExamples))
				invalid("exampleCodecMismatch", source.origin, [
					"describe",
					"examples",
				]);
			const examples = rawExamples?.map((value, index) => {
				const example = record(value);
				if (!example || !Object.hasOwn(example, "input"))
					invalid("missingExampleInput", source.origin, [
						"describe",
						"examples",
						String(index),
					]);
				const unexpectedExampleMember = Object.keys(example)
					.sort(compareAscii)
					.find((member) => member !== "input" && member !== "output");
				if (unexpectedExampleMember)
					invalid("exampleCodecMismatch", source.origin, [
						"describe",
						"examples",
						String(index),
						unexpectedExampleMember,
					]);
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
				new TextEncoder().encode(canonicalBytes(examples)).length > 4_096
			)
				invalid("exampleLimitExceeded", source.origin, [
					"describe",
					"examples",
				]);
			return [
				{
					identity: source.identity,
					summary,
					...(description === undefined ? {} : { description }),
					...(examples === undefined ? {} : { examples }),
				},
			];
		});
	const artifact: OperationDocumentationArtifactV1 = Object.freeze({
		format: "questpie.operation-documentation",
		version: 1,
		operations: Object.freeze(operations),
	});
	return Object.freeze({
		artifact,
		bytes: canonicalBytes(artifact),
		digest: digest(documentationDigestDomain, artifact),
	});
}

function sourceOrigin(
	module: string,
	span: SourceSpan | null | undefined,
): DocumentationOrigin {
	return Object.freeze({
		module,
		line: span?.start.line ?? 1,
		column: span?.start.column ?? 1,
	});
}

/** Projects application and activated-Package authoring through one validator. */
export function compileApplicationOperationDocumentation(
	input: Readonly<{
		resources: readonly NormalizedResource[];
		evaluatedExports: readonly EvaluatedExport[];
		collectionOperations: CollectionOperationProgramsV1;
		data: unknown;
	}>,
): ReturnType<typeof compileOperationDocumentation> {
	const sources: OperationDocumentationSource[] = input.resources
		.filter(
			(resource) =>
				resource.kind === "query" ||
				resource.kind === "mutation" ||
				resource.kind === "action",
		)
		.map((resource) => {
			const brand = record(resource.value["__questpie"]);
			const authoringMembers = Array.isArray(brand?.authoringMembers)
				? brand.authoringMembers.filter(
						(member): member is string => typeof member === "string",
					)
				: Object.keys(resource.value);
			const definition = Object.freeze(
				Object.fromEntries(
					authoringMembers.map((member) => [
						member,
						member === "describe" ? resource.value.describe : null,
					]),
				),
			);
			const memberOrigins = Object.freeze(
				Object.fromEntries(
					authoringMembers.map((member) => [
						member,
						sourceOrigin(
							resource.origin.logicalPath,
							resource.origin.memberSpans[member] ?? resource.origin.span,
						),
					]),
				),
			);
			return {
				identity: resource.identity as OperationDocumentationSource["identity"],
				kind: resource.kind as "query" | "mutation" | "action",
				input: resource.contract.input as RuntimeCodec,
				output: resource.contract.output as RuntimeCodec,
				definition,
				memberOrigins,
				origin: sourceOrigin(
					resource.origin.logicalPath,
					resource.origin.memberSpans.describe ?? resource.origin.span,
				),
			};
		});
	const operationCodecs = projectCollectionOperationCodecs({
		programs: input.collectionOperations,
		resources: input.resources,
		data: input.data,
	});
	const programs = new Map(
		input.collectionOperations.operations.map((program) => [
			`${program.target}\0${program.member}`,
			program,
		]),
	);
	for (const item of input.evaluatedExports) {
		if (item.value.kind !== "collectionOperationSet") continue;
		const target = String(item.value.target);
		if (Array.isArray(item.value.unexpectedMembers)) {
			const unexpected = item.value.unexpectedMembers.find(
				(member): member is string => typeof member === "string",
			);
			if (unexpected)
				invalid(
					"unexpectedOperationMember",
					sourceOrigin(
						item.logicalPath,
						item.memberSpans[unexpected] ?? item.span,
					),
					[`collectionOperationSet:${String(item.value.name)}`, unexpected],
				);
		}
		if (!Array.isArray(item.value.members)) continue;
		for (const rawMember of item.value.members) {
			const member = record(rawMember);
			if (!member) continue;
			const memberName = String(member.member);
			const program = programs.get(`${target}\0${memberName}`);
			if (!program)
				throw new TypeError(
					`missing generated Operation for ${target}.${memberName}`,
				);
			const codecs =
				memberName === "list"
					? {
							input: member.documentationInput as RuntimeCodec,
							output: member.documentationOutput as RuntimeCodec,
						}
					: operationCodecs.get(program.identity);
			if (!codecs)
				throw new TypeError(`missing ${program.identity} documentation codecs`);
			const definition = record(member.documentationDefinition);
			if (!definition)
				throw new TypeError(
					`missing ${program.identity} documentation definition`,
				);
			sources.push({
				identity: program.identity,
				kind: `collection${memberName[0]!.toUpperCase()}${memberName.slice(1)}` as OperationDocumentationMemberKind,
				input: codecs.input as RuntimeCodec,
				output: codecs.output as RuntimeCodec,
				definition,
				memberOrigins: Object.freeze(
					Object.fromEntries(
						Object.keys(definition).map((name) => [
							name,
							sourceOrigin(
								item.logicalPath,
								item.memberSpans[`${memberName}.${name}`] ??
									item.memberSpans[memberName] ??
									item.span,
							),
						]),
					),
				),
				origin: sourceOrigin(
					item.logicalPath,
					item.memberSpans[memberName] ?? item.span,
				),
			});
		}
	}
	return compileOperationDocumentation(sources);
}
