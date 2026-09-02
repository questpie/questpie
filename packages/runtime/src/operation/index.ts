import {
	decodeRuntimeCodec,
	encodeRuntimeCodec,
	type RuntimeCodec,
	RuntimeCodecError,
} from "../codec";
import { CommittedResultUnavailable } from "./committed-result-unavailable";

type OperationKind = "mutation" | "query";

function closePublicErrorProperties(
	error: Error,
	allowed: ReadonlySet<string>,
): void {
	for (const key of Object.getOwnPropertyNames(error))
		if (!allowed.has(key))
			delete (error as unknown as Record<string, unknown>)[key];
}

export interface RuntimeExecutableBinding<View> {
	readonly identity: string;
	readonly kind: OperationKind;
	readonly slot: "handler";
	readonly runtimeGraphDigest: string;
	readonly bundleExport: string;
	readonly execute: (
		input: Readonly<{
			input: unknown;
			ctx: View;
		}>,
	) => unknown | Promise<unknown>;
	readonly definition: Readonly<{
		name: string;
		handler: RuntimeExecutableBinding<View>["execute"];
		errors?: Readonly<Record<string, unknown>>;
	}>;
}

export class DeclaredOperationError extends Error {
	constructor(
		readonly code: string,
		readonly status: number,
		readonly payload: unknown = null,
	) {
		super(code);
		closePublicErrorProperties(this, new Set(["code", "status", "payload"]));
	}
	get message(): string {
		return this.code;
	}
}

export const canonicalOperationFailures = Object.freeze({
	DEADLINE_EXCEEDED: Object.freeze({ status: 408, retryable: true }),
	INTERNAL: Object.freeze({ status: 500, retryable: false }),
	NOT_FOUND: Object.freeze({ status: 404, retryable: false }),
	PROTOCOL_UNSUPPORTED: Object.freeze({ status: 400, retryable: false }),
	RESOURCE_LIMIT: Object.freeze({ status: 429, retryable: true }),
	RUNTIME_UNAVAILABLE: Object.freeze({ status: 503, retryable: true }),
	UNAUTHENTICATED: Object.freeze({ status: 401, retryable: false }),
});

export type OperationFailureCode = keyof typeof canonicalOperationFailures;

export function canonicalOperationFailure(code: string): Readonly<{
	code: OperationFailureCode;
	status: number;
	retryable: boolean;
}> {
	const canonicalCode = Object.hasOwn(canonicalOperationFailures, code)
		? (code as OperationFailureCode)
		: "INTERNAL";
	return Object.freeze({
		code: canonicalCode,
		...canonicalOperationFailures[canonicalCode],
	});
}

export function operationFailureStatus(
	code: OperationFailureCode | "COMMITTED_RESULT_UNAVAILABLE",
): number {
	if (code === "COMMITTED_RESULT_UNAVAILABLE") return 500;
	return canonicalOperationFailures[code].status;
}

export class OperationFailure extends Error {
	constructor(
		readonly code: OperationFailureCode,
		readonly retryable = canonicalOperationFailures[code].retryable,
	) {
		super(code);
		closePublicErrorProperties(this, new Set(["code", "retryable"]));
	}
	get message(): string {
		return this.code;
	}
}

export type OperationAdmission = "authenticated" | "public" | "system";

export class OperationAdmissionError extends Error {
	constructor(readonly code: "forbidden" | "unauthenticated") {
		super(code);
		this.name = "OperationAdmissionError";
	}
}

export function assertOperationAdmission(
	admission: OperationAdmission,
	facts: Readonly<{
		authority: Readonly<{ kind: "ordinary" | "system" }>;
		principal: Readonly<{ kind: "anonymous" | "service" | "user" }>;
	}>,
): void {
	if (admission === "public") return;
	if (admission === "authenticated") {
		if (facts.principal.kind !== "anonymous") return;
		throw new OperationAdmissionError("unauthenticated");
	}
	if (facts.authority.kind === "system") return;
	throw new OperationAdmissionError("forbidden");
}

export function normalizeOperationError(
	error: unknown,
): OperationFailure | DeclaredOperationError | CommittedResultUnavailable {
	if (
		error instanceof OperationFailure ||
		error instanceof DeclaredOperationError ||
		error instanceof CommittedResultUnavailable
	)
		return error;
	return new OperationFailure("INTERNAL");
}

function decode(codec: RuntimeCodec, value: unknown): unknown {
	try {
		return decodeRuntimeCodec(codec, value);
	} catch (error) {
		if (error instanceof RuntimeCodecError)
			throw new OperationFailure("PROTOCOL_UNSUPPORTED");
		throw error;
	}
}

export type PreparedOperation<View> = Readonly<{
	admission?: OperationAdmission;
	binding: RuntimeExecutableBinding<View>;
	inputCodec: RuntimeCodec;
	output: RuntimeCodec;
	declaredErrors: readonly RuntimeDeclaredErrorContract[];
	issueMappings?: RuntimeIssueMappings;
	input: unknown;
}>;

export type RuntimeIssueMappings = Readonly<
	Record<string, Readonly<Record<string, string>>>
>;

export function mapCollectionIssueToDeclaredError<View>(
	operation: PreparedOperation<View>,
	issueIdentity: string,
): DeclaredOperationError {
	const mappings = operation.issueMappings;
	if (
		mappings !== undefined &&
		(typeof mappings !== "object" ||
			mappings === null ||
			Array.isArray(mappings))
	)
		throw new OperationFailure("INTERNAL");
	const targets: string[] = [];
	for (const [collection, issues] of Object.entries(mappings ?? {})) {
		if (typeof issues !== "object" || issues === null || Array.isArray(issues))
			throw new OperationFailure("INTERNAL");
		const collectionName = collection.startsWith("collection:")
			? collection.slice("collection:".length)
			: "";
		if (
			collectionName.length === 0 ||
			!issueIdentity.startsWith(`issue:${collectionName}/`)
		)
			continue;
		const target = issues[issueIdentity];
		if (target !== undefined) {
			if (typeof target !== "string") throw new OperationFailure("INTERNAL");
			targets.push(target);
		}
	}
	const target = targets.length === 1 ? targets[0] : undefined;
	const declared = operation.declaredErrors.find(
		(error) => error.key === target && error.payload === null,
	);
	if (!declared) throw new OperationFailure("INTERNAL");
	return new DeclaredOperationError(declared.code, declared.status);
}

export type RuntimeDeclaredErrorContract = Readonly<{
	key: string;
	code: string;
	status: number;
	payload: RuntimeCodec | null;
}>;

export type RuntimeOperationContract = Readonly<{
	admission?: OperationAdmission;
	limits?: Readonly<{
		inputBytes: number;
		resultBytes: number;
		durationMilliseconds: number;
	}>;
	identity: string;
	input: RuntimeCodec;
	output: RuntimeCodec;
	declaredErrors: readonly RuntimeDeclaredErrorContract[];
	issueMappings?: RuntimeIssueMappings;
}>;

export function encodeDeclaredOperationError<View>(
	operation: PreparedOperation<View>,
	error: DeclaredOperationError,
): Readonly<{ code: string; status: number; payload: unknown }> {
	const contract = operation.declaredErrors.find(
		(candidate) => candidate.code === error.code,
	);
	if (!contract || contract.status !== error.status)
		throw new OperationFailure("INTERNAL");
	try {
		if (contract.payload === null) {
			if (error.payload !== null) throw new OperationFailure("INTERNAL");
			return Object.freeze({
				code: contract.code,
				status: contract.status,
				payload: null,
			});
		}
		return Object.freeze({
			code: contract.code,
			status: contract.status,
			payload: encodeRuntimeCodec(
				contract.payload,
				error.payload,
				`$declaredError.${contract.key}.payload`,
			),
		});
	} catch (caught) {
		if (caught instanceof OperationFailure) throw caught;
		if (caught instanceof RuntimeCodecError)
			throw new OperationFailure("INTERNAL");
		throw caught;
	}
}

export interface OperationEngine<View> {
	prepare(identity: string, input: unknown): PreparedOperation<View>;
	decodeResult(operation: PreparedOperation<View>, value: unknown): unknown;
	invokePrepared(
		operation: PreparedOperation<View>,
		ctx: View,
	): Promise<unknown>;
}

export function createOperationEngine<View>(
	bindings: readonly RuntimeExecutableBinding<View>[],
	contracts: readonly RuntimeOperationContract[],
): OperationEngine<View> {
	const operations = new Map(
		bindings.map((binding) => [binding.identity, binding]),
	);
	const codecs = new Map(
		contracts.map((contract) => [contract.identity, contract]),
	);
	if (
		operations.size !== bindings.length ||
		codecs.size !== contracts.length ||
		operations.size !== codecs.size ||
		[...operations.keys()].some((identity) => !codecs.has(identity))
	)
		throw new TypeError(
			"Runtime operation contract does not match executable binding",
		);
	return Object.freeze({
		prepare: (identity: string, input: unknown) => {
			const operation = operations.get(identity);
			const contract = codecs.get(identity);
			if (!operation || !contract) throw new OperationFailure("NOT_FOUND");
			return Object.freeze({
				admission: contract.admission,
				binding: operation,
				inputCodec: contract.input,
				output: contract.output,
				declaredErrors: contract.declaredErrors,
				...(contract.issueMappings
					? { issueMappings: contract.issueMappings }
					: {}),
				input: decode(contract.input, input),
			});
		},
		decodeResult: (operation: PreparedOperation<View>, value: unknown) =>
			decode(operation.output, value),
		invokePrepared: async (operation: PreparedOperation<View>, ctx: View) => {
			const result = await operation.binding.execute({
				input: operation.input,
				ctx,
			});
			return decode(operation.output, result);
		},
	});
}

export { readBoundedRequestBody } from "./body";
export { isOperationCallId, isPostgresTransactionId } from "./call-identity";
export {
	CommittedResultUnavailable,
	type CommittedResultUnavailablePayload,
} from "./committed-result-unavailable";
export { bindIngressPrincipal, readIngressPrincipal } from "./ingress";
