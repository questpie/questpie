import { compareAscii, digest } from "../canonical";
import { CompilerDiagnosticError } from "../diagnostic";
import { normalizeDataQueryTemplate } from "../relational";
import type { EvaluatedExport, NormalizedResource } from "../types";
import type {
	CollectionOperationMember,
	CollectionOperationProgramsV1,
	CollectionOperationProgramV1,
} from "./operation-set-contract";

type RecordValue = Readonly<Record<string, unknown>>;
type OperationMember = CollectionOperationMember;

const memberOrder: readonly OperationMember[] = [
	"list",
	"get",
	"create",
	"update",
	"delete",
];

function invalid(
	message: string,
	details?: Readonly<Record<string, unknown>>,
): never {
	throw new CompilerDiagnosticError(
		"QP-COMPOSE-013",
		"structuralTypeError",
		message,
		details,
	);
}

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return invalid(`${label} must be an object`);
	return value as RecordValue;
}

function string(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0)
		return invalid(`${label} must be a non-empty string`);
	return value;
}

function path(value: unknown, label: string): readonly string[] {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.some((part) => typeof part !== "string" || part.length === 0)
	)
		return invalid(`${label} must be a non-empty Field path`);
	return value as readonly string[];
}

function operationSetExports(
	exports: readonly EvaluatedExport[],
): readonly EvaluatedExport[] {
	return exports.filter((item) => item.value.kind === "collectionOperationSet");
}

function fieldAt(
	collection: NormalizedResource,
	fieldPath: readonly string[],
): RecordValue | null {
	let fields = record(collection.value.fields, `${collection.identity}.fields`);
	let node: RecordValue | null = null;
	for (const [index, name] of fieldPath.entries()) {
		const candidate = fields[name];
		if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
			return null;
		node = candidate as RecordValue;
		if (index < fieldPath.length - 1) {
			if (node.kind !== "inlineShape") return null;
			fields = record(
				node.fields,
				`${collection.identity}.${fieldPath.join(".")}`,
			);
		}
	}
	return node;
}

function validateFieldPath(
	collection: NormalizedResource,
	fieldPath: readonly string[],
	owner: string,
): void {
	if (!fieldAt(collection, fieldPath))
		invalid(
			`${owner} references unknown ${collection.identity}/field:${fieldPath.join(".")}`,
		);
}

function compareSetExports(
	left: EvaluatedExport,
	right: EvaluatedExport,
): number {
	const leftValue = left.value;
	const rightValue = right.value;
	return compareAscii(
		`${String(leftValue.target)}\0${String(leftValue.name)}\0${left.logicalPath}\0${left.exportName}`,
		`${String(rightValue.target)}\0${String(rightValue.name)}\0${right.logicalPath}\0${right.exportName}`,
	);
}

function memberFacts(value: RecordValue): Map<OperationMember, RecordValue> {
	if (!Array.isArray(value.members))
		return invalid("Collection Operation Set members must be an array");
	const members = new Map<OperationMember, RecordValue>();
	for (const candidate of value.members) {
		const member = record(candidate, "Collection Operation Set member");
		const name = string(member.member, "Collection Operation Set member name");
		if (!memberOrder.includes(name as OperationMember))
			invalid(`Collection Operation Set has unknown member ${name}`);
		if (members.has(name as OperationMember))
			invalid(`Collection Operation Set repeats member ${name}`);
		members.set(name as OperationMember, member);
	}
	return members;
}

function validateSet(
	item: EvaluatedExport,
	resources: ReadonlyMap<string, NormalizedResource>,
): Readonly<{
	value: RecordValue;
	collection: NormalizedResource;
	members: Map<OperationMember, RecordValue>;
}> {
	const value = item.value;
	const target = string(value.target, "Collection Operation Set target");
	const collection = resources.get(target);
	if (!collection || collection.kind !== "collection")
		return invalid(`Collection Operation Set references unknown ${target}`);
	const policyIdentity = string(
		value.policy,
		"Collection Operation Set Policy",
	);
	const policy = resources.get(policyIdentity);
	if (!policy || policy.kind !== "policy")
		return invalid(
			`Collection Operation Set references unknown ${policyIdentity}`,
		);
	if (policy.contract.target !== target)
		invalid(`${policyIdentity} does not target ${target}`);
	const members = memberFacts(value);
	for (const [memberName, member] of members) {
		for (const inputPath of (member.inputPaths ?? []) as readonly unknown[])
			validateFieldPath(
				collection,
				path(inputPath, `${memberName} input`),
				`${value.name}.${memberName}`,
			);
		for (const selectedPath of (member.selectionPaths ??
			[]) as readonly unknown[])
			validateFieldPath(
				collection,
				path(selectedPath, `${memberName} selection`),
				`${value.name}.${memberName}`,
			);
		if (memberName === "list") {
			const template = record(member.templateInput, "list dataQuery");
			if (template.from !== target)
				invalid(
					`${value.name}.list dataQuery targets ${String(template.from)}`,
				);
		}
	}
	for (const [programKind, programs] of [
		["normalizer", value.normalizers],
		["server-value", value.serverValues],
	] as const) {
		if (!Array.isArray(programs))
			invalid(
				`Collection Operation Set ${programKind} programs must be an array`,
			);
		for (const candidate of programs) {
			const program = record(candidate, `${programKind} program`);
			const entries =
				programKind === "normalizer" ? program.steps : program.assignments;
			if (!Array.isArray(entries))
				invalid(
					`Collection Operation Set ${programKind} entries must be an array`,
				);
			for (const entryValue of entries) {
				const entry = record(entryValue, `${programKind} entry`);
				validateFieldPath(
					collection,
					path(entry.target, `${programKind} target`),
					`${value.name}.${String(program.operation)}`,
				);
				if (programKind === "normalizer") {
					const expression = record(entry.expression, "normalizer expression");
					validateFieldPath(
						collection,
						path(expression.source, "normalizer source"),
						`${value.name}.${String(program.operation)}`,
					);
				}
			}
		}
	}
	return { value, collection, members };
}

function origin(item: EvaluatedExport, member: OperationMember): string {
	return `${item.logicalPath}#${item.exportName}.${member}`;
}

export function projectCollectionOperationSets(
	input: Readonly<{
		exports: readonly EvaluatedExport[];
		resources: readonly NormalizedResource[];
		schema: unknown;
		data: unknown;
	}>,
): Readonly<{
	sets: Readonly<{
		format: "questpie.collection-operation-set-projections";
		version: 1;
		sets: readonly RecordValue[];
	}>;
	normalizers: Readonly<{
		format: "questpie.field-normalizer-programs";
		version: 1;
		programs: readonly RecordValue[];
	}>;
	serverValues: Readonly<{
		format: "questpie.server-value-programs";
		version: 1;
		programs: readonly RecordValue[];
	}>;
	programs: CollectionOperationProgramsV1;
	origins: readonly RecordValue[];
}> {
	const resources = new Map(
		input.resources.map((resource) => [resource.identity, resource]),
	);
	const identities = new Map(
		input.resources.map((resource) => [resource.identity, resource.origin]),
	);
	const sets: RecordValue[] = [];
	const normalizers: RecordValue[] = [];
	const serverValues: RecordValue[] = [];
	const operationPrograms: CollectionOperationProgramV1[] = [];
	const origins: RecordValue[] = [];
	for (const item of operationSetExports(input.exports).toSorted(
		compareSetExports,
	)) {
		const { value, members } = validateSet(item, resources);
		const name = string(value.name, "Collection Operation Set name");
		const target = string(value.target, "Collection Operation Set target");
		const policy = string(value.policy, "Collection Operation Set Policy");
		const normalizerByOperation = new Map<string, RecordValue>();
		for (const candidate of value.normalizers as readonly unknown[]) {
			const program = record(candidate, "normalizer program");
			const projected = {
				artifact: "questpie.field-normalizer-program",
				version: 1,
				target,
				operation: program.operation,
				steps: program.steps,
				capabilities: [],
			};
			normalizerByOperation.set(String(program.operation), projected);
			normalizers.push(projected);
		}
		const serverValueByOperation = new Map<string, RecordValue>();
		for (const candidate of value.serverValues as readonly unknown[]) {
			const program = record(candidate, "server-value program");
			const projected = {
				artifact: "questpie.server-value-program",
				version: 1,
				target,
				operation: program.operation,
				assignments: program.assignments,
				capabilities: [],
			};
			serverValueByOperation.set(String(program.operation), projected);
			serverValues.push(projected);
		}
		const collection = resources.get(target)!;
		const constraints = collection.contract
			.constraints as readonly RecordValue[];
		const primary = constraints
			.map((entry) => record(entry.contract, "Collection Constraint"))
			.find((contract) => contract.kind === "primaryKey");
		if (!primary || !Array.isArray(primary.fields))
			invalid(`${target} has no primary key for Collection Operations`);
		const keyFields = (primary.fields as readonly unknown[]).map((field) =>
			path(field, `${target} primary key`),
		);
		const children = memberOrder.flatMap((member) => {
			if (!members.has(member)) return [];
			const memberContract = members.get(member)!;
			const kind = member === "list" || member === "get" ? "query" : "mutation";
			const mode = kind === "query" ? "readSnapshot" : "writeTransaction";
			const identity = `${kind}:${name}.${member}`;
			const previous = identities.get(identity);
			if (previous)
				throw new CompilerDiagnosticError(
					"QP-COMPOSE-002",
					"duplicateResourceIdentity",
					`${identity} has more than one Owner`,
					{
						origins: [
							previous,
							{
								logicalPath: item.logicalPath,
								exportName: item.exportName,
								member,
								span: item.memberSpans[member] ?? item.span,
							},
						],
					},
				);
			identities.set(identity, {
				logicalPath: item.logicalPath,
				exportName: item.exportName,
				packageId: item.packageId,
				span: item.memberSpans[member] ?? item.span,
				memberSpans: {},
			});
			const normalizer = normalizerByOperation.get(member) ?? null;
			const serverValue = serverValueByOperation.get(member) ?? null;
			const rawTemplate =
				member === "list"
					? normalizeDataQueryTemplate(memberContract.templateInput, {
							schemaProjectionDigest: digest(
								"questpie-schema-projection-v1",
								input.schema,
							),
							dataContractProjectionDigest: digest(
								"questpie-data-contract-projection-v1",
								input.data,
							),
						})
					: null;
			const limits =
				kind === "query"
					? {
							inputBytes: 65_536,
							resultBytes: 1_048_576,
							rowsRead: 10_000,
							durationMilliseconds: 5_000,
						}
					: {
							inputBytes: 65_536,
							resultBytes: 1_048_576,
							rowsWritten: 100,
							durationMilliseconds: 5_000,
						};
			operationPrograms.push({
				identity: identity as CollectionOperationProgramV1["identity"],
				kind,
				mode,
				target: target as `collection:${string}`,
				member,
				policy: policy as `policy:${string}`,
				keyFields: member === "create" || member === "list" ? [] : keyFields,
				callerInputFields: (
					(memberContract.inputPaths ?? []) as readonly unknown[]
				).map((field) => path(field, `${identity} caller input`)),
				selectedFieldPaths: (
					(memberContract.selectionPaths ?? []) as readonly unknown[]
				).map((field) => path(field, `${identity} selection`)),
				dataQuery: rawTemplate,
				dataQueryDigest:
					rawTemplate === null
						? null
						: digest("questpie-data-query-template-v1", rawTemplate),
				normalizerProgramDigest:
					normalizer === null
						? null
						: digest("questpie-field-normalizer-program-v1", normalizer),
				serverValueProgramDigest:
					serverValue === null
						? null
						: digest("questpie-server-value-program-v1", serverValue),
				outputCardinality:
					member === "list"
						? "many"
						: member === "create"
							? "one"
							: "optionalOne",
				limits,
			});
			return [
				{
					member,
					identity,
					owner: identity,
					kind,
					mode,
					engine: "operationEngine:v1",
					policy,
					inputCodec: `operation:${name}.${member}:input`,
					outputCodec: `operation:${name}.${member}:output`,
					errors: [],
					exposure: { direct: true, network: value.network === true },
					limits,
					observation: "operationEngine:v1",
					executableSlot: `slot:${kind}:${name}.${member}:generated`,
					origin: origin(item, member),
				},
			];
		});
		sets.push({
			artifact: "questpie.collection-operation-set-projection",
			version: 1,
			authoringIdentity: null,
			target,
			name,
			network: value.network === true,
			children,
		});
		origins.push({
			kind: "collectionOperationSet",
			target,
			name,
			establishedAt: {
				kind: "export",
				packageId: item.packageId,
				path: item.logicalPath,
				exportName: item.exportName,
				span: item.span,
			},
			members: children.map((child) => ({
				identity: child.identity,
				member: child.member,
				span: item.memberSpans[String(child.member)] ?? item.span,
			})),
		});
	}
	normalizers.sort((left, right) =>
		compareAscii(
			`${left.target}\0${left.operation}`,
			`${right.target}\0${right.operation}`,
		),
	);
	serverValues.sort((left, right) =>
		compareAscii(
			`${left.target}\0${left.operation}`,
			`${right.target}\0${right.operation}`,
		),
	);
	operationPrograms.sort((left, right) =>
		compareAscii(left.identity, right.identity),
	);
	return {
		sets: {
			format: "questpie.collection-operation-set-projections",
			version: 1,
			sets,
		},
		normalizers: {
			format: "questpie.field-normalizer-programs",
			version: 1,
			programs: normalizers,
		},
		serverValues: {
			format: "questpie.server-value-programs",
			version: 1,
			programs: serverValues,
		},
		programs: {
			format: "questpie.collection-operation-programs",
			version: 1,
			operations: operationPrograms,
		},
		origins,
	};
}
