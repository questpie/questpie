import { principal, type Principal } from "questpie";

import { RuntimeActionPostHandlerResourceLimit } from "../action";
import {
	decodeRuntimeCodec,
	encodeRuntimeCodec,
	type RuntimeCodec,
	RuntimeCodecError,
} from "../codec";
import { awaitExecutionPhase } from "../execution";
import {
	canonicalOperationFailure,
	CommittedResultUnavailable,
	DeclaredOperationError,
	isOperationCallId,
	OperationFailure,
	type PreparedOperation,
	type RuntimeOperationContract,
} from "../operation";
import type { McpExecutionResult, McpToolBinding } from "./mcp";
import {
	classifyOperationCredentialFailure,
	encodeOperationResult,
	encodeOperationDeclaredOutcome,
} from "./operation-carrier";
import { isOperationAbort } from "./operation-error";

type JsonRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new OperationFailure("PROTOCOL_UNSUPPORTED");
	return value as JsonRecord;
}

function exact(value: JsonRecord, keys: readonly string[]): void {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	if (
		actual.length !== expected.length ||
		actual.some((key, index) => key !== expected[index])
	)
		throw new OperationFailure("PROTOCOL_UNSUPPORTED");
}

function decodeInvocationCodec<Value>(
	codec: RuntimeCodec,
	value: unknown,
	path: string,
): Value {
	try {
		return decodeRuntimeCodec<Value>(codec, value, path);
	} catch (error) {
		if (error instanceof RuntimeCodecError)
			throw new OperationFailure("PROTOCOL_UNSUPPORTED");
		throw error;
	}
}

function frameworkFailure(error: unknown, callId?: string): McpExecutionResult {
	const failure = canonicalOperationFailure(
		error instanceof OperationFailure ? error.code : "INTERNAL",
	);
	return {
		structuredContent: {
			...(callId === undefined ? {} : { callId }),
			error: {
				code: failure.code,
				retryable:
					error instanceof OperationFailure
						? error.retryable
						: failure.retryable,
			},
		},
		isError: true,
	};
}

export function createMcpOperationAdapter<ContextInput, View>(
	input: Readonly<{
		contextCodec: RuntimeCodec;
		operations: readonly RuntimeOperationContract[];
		maximumResponseBytes: number;
		prepare(identity: string, value: unknown): PreparedOperation<View>;
		resolvePrincipal(
			request: Request,
			signal: AbortSignal,
		): Promise<Principal | null>;
		execute(
			value: Readonly<{
				kind: McpToolBinding["kind"];
				identity: string;
				operation?: PreparedOperation<View>;
				operationInput: unknown;
				context: ContextInput;
				principal: Principal;
				callId: string;
				effectKey?: string;
				signal: AbortSignal;
				onCommitted(transactionId: string): void;
				onHandlerDispatch(): void;
			}>,
		): Promise<unknown>;
	}>,
): (
	value: Readonly<{
		arguments: unknown;
		identity: string;
		kind: McpToolBinding["kind"];
		request: Request;
		signal: AbortSignal;
		/**
		 * Already-resolved Principal from the ingress's own credential
		 * preflight (armed via `requireCredential`). When present, this
		 * function trusts it and skips its own `resolvePrincipal` call
		 * entirely, so the credential is resolved exactly once per request.
		 * When absent (preflight not armed, or no ingress preflight at all),
		 * behavior is unchanged: resolve here, as always.
		 */
		principal?: Principal;
	}>,
) => Promise<McpExecutionResult> {
	const contracts = new Map(
		input.operations.map((operation) => [operation.identity, operation]),
	);
	return async (invocation) => {
		let callId: string = crypto.randomUUID();
		let effectKey: string | undefined;
		let caller: Principal | null;
		try {
			const args = record(invocation.arguments);
			exact(
				args,
				invocation.kind === "mutation"
					? ["callId", "context", "input"]
					: invocation.kind === "action"
						? Object.hasOwn(args, "callId")
							? ["callId", "context", "effectKey", "input"]
							: ["context", "effectKey", "input"]
						: Object.hasOwn(args, "callId")
							? ["callId", "context", "input"]
							: ["context", "input"],
			);
			if (Object.hasOwn(args, "callId")) {
				if (!isOperationCallId(args.callId))
					throw new OperationFailure("PROTOCOL_UNSUPPORTED");
				callId = args.callId;
			}
			if (invocation.kind === "action") {
				effectKey = args.effectKey as string;
				if (!isOperationCallId(effectKey))
					throw new OperationFailure("PROTOCOL_UNSUPPORTED");
			}
			try {
				caller =
					invocation.principal ??
					(await awaitExecutionPhase(invocation.signal, () =>
						input.resolvePrincipal(invocation.request, invocation.signal),
					));
			} catch (error) {
				const code = classifyOperationCredentialFailure(
					error,
					invocation.signal,
				);
				if (code) throw new OperationFailure(code);
				throw error;
			}
			if (!caller || !principal.is(caller))
				throw new OperationFailure("UNAUTHENTICATED");
			const context = decodeInvocationCodec<ContextInput>(
				input.contextCodec,
				args.context,
				"$context",
			);
			const contract = contracts.get(invocation.identity);
			if (!contract) throw new OperationFailure("NOT_FOUND");
			let prepared: PreparedOperation<View> | undefined;
			let operationInput: unknown;
			if (invocation.kind === "action") {
				const decoded = decodeInvocationCodec(
					contract.input,
					args.input,
					"$input",
				);
				operationInput = encodeRuntimeCodec(contract.input, decoded);
			} else {
				prepared = input.prepare(invocation.identity, args.input);
				operationInput = args.input;
			}
			let committedTransaction: string | undefined;
			let actionDispatched = false;
			try {
				const result = await input.execute({
					kind: invocation.kind,
					identity: invocation.identity,
					...(prepared ? { operation: prepared } : {}),
					operationInput,
					context,
					principal: caller,
					callId,
					...(effectKey === undefined ? {} : { effectKey }),
					signal: invocation.signal,
					onCommitted: (transactionId) => {
						committedTransaction = transactionId;
					},
					onHandlerDispatch: () => {
						actionDispatched = true;
					},
				});
				const structuredContent = encodeOperationResult(
					contract.output,
					result,
					callId,
					input.maximumResponseBytes,
				);
				if (structuredContent === null)
					return frameworkFailure(
						new OperationFailure(
							"RESOURCE_LIMIT",
							invocation.kind !== "action",
						),
						callId,
					);
				return { structuredContent, isError: false };
			} catch (error) {
				if (
					error instanceof CommittedResultUnavailable ||
					(invocation.kind === "mutation" && committedTransaction !== undefined)
				)
					return {
						structuredContent: {
							callId,
							error: {
								code: "COMMITTED_RESULT_UNAVAILABLE",
								retryable: true,
								transactionId:
									error instanceof CommittedResultUnavailable
										? error.payload.transactionId
										: committedTransaction!,
							},
						},
						isError: true,
					};
				if (error instanceof DeclaredOperationError) {
					try {
						const declared = encodeOperationDeclaredOutcome(
							prepared ?? contract,
							error,
							callId,
						);
						return {
							structuredContent: declared.body,
							isError: true,
						};
					} catch {
						return frameworkFailure(new OperationFailure("INTERNAL"), callId);
					}
				}
				if (
					invocation.kind === "action" &&
					actionDispatched &&
					(invocation.signal.aborted || isOperationAbort(error))
				)
					return {
						structuredContent: {
							callId,
							error: {
								code: "ACTION_OUTCOME_AMBIGUOUS",
								retryable: false,
							},
						},
						isError: true,
					};
				if (error instanceof RuntimeActionPostHandlerResourceLimit)
					return frameworkFailure(error, callId);
				return frameworkFailure(error, callId);
			}
		} catch (error) {
			return frameworkFailure(error, callId);
		}
	};
}
