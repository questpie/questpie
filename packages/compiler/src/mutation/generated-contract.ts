import { compareAscii } from "../canonical";
import type { DataQueryTemplateV1 } from "../relational";
import type {
	CollectionOperationProgramsV1,
	CollectionOperationProgramV1,
} from "./operation-set-contract";

type FieldPath = readonly string[];

interface TypeNode {
	type: string | null;
	children: Map<string, TypeNode>;
}

export interface MutationDataTypeRenderer {
	field(target: `collection:${string}`, path: FieldPath): string;
	fieldIdentity(identity: string): string;
}

function shape(
	paths: readonly FieldPath[],
	fieldType: (path: FieldPath) => string,
	optional: boolean,
): string {
	const root: TypeNode = { type: null, children: new Map() };
	for (const path of paths) {
		let node = root;
		for (const segment of path) {
			let child = node.children.get(segment);
			if (!child) {
				child = { type: null, children: new Map() };
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
					`readonly ${JSON.stringify(name)}${optional ? "?" : ""}: ${render(child)};`,
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
): string {
	const fields = template.select
		.map((selected) => {
			if (selected.kind === "field")
				return `readonly ${JSON.stringify(selected.key)}: ${types.fieldIdentity(selected.field)};`;
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

function method(
	program: CollectionOperationProgramV1,
	types: MutationDataTypeRenderer,
): string {
	const selected = shape(
		program.selectedFieldPaths,
		(path) => types.field(program.target, path),
		false,
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
		const row = listSelection(program.dataQuery, types);
		return `readonly list: (input: Readonly<{ ${input} }>) => Promise<Readonly<{ nodes: ReadonlyArray<${row}>; pageInfo: Readonly<{ endCursor: string | null; hasNextPage: boolean; }>; }>>;`;
	}
	if (program.member === "get" || program.member === "delete") {
		const key = shape(
			program.keyFields,
			(path) => types.field(program.target, path),
			false,
		);
		return `readonly ${program.member}: (input: Readonly<{ readonly key: ${key}; }>) => Promise<${result}>;`;
	}
	const callerInput = shape(
		program.callerInputFields,
		(path) => types.field(program.target, path),
		program.member === "update",
	);
	if (program.member === "create")
		return `readonly create: (input: Readonly<{ readonly input: ${callerInput}; }>) => Promise<${result}>;`;
	const key = shape(
		program.keyFields,
		(path) => types.field(program.target, path),
		false,
	);
	return `readonly update: (input: Readonly<{ readonly key: ${key}; readonly patch: ${callerInput}; }>) => Promise<${result}>;`;
}

export function renderGeneratedMutationData(
	programs: CollectionOperationProgramsV1,
	types: MutationDataTypeRenderer,
): string {
	const collections = new Map<
		string,
		Map<CollectionOperationProgramV1["member"], CollectionOperationProgramV1>
	>();
	for (const program of programs.operations) {
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
