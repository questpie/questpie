import { compareAscii } from "../canonical";
import type { CollectionLifecycleProgramsV1 } from "../lifecycle/contract";
import {
	issueBearingCollectionIdentities,
	issueBearingCollectionRequirements,
} from "../lifecycle/reachability";
import {
	normalizeBoundPolicy,
	type DataQueryTemplateV1,
	type RootQuerySelectionV1,
} from "../relational";
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
	readonly issueBearingTargets: readonly string[];
	readonly admittedIssueBearingTargets: Readonly<
		Record<string, readonly string[]>
	>;
}

interface MutationDataTypeRenderer {
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

function hasRequiredPathAtOrBelow(
	requiredPaths: readonly FieldPath[],
	path: FieldPath,
): boolean {
	return requiredPaths.some(
		(required) =>
			required.length >= path.length &&
			path.every((segment, index) => required[index] === segment),
	);
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
	const render = (
		selections: readonly RootQuerySelectionV1[],
		paths: ReadonlySet<string>,
	): string =>
		selections
			.map((selected) => {
				if (selected.kind === "field")
					return `readonly ${JSON.stringify(selected.key)}${paths.has(fieldIdentityPath(selected.field)) ? "?" : ""}: ${types.fieldIdentity(selected.field)};`;
				return `readonly ${JSON.stringify(selected.key)}: Readonly<{ ${render(selected.select, new Set())} }> | null;`;
			})
			.join(" ");
	const fields = render(template.select, optionalPaths);
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
		(path) =>
			!hasRequiredPathAtOrBelow(program.requiredCallerInputFields, path),
	);
	const trustedValues = shape(
		program.trustedValueFields,
		(path) => types.field(program.target, path),
		(path) =>
			!hasRequiredPathAtOrBelow(program.requiredTrustedValueFields, path),
	);
	const valuesMember =
		program.trustedValueFields.length === 0
			? ""
			: ` readonly values${program.requiredTrustedValueFields.length === 0 ? "?" : ""}: ${trustedValues};`;
	if (program.member === "create")
		return `readonly create: (input: Readonly<{ readonly input: ${callerInput};${valuesMember} }>) => Promise<${result}>;`;
	const key = shape(
		program.keyFields,
		(path) => types.field(program.target, path),
		() => false,
	);
	const expectedPaths = [
		...program.keyFields,
		...program.callerInputFields,
		...program.trustedValueFields,
		...program.selectedFieldPaths,
	].filter(
		(path, index, paths) =>
			paths.findIndex(
				(candidate) =>
					candidate.length === path.length &&
					candidate.every((segment, part) => segment === path[part]),
			) === index,
	);
	const expected = shape(
		expectedPaths,
		(path) => types.field(program.target, path),
		() => true,
	);
	return `readonly update: (input: Readonly<{ readonly key: ${key}; readonly expected?: ${expected}; readonly patch?: ${callerInput};${valuesMember} }>) => Promise<${result}>;`;
}

export function renderGeneratedMutationData(
	contract: MutationGeneratedContractV1,
	types: MutationDataTypeRenderer,
	mutationName?: string,
): string {
	const issueBearingTargets = new Set(contract.issueBearingTargets);
	const admittedTargets = new Set(
		mutationName === undefined
			? contract.issueBearingTargets
			: (contract.admittedIssueBearingTargets[mutationName] ?? []),
	);
	const collections = new Map<
		string,
		Map<
			CollectionOperationProgramV1["member"],
			MutationGeneratedContractV1["operations"][number]
		>
	>();
	for (const program of contract.operations) {
		if (
			mutationName !== undefined &&
			(program.member === "create" || program.member === "update") &&
			issueBearingTargets.has(program.target) &&
			!admittedTargets.has(program.target)
		)
			continue;
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

export function renderGeneratedMutationDataByName(
	contract: MutationGeneratedContractV1,
	types: MutationDataTypeRenderer,
): string {
	return Object.keys(contract.admittedIssueBearingTargets)
		.sort(compareAscii)
		.map(
			(name) =>
				`readonly ${JSON.stringify(name)}: Readonly<{ ${renderGeneratedMutationData(contract, types, name)} }>;`,
		)
		.join("\n\t");
}

export function projectMutationGeneratedContract(
	programs: CollectionOperationProgramsV1,
	resources: readonly NormalizedResource[],
	lifecycle: CollectionLifecycleProgramsV1,
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
	const issueRequirements = issueBearingCollectionRequirements(
		lifecycle,
		programs,
	);
	const issueBearingTargets = issueBearingCollectionIdentities(
		lifecycle,
		programs,
	);
	const collectionIdentityByName = new Map(
		resources
			.filter((resource) => resource.kind === "collection")
			.map((resource) => [resource.name, resource.identity]),
	);
	const admittedIssueBearingTargets = Object.fromEntries(
		resources
			.filter((resource) => resource.kind === "mutation")
			.sort((left, right) => compareAscii(left.name, right.name))
			.map((resource) => [
				resource.name,
				Object.keys(
					(resource.contract.issueMappings ?? {}) as Readonly<
						Record<string, unknown>
					>,
				)
					.map((name) => collectionIdentityByName.get(name))
					.filter(
						(identity): identity is string =>
							identity !== undefined &&
							issueBearingTargets.includes(identity) &&
							issueRequirements[identity]!.every((required) =>
								Object.keys(resource.contract.issueMappings ?? {}).some(
									(name) => collectionIdentityByName.get(name) === required,
								),
							),
					)
					.sort(compareAscii),
			]),
	);
	return Object.freeze({
		issueBearingTargets: Object.freeze(issueBearingTargets),
		admittedIssueBearingTargets: Object.freeze(admittedIssueBearingTargets),
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
