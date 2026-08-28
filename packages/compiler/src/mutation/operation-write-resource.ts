import { compareAscii } from "../canonical";
import {
	projectCollectionFieldCodec,
	type CollectionFieldCodecProjection,
} from "../codec";
import { normalizeBoundPolicy } from "../relational";
import type { NormalizedResource } from "../types";
import type { CollectionOperationProgramsV1 } from "./operation-set-contract";

type RecordValue = Readonly<Record<string, unknown>>;
type CodecValue = CollectionFieldCodecProjection;
type FieldFact = Readonly<{
	path: readonly string[];
	codec: CodecValue;
	nullable: boolean;
}>;

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${label} must be an object`);
	return value as RecordValue;
}

function fieldFacts(data: unknown, target: string): readonly FieldFact[] {
	const projection = record(data, "Data Contract");
	if (!Array.isArray(projection.collections))
		throw new TypeError("Data Contract Collections are unavailable");
	const collection = projection.collections
		.map((candidate) => record(candidate, "Data Contract Collection"))
		.find((candidate) => candidate.identity === target);
	if (!collection || !Array.isArray(collection.fields))
		throw new TypeError(`Data Contract lacks ${target}`);
	return collection.fields.map((candidate) => {
		const field = record(candidate, `${target} Field`);
		if (!Array.isArray(field.path))
			throw new TypeError(`${target} Field path is invalid`);
		return Object.freeze({
			path: field.path as readonly string[],
			codec: projectCollectionFieldCodec(field.codec, "dataContract"),
			nullable: field.nullable === true,
		});
	});
}

function pathKey(path: readonly string[]): string {
	return JSON.stringify(path);
}

type CodecTree = { codec?: CodecValue; children: Map<string, CodecTree> };

function objectCodec(
	paths: readonly (readonly string[])[],
	facts: readonly FieldFact[],
	optionalPaths: ReadonlySet<string>,
): CodecValue {
	const byPath = new Map(facts.map((fact) => [pathKey(fact.path), fact]));
	const root: CodecTree = { children: new Map() };
	for (const path of paths) {
		const fact = byPath.get(pathKey(path));
		if (!fact)
			throw new TypeError(`missing Collection Field ${path.join(".")}`);
		let node = root;
		for (const part of path) {
			let child = node.children.get(part);
			if (!child) {
				child = { children: new Map() };
				node.children.set(part, child);
			}
			node = child;
		}
		node.codec = fact.nullable
			? Object.freeze({ kind: "nullable", codec: fact.codec })
			: fact.codec;
	}
	const optional = [...optionalPaths].map(
		(value) => JSON.parse(value) as readonly string[],
	);
	const render = (node: CodecTree, prefix: readonly string[]): CodecValue => {
		if (node.codec) return node.codec;
		const properties = Object.fromEntries(
			[...node.children.entries()]
				.toSorted(([left], [right]) => compareAscii(left, right))
				.map(([name, child]) => {
					const path = [...prefix, name];
					const childCodec = render(child, path);
					const isOptional = optional.some(
						(candidate) =>
							candidate.length >= path.length &&
							path.every((part, index) => candidate[index] === part),
					);
					return [
						name,
						isOptional
							? Object.freeze({ kind: "optional", codec: childCodec })
							: childCodec,
					];
				}),
		);
		return Object.freeze({
			kind: "object",
			properties: Object.freeze(properties),
		});
	};
	return render(root, []);
}

/** Materializes Operation Set writes as ordinary framework-bound Mutations. */
export function projectCollectionOperationWriteResources(
	input: Readonly<{
		sets: Readonly<{ sets: readonly RecordValue[] }>;
		origins: readonly RecordValue[];
		programs: CollectionOperationProgramsV1;
		resources: readonly NormalizedResource[];
		data: unknown;
	}>,
): readonly NormalizedResource[] {
	const programs = new Map(
		input.programs.operations.map((program) => [program.identity, program]),
	);
	const policies = new Map(
		input.resources
			.filter((resource) => resource.kind === "policy")
			.map((resource) => {
				const program = normalizeBoundPolicy(resource.value).program;
				return [program.identity, program] as const;
			}),
	);
	const result: NormalizedResource[] = [];
	for (const set of input.sets.sets) {
		const setOrigin = input.origins.find(
			(candidate) =>
				candidate.target === set.target && candidate.name === set.name,
		);
		if (!setOrigin)
			throw new TypeError(
				`missing Collection Operation Set Origin ${String(set.name)}`,
			);
		const establishedAt = record(
			setOrigin.establishedAt,
			"Collection Operation Set Origin",
		);
		for (const child of set.children as readonly RecordValue[]) {
			const identity = String(child.identity);
			const program = programs.get(
				identity as CollectionOperationProgramsV1["operations"][number]["identity"],
			);
			if (
				!program ||
				(program.member !== "create" && program.member !== "update")
			)
				continue;
			const policy = policies.get(program.policy);
			const operationPolicy = policy?.operations[program.member];
			if (!operationPolicy)
				throw new TypeError(`${identity} has no matching Collection Policy`);
			const fields = fieldFacts(input.data, program.target);
			const requiredCaller = new Set(
				program.requiredCallerInputFields.map(pathKey),
			);
			const caller = objectCodec(
				program.callerInputFields,
				fields,
				new Set(
					program.callerInputFields
						.filter((path) => !requiredCaller.has(pathKey(path)))
						.map(pathKey),
				),
			);
			const properties: Record<string, CodecValue> = {};
			if (program.member === "create") properties.input = caller;
			else {
				properties.key = objectCodec(program.keyFields, fields, new Set());
				properties.expected = Object.freeze({
					kind: "optional",
					codec: objectCodec(
						fields.map(({ path }) => path),
						fields,
						new Set(fields.map(({ path }) => pathKey(path))),
					),
				});
				properties.patch = Object.freeze({ kind: "optional", codec: caller });
			}
			const selectedOptional = new Set(
				(policy?.fields?.selectedOutput ?? [])
					.map(({ path }) => path)
					.filter((path) =>
						program.selectedFieldPaths.some(
							(candidate) => pathKey(candidate) === pathKey(path),
						),
					)
					.map(pathKey),
			);
			const selected = objectCodec(
				program.selectedFieldPaths,
				fields,
				selectedOptional,
			);
			const [logicalPath, owner = ""] = String(child.origin).split("#");
			const exportName = owner.split(".")[0]!;
			result.push(
				Object.freeze({
					identity,
					kind: "mutation",
					name: identity.slice("mutation:".length),
					contract: Object.freeze({
						input: Object.freeze({
							kind: "object",
							properties: Object.freeze(properties),
						}),
						output:
							program.outputCardinality === "optionalOne"
								? Object.freeze({ kind: "nullable", codec: selected })
								: selected,
						declaredErrors: Object.freeze({}),
						exposure:
							record(child.exposure, `${identity} exposure`).network === true
								? "network"
								: "server",
						policy: operationPolicy.admission,
					}),
					contributions: Object.freeze([]),
					origin: Object.freeze({
						logicalPath: logicalPath!,
						exportName,
						packageId:
							establishedAt.packageId === null
								? null
								: String(establishedAt.packageId),
						span: null,
						memberSpans: Object.freeze({}),
					}),
					value: Object.freeze({
						kind: "frameworkGeneratedCollectionOperation",
						member: program.member,
						target: program.target,
						kernelIdentity: `mutation:__collectionKernel.${program.target.slice("collection:".length)}.${program.member}`,
					}),
				}),
			);
		}
	}
	return Object.freeze(
		result.toSorted((left, right) =>
			compareAscii(left.identity, right.identity),
		),
	);
}
