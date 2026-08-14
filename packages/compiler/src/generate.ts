import { compareAscii } from "./canonical";
import type { NormalizedResource } from "./types";

type RecordValue = Readonly<Record<string, unknown>>;

function record(value: unknown): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError("expected an object while rendering declarations");
	return value as RecordValue;
}

function typeFromCodec(value: unknown): string {
	const codec = record(value);
	if (codec.kind === "uuid" || codec.kind === "text") return "string";
	if (codec.kind === "boolean") return "boolean";
	if (codec.kind === "integer") return "number";
	if (codec.kind === "timestamp") return "Date";
	if (codec.kind === "object") {
		const properties = Object.entries(record(codec.properties))
			.sort(([left], [right]) => compareAscii(left, right))
			.map(
				([key, child]) =>
					`readonly ${JSON.stringify(key)}: ${typeFromCodec(child)};`,
			)
			.join(" ");
		return `Readonly<{ ${properties} }>`;
	}
	return "never";
}

function fieldType(field: RecordValue): string {
	const scalar = field.scalar;
	let type =
		scalar === "boolean"
			? "boolean"
			: scalar === "integer"
				? "number"
				: scalar === "timestamp"
					? "Date"
					: scalar === "object"
						? embeddedFieldType(field)
						: scalar === "array"
							? `readonly ${embeddedValueType(record(record(field.options).items))}[]`
							: scalar === "json"
								? "TaggedJsonValue"
								: "string";
	if (field.nullable === true) type = `${type} | null`;
	return type;
}

function fieldNodeType(field: RecordValue): string {
	if (field.kind !== "inlineShape") return fieldType(field);
	return `Readonly<{ ${Object.entries(record(field.fields))
		.sort(([left], [right]) => compareAscii(left, right))
		.map(
			([key, child]) =>
				`readonly ${JSON.stringify(key)}: ${fieldNodeType(record(child))};`,
		)
		.join(" ")} }>`;
}

function fieldAtPath(
	fields: readonly [string, RecordValue][],
	reference: unknown,
): RecordValue | undefined {
	const path = Array.isArray(reference) ? reference : [reference];
	let node = fields.find(([name]) => name === path[0])?.[1];
	for (const segment of path.slice(1)) {
		if (!node || node.kind !== "inlineShape") return undefined;
		node = record(node.fields)[String(segment)] as RecordValue | undefined;
	}
	return node?.kind === "inlineShape" ? undefined : node;
}

function embeddedValueType(value: RecordValue): string {
	const options = record(value.options ?? {});
	let type =
		value.kind === "boolean"
			? "boolean"
			: value.kind === "integer"
				? "number"
				: value.kind === "object"
					? embeddedObjectType(record(options.properties))
					: value.kind === "array"
						? `readonly ${embeddedValueType(record(options.items))}[]`
						: "string";
	if (value.nullable === true) type = `${type} | null`;
	return type;
}

function embeddedObjectType(properties: RecordValue): string {
	return `Readonly<{ ${Object.entries(properties)
		.sort(([left], [right]) => compareAscii(left, right))
		.map(
			([key, child]) =>
				`readonly ${JSON.stringify(key)}: ${embeddedValueType(record(child))};`,
		)
		.join(" ")} }>`;
}

function embeddedFieldType(field: RecordValue): string {
	return embeddedObjectType(record(record(field.options).properties));
}

function collectionFields(
	resource: NormalizedResource,
): [string, RecordValue][] {
	const fields = Object.entries(record(resource.value.fields)) as [
		string,
		RecordValue,
	][];
	for (const augmentation of (resource.value.augmentations ??
		[]) as readonly unknown[]) {
		fields.push(
			...(Object.entries(record(record(augmentation).fields)) as [
				string,
				RecordValue,
			][]),
		);
	}
	return fields.sort(([left], [right]) => compareAscii(left, right));
}

function renderData(resources: readonly NormalizedResource[]): string {
	return resources
		.filter((resource) => resource.kind === "collection")
		.map((resource) => {
			const fields = collectionFields(resource);
			const row = fields
				.map(
					([key, field]) =>
						`readonly ${JSON.stringify(key)}: ${fieldNodeType(field)};`,
				)
				.join(" ");
			const constraints = record(resource.value.constraints);
			const primary = Object.values(constraints)
				.map(record)
				.find((constraint) => constraint.kind === "primaryKey");
			const keys = ((primary?.fields ?? []) as readonly unknown[])
				.map((key) => {
					const field = fieldAtPath(fields, key);
					return `readonly ${JSON.stringify(Array.isArray(key) ? key.join("/") : key)}: ${field ? fieldType(field) : "never"};`;
				})
				.join(" ");
			return `readonly ${JSON.stringify(resource.name)}: ReadCollection<Readonly<{ ${row} }>, Readonly<{ ${keys} }>>;`;
		})
		.join("\n\t\t");
}

function renderQueries(resources: readonly NormalizedResource[]): string {
	return resources
		.filter((resource) => resource.kind === "query")
		.map((resource) => {
			const contract = resource.contract;
			return `${JSON.stringify(resource.name)}: Readonly<{ input: ${typeFromCodec(contract.input)}; output: ${typeFromCodec(contract.output)}; }>;`;
		})
		.join("\n\t");
}

const factoryNames = [
	"defineMutation",
	"defineAction",
	"defineRoute",
	"defineReaction",
	"defineJob",
	"defineWorkflow",
] as const;

export function renderAppContract(
	resources: readonly NormalizedResource[],
): string {
	const otherFactories = factoryNames
		.map((name) => `export declare const ${name}: EmptyDefinitionFactory;`)
		.join("\n");
	return `import type { Codec, TaggedJsonValue } from "questpie";

export interface ReadCollection<Row, Key> {
	get(input: Readonly<{ key: Key }>): Promise<Row | null>;
}

export interface GeneratedData {
	${renderData(resources)}
}

export interface GeneratedQueries {
	${renderQueries(resources)}
}

export interface QueryContext {
	readonly data: Readonly<GeneratedData>;
	readonly signal: AbortSignal;
}

export type QueryDefinition<Name extends keyof GeneratedQueries> = Readonly<{
	readonly kind: "query";
	readonly name: Name;
}>;

export type QueryFactory = <const Name extends keyof GeneratedQueries>(
	definition: Readonly<{
		name: Name;
		input: Codec<GeneratedQueries[Name]["input"]>;
		output: Codec<GeneratedQueries[Name]["output"]>;
		handler(input: Readonly<{
			input: GeneratedQueries[Name]["input"];
			ctx: QueryContext;
		}>): GeneratedQueries[Name]["output"] | Promise<GeneratedQueries[Name]["output"]>;
	}>,
) => QueryDefinition<Name>;

type EmptyDefinitionFactory = (definition: never) => never;

export declare const defineQuery: QueryFactory;
${otherFactories}

export interface GeneratedApp {
	readonly queries: GeneratedQueries;
}

export declare function createApp(): GeneratedApp;
`;
}

export function renderClientContract(
	resources: readonly NormalizedResource[],
): string {
	const queries = resources
		.filter((resource) => resource.kind === "query")
		.map(
			(resource) =>
				`${JSON.stringify(resource.name)}(input: ${typeFromCodec(resource.contract.input)}): Promise<${typeFromCodec(resource.contract.output)}>;`,
		)
		.join("\n\t\t");
	return `export interface GeneratedClient {
	readonly queries: Readonly<{
		${queries}
	}>;
}

export declare function createClient(input: Readonly<{
	readonly baseUrl: string;
	readonly fetch?: typeof globalThis.fetch;
}>): GeneratedClient;
`;
}

export function renderPackageContract(
	resources: readonly NormalizedResource[],
): string {
	const factories = [
		"defineQuery",
		"defineMutation",
		"defineAction",
		"defineRoute",
		"defineReaction",
		"defineJob",
		"defineWorkflow",
	]
		.filter((name) => name !== "defineQuery")
		.map((name) => `export declare const ${name}: EmptyDefinitionFactory;`)
		.join("\n");
	return `import type { Codec } from "questpie";

export interface ReadCollection<Row, Key> {
	get(input: Readonly<{ key: Key }>): Promise<Row | null>;
}

export interface PackageData {
	${renderData(resources)}
}

export interface PackageQueries {
	${renderQueries(resources)}
}

export type PackageQueryFactory = <const Name extends keyof PackageQueries>(
	definition: Readonly<{
		name: Name;
		input: Codec<PackageQueries[Name]["input"]>;
		output: Codec<PackageQueries[Name]["output"]>;
		handler(input: Readonly<{
			input: PackageQueries[Name]["input"];
			ctx: Readonly<{ data: PackageData; signal: AbortSignal }>;
		}>): PackageQueries[Name]["output"] | Promise<PackageQueries[Name]["output"]>;
	}>,
) => Readonly<{ kind: "query"; name: Name }>;

type EmptyDefinitionFactory = (definition: never) => never;

export declare const defineQuery: PackageQueryFactory;
${factories}
`;
}
