import type { RuntimeIssueMappings } from "../operation";
import type { PostgresParameter } from "../postgres/contract";
import {
	createCollectionExecutionScope,
	executeCollectionStatement,
	type CollectionExecutionBudget,
} from "./collection-budget";
import { createCollectionDeleteExecutor } from "./collection-delete";
import { createCollectionGetExecutor } from "./collection-get";
import {
	assertAllowedCollectionPaths as allowedPaths,
	assertDisjointCollectionPaths as rejectOverlap,
	assertRequiredCollectionPaths as requirePaths,
} from "./collection-input";
import { createCollectionLifecycleCheckExecutor } from "./collection-lifecycle-check";
import {
	createCollectionListAccess,
	type CollectionListResult,
} from "./collection-list";
import {
	decodeMutationFieldInput,
	decodeMutationFieldResult,
	type MutationFieldCodecV1,
	validateMutationFieldScalars as validateScalars,
} from "./field-codec";
import {
	hasMutationValueAt as hasValueAt,
	mutationLeafPaths as inputPaths,
	mutationPathKey as pathKey,
	setMutationValueAt as setPath,
	mutationValueAt as valueAt,
	type MutationFieldPath,
} from "./field-path";
import * as lifecycleRuntime from "./lifecycle";
import { normalizedCallerInput } from "./normalized-caller-input";
import type {
	LinkedPostgresCollectionOperationPlanV1,
	LinkedPostgresCollectionOperationPlansV1,
	LinkedPostgresCreateOperationPlanV1,
	LinkedPostgresDeleteOperationPlanV1,
	LinkedPostgresGetOperationPlanV1,
	LinkedPostgresUpdateOperationPlanV1,
} from "./postgres-program";
import type { LinkedCollectionMutationProgramsV1 } from "./program";

type Row = Readonly<Record<string, unknown>>;
type Path = MutationFieldPath;
type Parameter = LinkedPostgresGetOperationPlanV1["lock"]["parameters"][number];
type ExecutionFactParameter = Extract<Parameter, { kind: "executionFact" }>;
type Result = LinkedPostgresGetOperationPlanV1["read"]["result"][number];
type CollectionLeaf =
	| LinkedPostgresGetOperationPlanV1["lock"]
	| LinkedPostgresGetOperationPlanV1["read"]
	| LinkedPostgresCreateOperationPlanV1["fieldAuthority"]["checks"][number]
	| NonNullable<LinkedPostgresCreateOperationPlanV1["candidateValidation"]>
	| NonNullable<LinkedPostgresCreateOperationPlanV1["candidatePolicyCheck"]>
	| LinkedPostgresCreateOperationPlanV1["write"]
	| LinkedPostgresUpdateOperationPlanV1["lock"]
	| LinkedPostgresUpdateOperationPlanV1["candidateValidation"]
	| NonNullable<LinkedPostgresUpdateOperationPlanV1["candidatePolicyCheck"]>
	| LinkedPostgresUpdateOperationPlanV1["fieldAuthority"]["checks"][number]
	| LinkedPostgresUpdateOperationPlanV1["write"]
	| LinkedPostgresDeleteOperationPlanV1["lock"]
	| LinkedPostgresDeleteOperationPlanV1["write"];
export type ExecuteCollectionLeaf = (
	leaf: CollectionLeaf,
	parameters: readonly PostgresParameter[],
) => Promise<readonly Row[]>;
export type TransactionQuery = (
	statement: string,
	parameters?: readonly unknown[],
) => Promise<readonly Row[]>;
export type ExecutionFacts = Readonly<{
	principal: Readonly<{ id: string; kind: string }>;
	authority: Readonly<{ kind: string }>;
	tenant: Readonly<{ id: string }>;
	signal?: AbortSignal;
}>;
function unavailable(): never {
	throw new TypeError("Collection operation is unavailable");
}
function record(value: unknown, label: string): Row {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${label} must be an object`);
	return value as Row;
}
function exactRequestWithOptionalKeys(
	value: unknown,
	required: readonly string[],
	optional: readonly string[],
	label: string,
): Row {
	const request = record(value, label);
	const keys = Object.keys(request);
	if (
		required.some((key) => !Object.hasOwn(request, key)) ||
		keys.some((key) => !required.includes(key) && !optional.includes(key))
	)
		throw new TypeError(`${label} must have exactly the compiled keys`);
	return request;
}

function exactPaths(
	actual: readonly Path[],
	expected: readonly Path[],
	label: string,
) {
	const actualKeys = actual.map(pathKey).sort();
	const expectedKeys = expected.map(pathKey).sort();
	if (
		actualKeys.length !== expectedKeys.length ||
		expectedKeys.some((key, index) => key !== actualKeys[index])
	)
		throw new TypeError(`${label} must have exactly the compiled Fields`);
}

function inputField(
	value: unknown,
	codec: MutationFieldCodecV1,
	nullable: boolean,
): PostgresParameter {
	return decodeMutationFieldInput(value, codec, nullable);
}

function decodeRow(
	row: Row,
	result: readonly Result[],
	resultValuesDecoded: boolean,
) {
	const output: Record<string, unknown> = {};
	for (const field of result) {
		if (field.guardColumn !== undefined) {
			const guard = row[field.guardColumn];
			if (guard === false) continue;
			if (guard !== true)
				throw new TypeError("PostgreSQL returned an invalid Field guard");
		}
		const value = row[field.column];
		setPath(
			output,
			field.path,
			value === null && field.nullable
				? null
				: resultValuesDecoded
					? value
					: decodeMutationFieldResult(value, field.codec),
		);
	}
	return Object.freeze(output);
}

function executionFact(
	parameter: ExecutionFactParameter,
	facts: ExecutionFacts,
	operationTime: Date,
): PostgresParameter {
	const key = `${parameter.source}.${parameter.path.join(".")}`;
	if (key === "authority.kind") return facts.authority.kind;
	if (key === "principal.id") return facts.principal.id;
	if (key === "principal.kind") return facts.principal.kind;
	if (key === "tenant.id") return facts.tenant.id;
	if (key === "operationTime.") return new Date(operationTime.getTime());
	throw new TypeError(
		"Compiled Collection plan references an invalid execution fact",
	);
}

function bind(
	parameters: readonly Parameter[],
	values: Readonly<{
		callerInput?: Row;
		trustedValues?: Row;
		key?: Row;
		expected?: Row;
		candidate?: Row;
	}>,
	facts: ExecutionFacts,
	operationTime: Date,
	nullableByPath: ReadonlyMap<string, boolean> = new Map(),
): readonly PostgresParameter[] {
	return parameters.map((parameter, index) => {
		if (parameter.position !== index + 1)
			throw new TypeError("Compiled Collection parameters are not positional");
		if (parameter.kind === "literal") return parameter.value;
		if (parameter.kind === "executionFact")
			return executionFact(parameter, facts, operationTime);
		if (
			parameter.kind === "callerInputPresent" ||
			parameter.kind === "patchPresent"
		) {
			if (!values.callerInput)
				throw new TypeError("Compiled Collection patch has no value source");
			return hasValueAt(values.callerInput, parameter.path);
		}
		if (parameter.kind === "trustedValuePresent")
			return values.trustedValues
				? hasValueAt(values.trustedValues, parameter.path)
				: false;
		if (parameter.kind === "expectedPresent")
			return values.expected
				? hasValueAt(values.expected, parameter.path)
				: false;
		const source =
			parameter.kind === "key"
				? values.key
				: parameter.kind === "candidateValue"
					? values.candidate
					: parameter.kind === "expectedValue"
						? values.expected
						: parameter.kind === "trustedValue"
							? values.trustedValues
							: values.callerInput;
		if (
			(parameter.kind === "trustedValue" ||
				parameter.kind === "expectedValue") &&
			!source
		)
			return null;
		if (!source)
			throw new TypeError("Compiled Collection parameter has no value source");
		if (
			(parameter.kind === "callerInput" ||
				parameter.kind === "patchValue" ||
				parameter.kind === "trustedValue" ||
				parameter.kind === "expectedValue") &&
			!hasValueAt(source, parameter.path)
		)
			return null;
		if (parameter.codec === "boolean")
			throw new TypeError("Compiled Collection presence parameter is invalid");
		return inputField(
			valueAt(source, parameter.path, "Collection value"),
			parameter.codec,
			nullableByPath.get(pathKey(parameter.path)) === true,
		);
	});
}

export function createCollectionMutationData(
	input: Readonly<{
		plans: LinkedPostgresCollectionOperationPlansV1;
		executeLeaf: ExecuteCollectionLeaf;
		facts: ExecutionFacts;
		operationTime: Date;
		consumeRows(count: number): void;
		resultValuesDecoded: boolean;
		lifecycleDoom?: lifecycleRuntime.CollectionLifecycleDoom;
		executionBudget?: CollectionExecutionBudget;
		issueMappings?: RuntimeIssueMappings;
		callId?: string;
		collectionOperations?: LinkedCollectionMutationProgramsV1;
		acceptJob?(identity: string, request: unknown): Promise<unknown>;
		executeList?(
			identity: string,
			request: unknown,
		): Promise<CollectionListResult>;
	}>,
) {
	const scope = createCollectionExecutionScope({
		doom: input.lifecycleDoom,
		budget: input.executionBudget,
		signal: input.facts.signal,
		consumeRows: input.consumeRows,
	});
	const lifecycleDoom = scope.doom;
	const executionBudget = scope.budget;
	const consumeRows = scope.consumeRows;
	const execute = async (
		plan: LinkedPostgresCollectionOperationPlanV1,
		started: number,
		leaf: CollectionLeaf,
		parameters: readonly PostgresParameter[],
	) =>
		executeCollectionStatement({
			budget: executionBudget,
			started,
			durationMilliseconds: plan.limits.durationMilliseconds,
			use: () => input.executeLeaf(leaf, parameters),
		});
	const keyedRowAccess = {
		execute,
		bind: (parameters: readonly Parameter[], key: Row) =>
			bind(parameters, { key }, input.facts, input.operationTime),
		decode: (row: Row, result: readonly Result[]) =>
			decodeRow(row, result, input.resultValuesDecoded),
		consumeRows,
	};
	const executeGet = createCollectionGetExecutor(keyedRowAccess);
	const executeDelete = createCollectionDeleteExecutor(keyedRowAccess);
	const lists = createCollectionListAccess({
		operations: input.collectionOperations,
		execute: input.executeList,
		budget: executionBudget,
		consumeRows,
	});
	type CollectionData = Readonly<
		Record<
			string,
			Readonly<Record<string, (request: unknown) => Promise<unknown>>>
		>
	>;
	let data: CollectionData;
	const lifecycleCheck = createCollectionLifecycleCheckExecutor({
		plans: input.plans,
		operationTime: input.operationTime,
		doom: lifecycleDoom,
		budget: executionBudget,
		executeGet,
		executeList: lists.lifecycle,
		executeWrite: async (identity, request) => {
			const plan = input.plans.byIdentity.get(identity);
			if (!plan || (plan.member !== "create" && plan.member !== "update"))
				throw new TypeError("Lifecycle write capability is unavailable");
			const collection = data[plan.target.slice("collection:".length)];
			const executeMember = collection?.[plan.member];
			if (!executeMember)
				throw new TypeError("Lifecycle write capability is withheld");
			return executeMember(request);
		},
		executeJob: input.acceptJob,
		executePolicy: (plan, check, values, started) =>
			execute(
				plan,
				started,
				check,
				bind(
					check.parameters,
					values,
					input.facts,
					input.operationTime,
					new Map(
						plan.candidate.fields.map(
							(field) => [pathKey(field.path), field.nullable] as const,
						),
					),
				),
			),
	});
	const collections = new Map<
		string,
		{
			create?: LinkedPostgresCreateOperationPlanV1;
			get?: LinkedPostgresGetOperationPlanV1;
			update?: LinkedPostgresUpdateOperationPlanV1;
			delete?: LinkedPostgresDeleteOperationPlanV1;
		}
	>();
	for (const plan of input.plans.plans) {
		const name = plan.target.slice("collection:".length);
		const members = collections.get(name) ?? {};
		const admitted = lifecycleRuntime.collectionLifecycleProgramAdmitted(
			plan.operation.lifecycleProgram,
			input.issueMappings,
		);
		if (plan.member === "create" && admitted) members.create = plan;
		else if (plan.member === "update" && admitted) members.update = plan;
		else if (plan.member === "get") members.get = plan;
		else if (plan.member === "delete" && admitted) members.delete = plan;
		collections.set(name, members);
	}
	data = Object.freeze(
		Object.fromEntries(
			[...collections].map(([name, plans]) => [
				name,
				Object.freeze({
					...(plans.get
						? {
								get: async (rawRequest: unknown) =>
									executeGet(plans.get!, rawRequest, performance.now()),
							}
						: {}),
					...(plans.create
						? {
								create: async (rawRequest: unknown) => {
									const plan = plans.create!;
									const started = performance.now();
									const request = exactRequestWithOptionalKeys(
										rawRequest,
										["input"],
										["values"],
										"Collection create request",
									);
									const callerInput = record(
										request.input,
										"Collection create input",
									);
									const candidateInput = normalizedCallerInput(
										request,
										callerInput,
									);
									const callerPaths = inputPaths(
										callerInput,
										"Collection create input",
										plan.operation.callerInputFields,
									);
									allowedPaths(
										callerPaths,
										plan.operation.callerInputFields,
										"Collection create input",
									);
									const trustedValues = Object.hasOwn(request, "values")
										? record(request.values, "Collection create values")
										: undefined;
									const trustedPaths = trustedValues
										? inputPaths(
												trustedValues,
												"Collection create values",
												plan.operation.trustedValueFields,
											)
										: [];
									allowedPaths(
										trustedPaths,
										plan.operation.trustedValueFields,
										"Collection create values",
									);
									rejectOverlap(
										callerPaths,
										trustedPaths,
										"Collection create input and values",
									);
									requirePaths(
										[...callerPaths, ...trustedPaths],
										plan.candidate.fields
											.filter(({ requiredInput }) => requiredInput)
											.map(({ path }) => path),
										"Collection create candidate",
									);
									const nullableByPath = new Map(
										plan.candidate.fields.map(
											(field) => [pathKey(field.path), field.nullable] as const,
										),
									);
									validateScalars(
										callerInput,
										callerPaths,
										plan.candidate.fields,
									);
									if (trustedValues)
										validateScalars(
											trustedValues,
											trustedPaths,
											plan.candidate.fields,
										);
									const authorityValues = { callerInput, trustedValues };
									for (const check of plan.fieldAuthority.checks) {
										if (
											!callerPaths.some(
												(path) => pathKey(path) === pathKey(check.path),
											)
										)
											continue;
										const rows = await execute(
											plan,
											started,
											check,
											bind(
												check.parameters,
												authorityValues,
												input.facts,
												input.operationTime,
												nullableByPath,
											),
										);
										if (rows.length === 0) unavailable();
										if (rows.length !== 1)
											throw new TypeError(
												"Collection Field authority returned multiple rows",
											);
									}
									const lifecycle = plan.operation.lifecycleProgram;
									const normalized = lifecycle
										? await lifecycleRuntime.normalizeCollectionLifecycleLanes(
												lifecycle,
												candidateInput,
												trustedValues,
												executionBudget,
												lifecycleDoom,
											)
										: { callerInput: candidateInput, trustedValues };
									const normalizedCaller = normalized.callerInput;
									const normalizedTrusted = normalized.trustedValues;
									validateScalars(
										normalizedCaller,
										callerPaths,
										plan.candidate.fields,
									);
									if (normalizedTrusted)
										validateScalars(
											normalizedTrusted,
											trustedPaths,
											plan.candidate.fields,
										);
									const candidateValues = {
										callerInput: normalizedCaller,
										trustedValues: normalizedTrusted,
									};
									let candidate: Row | undefined;
									if (lifecycle) {
										const validation = plan.candidateValidation;
										if (!validation)
											throw new TypeError("Lifecycle create is incomplete");
										const candidates = await execute(
											plan,
											started,
											validation,
											bind(
												validation.parameters,
												candidateValues,
												input.facts,
												input.operationTime,
												nullableByPath,
											),
										);
										if (candidates.length !== 1)
											throw new TypeError("Invalid lifecycle candidate count");
										candidate = decodeRow(
											candidates[0]!,
											validation.result,
											input.resultValuesDecoded,
										);
										if (
											!(await lifecycleCheck.execute(
												plan,
												candidate,
												null,
												undefined,
												started,
											))
										)
											unavailable();
									}
									const rows = await execute(
										plan,
										started,
										plan.write,
										bind(
											plan.write.parameters,
											{ ...candidateValues, candidate },
											input.facts,
											input.operationTime,
											nullableByPath,
										),
									);
									consumeRows(rows.length);
									if (rows.length === 0) unavailable();
									if (rows.length > plan.limits.rows || rows.length !== 1)
										throw new TypeError(
											"Collection create exceeded its row limit",
										);
									const written = decodeRow(
										rows[0]!,
										plan.write.result,
										input.resultValuesDecoded,
									);
									await lifecycleCheck.executeAfterWrite(
										plan,
										written,
										null,
										input.callId ?? "",
										started,
									);
									return written;
								},
							}
						: {}),
					...(plans.update
						? {
								update: async (rawRequest: unknown) => {
									const plan = plans.update!;
									const started = performance.now();
									const request = exactRequestWithOptionalKeys(
										rawRequest,
										["key"],
										["patch", "values", "expected"],
										"Collection update request",
									);
									const key = record(request.key, "Collection key");
									const patch = Object.hasOwn(request, "patch")
										? record(request.patch, "Collection update patch")
										: Object.freeze({});
									const candidatePatch = normalizedCallerInput(request, patch);
									exactPaths(
										inputPaths(key, "Collection key", plan.operation.keyFields),
										plan.operation.keyFields,
										"Collection key",
									);
									const suppliedPaths = inputPaths(
										patch,
										"Collection update patch",
										plan.operation.callerInputFields,
									);
									const trustedValues = Object.hasOwn(request, "values")
										? record(request.values, "Collection update values")
										: undefined;
									const trustedPaths = trustedValues
										? inputPaths(
												trustedValues,
												"Collection update values",
												plan.operation.trustedValueFields,
											)
										: [];
									const expected = Object.hasOwn(request, "expected")
										? record(request.expected, "Collection update expected")
										: undefined;
									const expectedPaths = expected
										? inputPaths(
												expected,
												"Collection update expected",
												plan.candidate.fields.map(({ path }) => path),
											)
										: [];
									if (suppliedPaths.length === 0 && trustedPaths.length === 0)
										throw new TypeError(
											"Collection update patch and values must not both be empty",
										);
									allowedPaths(
										suppliedPaths,
										plan.operation.callerInputFields,
										"Collection update patch",
									);
									allowedPaths(
										trustedPaths,
										plan.operation.trustedValueFields,
										"Collection update values",
									);
									rejectOverlap(
										suppliedPaths,
										trustedPaths,
										"Collection update patch and values",
									);
									if (expected)
										allowedPaths(
											expectedPaths,
											plan.candidate.fields.map(({ path }) => path),
											"Collection update expected",
										);
									const nullableByPath = new Map(
										plan.candidate.fields.map(
											(field) => [pathKey(field.path), field.nullable] as const,
										),
									);
									validateScalars(patch, suppliedPaths, plan.candidate.fields);
									if (trustedValues)
										validateScalars(
											trustedValues,
											trustedPaths,
											plan.candidate.fields,
										);
									if (expected)
										validateScalars(
											expected,
											expectedPaths,
											plan.candidate.fields,
										);
									const authorityValues = {
										key,
										callerInput: patch,
										trustedValues,
										expected,
									};
									const locked = await execute(
										plan,
										started,
										plan.lock,
										bind(
											plan.lock.parameters,
											authorityValues,
											input.facts,
											input.operationTime,
										),
									);
									if (locked.length === 0) return null;
									if (locked.length !== 1)
										throw new TypeError(
											"Collection update lock returned multiple rows",
										);
									const supplied = new Set(suppliedPaths.map(pathKey));
									for (const check of plan.fieldAuthority.checks) {
										if (!supplied.has(pathKey(check.path))) continue;
										const rows = await execute(
											plan,
											started,
											check,
											bind(
												check.parameters,
												authorityValues,
												input.facts,
												input.operationTime,
												nullableByPath,
											),
										);
										if (rows.length === 0) return null;
										if (rows.length !== 1)
											throw new TypeError(
												"Collection update Field authority returned multiple rows",
											);
									}
									const lifecycle = plan.operation.lifecycleProgram;
									const normalized = lifecycle
										? await lifecycleRuntime.normalizeCollectionLifecycleLanes(
												lifecycle,
												candidatePatch,
												trustedValues,
												executionBudget,
												lifecycleDoom,
											)
										: { callerInput: candidatePatch, trustedValues };
									validateScalars(
										normalized.callerInput,
										suppliedPaths,
										plan.candidate.fields,
									);
									if (normalized.trustedValues)
										validateScalars(
											normalized.trustedValues,
											trustedPaths,
											plan.candidate.fields,
										);
									const candidateValues = {
										...authorityValues,
										callerInput: normalized.callerInput,
										trustedValues: normalized.trustedValues,
									};
									const candidates = await execute(
										plan,
										started,
										plan.candidateValidation,
										bind(
											plan.candidateValidation.parameters,
											candidateValues,
											input.facts,
											input.operationTime,
											nullableByPath,
										),
									);
									if (candidates.length === 0) return null;
									if (candidates.length !== 1)
										throw new TypeError(
											"Collection update candidate validation returned multiple rows",
										);
									const candidate = decodeRow(
										candidates[0]!,
										plan.candidateValidation.result,
										input.resultValuesDecoded,
									);
									let current: Row | null = null;
									if (lifecycle) {
										const currentResult =
											plan.candidateValidation.currentResult;
										if (!currentResult)
											throw new TypeError(
												"Lifecycle update current candidate is incomplete",
											);
										current = decodeRow(
											candidates[0]!,
											currentResult,
											input.resultValuesDecoded,
										);
										if (
											!(await lifecycleCheck.execute(
												plan,
												candidate,
												current,
												key,
												started,
											))
										)
											return null;
									}
									const rows = await execute(
										plan,
										started,
										plan.write,
										bind(
											plan.write.parameters,
											candidateValues,
											input.facts,
											input.operationTime,
											nullableByPath,
										),
									);
									consumeRows(rows.length);
									if (rows.length === 0) return null;
									if (rows.length > plan.limits.rows || rows.length !== 1)
										throw new TypeError(
											"Collection update exceeded its row limit",
										);
									const written = decodeRow(
										rows[0]!,
										plan.write.result,
										input.resultValuesDecoded,
									);
									await lifecycleCheck.executeAfterWrite(
										plan,
										written,
										current,
										input.callId ?? "",
										started,
									);
									return written;
								},
							}
						: {}),
					...(plans.delete
						? {
								delete: async (rawRequest: unknown) =>
									executeDelete(plans.delete!, rawRequest, performance.now()),
							}
						: {}),
				}),
			]),
		),
	);
	return lists.bind(data);
}
