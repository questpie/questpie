import { compareAscii } from "../canonical";
import { normalizeBoundPolicy, type DataQueryTemplateV1 } from "../relational";
import type { NormalizedResource } from "../types";
import type {
	CollectionOperationProgramsV1,
	CollectionOperationProgramV1,
} from "./operation-set-contract";

type FieldPath = readonly string[];

interface TypeNode {
	type: string | null;
	optional: boolean;
	children: Map<string, TypeNode>;
}

export interface MutationGeneratedContractV1 {
	readonly operations: readonly Readonly<
		CollectionOperationProgramV1 & {
			optionalSelectedFieldPaths: readonly FieldPath[];
		}
	>[];
}

export interface MutationDataTypeRenderer {
	field(target: `collection:${string}`, path: FieldPath): string;
	fieldIdentity(identity: string): string;
}

function shape(
	paths: readonly FieldPath[],
	fieldType: (path: FieldPath) => string,
	optional: (path: FieldPath) => boolean,
): string {
	const root: TypeNode = { type: null, optional: false, children: new Map() };
	for (const path of paths) {
		let node = root;
		for (const [index, segment] of path.entries()) {
			let child = node.children.get(segment);
			if (!child) {
				child = {
					type: null,
					optional: optional(path.slice(0, index + 1)),
					children: new Map(),
				};
				node.children.set(segment, child);
			}
			node = child;
		}
		node.type = fieldType(path);
	}
	const render = (node: TypeNode): string => {
		if (node.type !== null) return node.type;
		return `Readonly<{ ${[...node.children.entries()]
			.sort(([left], [right]) => compareAscii(left, right))
			.map(
				([name, child]) =>
					`readonly ${JSON.stringify(name)}${child.optional ? "?" : ""}: ${render(child)};`,
			)
			.join(" ")} }>`;
	};
	return render(root);
}

function parameterType(
	parameter: DataQueryTemplateV1["parameters"][number],
): string {
	if (parameter.kind === "cursor") return "string | null";
	const scalar =
		parameter.codec.kind === "boolean"
			? "boolean"
			: parameter.codec.kind === "integer"
				? "number"
				: parameter.codec.kind === "timestamp"
					? "Date"
					: "string";
	return parameter.kind === "list" ? `ReadonlyArray<${scalar}>` : scalar;
}

function listSelection(
	template: DataQueryTemplateV1,
	types: MutationDataTypeRenderer,
	optionalPaths: ReadonlySet<string>,
): string {
	const fields = template.select
		.map((selected) => {
			if (selected.kind === "field")
				return `readonly ${JSON.stringify(selected.key)}${optionalPaths.has(fieldIdentityPath(selected.field)) ? "?" : ""}: ${types.fieldIdentity(selected.field)};`;
			return `readonly ${JSON.stringify(selected.key)}: Readonly<{ ${selected.select
				.map(
					(field) =>
						`readonly ${JSON.stringify(field.key)}: ${types.fieldIdentity(field.field)};`,
				)
				.join(" ")} }> | null;`;
		})
		.join(" ");
	return `Readonly<{ ${fields} }>`;
}

function fieldIdentityPath(identity: string): string {
	const marker = "/field:";
	const offset = identity.indexOf(marker);
	if (offset < 0 || offset + marker.length === identity.length)
		throw new TypeError(`invalid generated Field identity ${identity}`);
	return identity.slice(offset + marker.length);
}

function method(
	program: MutationGeneratedContractV1["operations"][number],
	types: MutationDataTypeRenderer,
): string {
	const optionalOutputPaths = new Set(
		program.optionalSelectedFieldPaths.map((path) => path.join("/")),
	);
	const selected = shape(
		program.selectedFieldPaths,
		(path) => types.field(program.target, path),
		(path) => optionalOutputPaths.has(path.join("/")),
	);
	const result =
		program.outputCardinality === "optionalOne"
			? `${selected} | null`
			: selected;
	if (program.member === "list") {
		if (program.dataQuery === null)
			throw new TypeError(`${program.identity} has no compiled Data Query`);
		const input = program.dataQuery.parameters
			.map(
				(parameter) =>
					`readonly ${JSON.stringify(parameter.name)}: ${parameterType(parameter)};`,
			)
			.join(" ");
		const row = listSelection(program.dataQuery, types, optionalOutputPaths);
		return `readonly list: (input: Readonly<{ ${input} }>) => Promise<Readonly<{ nodes: ReadonlyArray<${row}>; pageInfo: Readonly<{ endCursor: string | null; hasNextPage: boolean; }>; }>>;`;
	}
	if (program.member === "get" || program.member === "delete") {
		const key = shape(
			program.keyFields,
			(path) => types.field(program.target, path),
			() => false,
		);
		return `readonly ${program.member}: (input: Readonly<{ readonly key: ${key}; }>) => Promise<${result}>;`;
	}
	const callerInput = shape(
		program.callerInputFields,
		(path) => types.field(program.target, path),
		() => program.member === "update",
	);
	if (program.member === "create")
		return `readonly create: (input: Readonly<{ readonly input: ${callerInput}; }>) => Promise<${result}>;`;
	const key = shape(
		program.keyFields,
		(path) => types.field(program.target, path),
		() => false,
	);
	return `readonly update: (input: Readonly<{ readonly key: ${key}; readonly patch: ${callerInput}; }>) => Promise<${result}>;`;
}

export function renderGeneratedMutationData(
	contract: MutationGeneratedContractV1,
	types: MutationDataTypeRenderer,
): string {
	const collections = new Map<
		string,
		Map<
			CollectionOperationProgramV1["member"],
			MutationGeneratedContractV1["operations"][number]
		>
	>();
	for (const program of contract.operations) {
		const collectionName = program.target.slice("collection:".length);
		const members = collections.get(collectionName) ?? new Map();
		if (members.has(program.member))
			throw new TypeError(
				`${program.target}.${program.member} has more than one Collection Operation owner`,
			);
		members.set(program.member, program);
		collections.set(collectionName, members);
	}
	return [...collections.entries()]
		.sort(([left], [right]) => compareAscii(left, right))
		.map(
			([collection, members]) =>
				`readonly ${JSON.stringify(collection)}: Readonly<{ ${[
					...members.values(),
				]
					.sort((left, right) => compareAscii(left.member, right.member))
					.map((program) => method(program, types))
					.join(" ")} }>;`,
		)
		.join("\n\t");
}

export function projectMutationGeneratedContract(
	programs: CollectionOperationProgramsV1,
	resources: readonly NormalizedResource[],
): MutationGeneratedContractV1 {
	const policies = new Map<
		string,
		ReturnType<typeof normalizeBoundPolicy>["program"]
	>();
	for (const resource of resources)
		if (resource.kind === "policy") {
			const program = normalizeBoundPolicy(resource.value).program;
			policies.set(program.identity, program);
		}
	return Object.freeze({
		operations: Object.freeze(
			programs.operations.map((operation) => {
				const policy = policies.get(operation.policy);
				if (!policy || policy.target !== operation.target)
					throw new TypeError(
						`${operation.identity} has no matching Policy for generated declarations`,
					);
				const selected = new Set(
					operation.dataQuery?.select.flatMap((selection) =>
						selection.kind === "field"
							? [fieldIdentityPath(selection.field)]
							: [],
					) ?? operation.selectedFieldPaths.map((path) => path.join("/")),
				);
				return Object.freeze({
					...operation,
					optionalSelectedFieldPaths: Object.freeze(
						(policy.fields?.selectedOutput ?? [])
							.map((rule) => rule.path)
							.filter((path) => selected.has(path.join("/"))),
					),
				});
			}),
		),
	});
}
