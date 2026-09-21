import type { Principal } from "questpie";

import { RuntimeActionPostHandlerResourceLimit } from "../action";
import {
	decodeRuntimeCodec,
	encodeRuntimeCodec,
	type RuntimeCodec,
	RuntimeCodecError,
} from "../codec";
import {
	CommittedResultUnavailable,
	DeclaredOperationError,
	OperationFailure,
	type PreparedOperation,
	readBoundedRequestBody,
	type RuntimeOperationContract,
} from "../operation";
import {
	decodeHttpIdentity as decodeIdentity,
	decodeHttpTimeout as decodeTimeout,
	createHttpExecutionControl,
	exactHttpKeys as exactKeys,
	httpFailure,
	httpJsonResponse as response,
	httpProtocolFailure as protocol,
	httpRecord as record,
	readHttpHeader as header,
	resolveHttpPrincipal,
} from "./http-carrier";
import {
	encodeOperationResult,
	encodeOperationDeclaredOutcome,
} from "./operation-carrier";
import { isOperationAbort } from "./operation-error";
import { parseJsonWithoutDuplicateKeys } from "./strict-json";

const MUTATION_PREFIX = "/_questpie/mutation/";
const ACTION_PREFIX = "/_questpie/action/";

function contentType(value: string | null): boolean {
	return (
		value !== null &&
		/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?$/iu.test(value)
	);
}

function failure(code: string, callId?: string, retryable?: boolean): Response {
	return httpFailure(code, { callId, retryable });
}

export function createCanonicalPostHttp<ContextInput, View>(
	input: Readonly<{
		application: string;
		clientContractDigest: string;
		httpContractDigest: string;
		maximumRequestBytes: number;
		maximumResponseBytes: number;
		contextCodec: RuntimeCodec;
		operations: readonly RuntimeOperationContract[];
		prepare(identity: string, value: unknown): PreparedOperation<View>;
		resolvePrincipal(
			request: Request,
			signal: AbortSignal,
		): Promise<Principal | null>;
		credentialChallenge?(request: Request): string | undefined;
		executeMutation(
			value: Readonly<{
				principal: Principal;
				context: ContextInput;
				operation: PreparedOperation<View>;
				callId: string;
				signal: AbortSignal;
				deadline?: number;
				onCommitted(transactionId: string): void;
			}>,
		): Promise<unknown>;
		executeAction(
			value: Readonly<{
				principal: Principal;
				context: ContextInput;
				identity: string;
				operationInput: unknown;
				effectKey: string;
				callId: string;
				signal: AbortSignal;
				timeoutMilliseconds?: number;
				deadline?: number;
				onHandlerDispatch(): void;
			}>,
		): Promise<unknown>;
		now(): number;
	}>,
): Readonly<{ fetch(request: Request): Promise<Response | null> }> {
	const operations = new Map(
		input.operations
			.filter(
				({ identity }) =>
					identity.startsWith("mutation:") || identity.startsWith("action:"),
			)
			.map((operation) => [operation.identity, operation]),
	);
	return Object.freeze({
		fetch: async (request: Request): Promise<Response | null> => {
			const url = new URL(request.url);
			const action = url.pathname.startsWith(ACTION_PREFIX);
			const prefix = action ? ACTION_PREFIX : MUTATION_PREFIX;
			if (!action && !url.pathname.startsWith(MUTATION_PREFIX)) return null;
			const requestStartedAt = input.now();
			if (request.signal.aborted) return failure("DEADLINE_EXCEEDED");
			if (request.method !== "POST" || url.search !== "")
				return failure("PROTOCOL_UNSUPPORTED");
			const name = url.pathname.slice(prefix.length);
			if (!/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/u.test(name))
				return failure("PROTOCOL_UNSUPPORTED");
			let callId: string;
			let effectKey: string | undefined;
			let timeout: number | undefined;
			try {
				const rawIdempotency = header(request, "Idempotency-Key");
				const rawEffect = header(request, "Effect-Key");
				const rawCallId = header(request, "Questpie-Call-Id");
				if (action) {
					if (rawEffect === null || rawIdempotency !== null) protocol();
					effectKey = decodeIdentity(rawEffect);
					callId =
						rawCallId === null
							? crypto.randomUUID()
							: decodeIdentity(rawCallId);
				} else {
					if (
						rawIdempotency === null ||
						rawEffect !== null ||
						rawCallId !== null
					)
						protocol();
					callId = decodeIdentity(rawIdempotency);
				}
				timeout = decodeTimeout(
					header(request, "Questpie-Timeout-Milliseconds"),
				);
			} catch {
				return failure("PROTOCOL_UNSUPPORTED");
			}
			const execution = createHttpExecutionControl({
				requestSignal: request.signal,
				requestStartedAt,
				...(timeout === undefined ? {} : { timeoutMilliseconds: timeout }),
				now: input.now,
			});
			try {
				const principalResolution = await resolveHttpPrincipal({
					request,
					signal: execution.signal,
					callId,
					resolvePrincipal: input.resolvePrincipal,
					credentialChallenge: input.credentialChallenge,
				});
				if (principalResolution.response) return principalResolution.response;
				const caller = principalResolution.caller;
				const contract = operations.get(
					`${action ? "action" : "mutation"}:${name}`,
				);
				if (!contract) return failure("NOT_FOUND", callId);
				let operationInput: unknown;
				let context: ContextInput;
				let prepared: PreparedOperation<View> | undefined;
				try {
					const compatibility = [
						header(request, "Questpie-Application"),
						header(request, "Questpie-Client-Contract"),
						header(request, "Questpie-Wire-Digest"),
					];
					if (
						compatibility.some((value) => value !== null) &&
						(compatibility[0] !== input.application ||
							compatibility[1] !== input.clientContractDigest ||
							compatibility[2] !== input.httpContractDigest)
					)
						protocol();
					if (!contentType(header(request, "content-type"))) protocol();
					const body = await readBoundedRequestBody(
						request,
						input.maximumRequestBytes,
						execution.signal,
					);
					if (execution.signal.aborted)
						return failure("DEADLINE_EXCEEDED", callId);
					if (body.kind === "tooLarge")
						return failure("RESOURCE_LIMIT", callId);
					if (body.kind === "invalid") protocol();
					const envelope = record(parseJsonWithoutDuplicateKeys(body.text));
					exactKeys(envelope, ["context", "input"]);
					context = decodeRuntimeCodec<ContextInput>(
						input.contextCodec,
						envelope.context,
						"$context",
					);
					if (action) {
						const decoded = decodeRuntimeCodec(
							contract.input,
							envelope.input,
							"$input",
						);
						operationInput = encodeRuntimeCodec(contract.input, decoded);
					} else {
						prepared = input.prepare(contract.identity, envelope.input);
						operationInput = envelope.input;
					}
				} catch {
					if (execution.signal.aborted)
						return failure("DEADLINE_EXCEEDED", callId);
					return failure("PROTOCOL_UNSUPPORTED", callId);
				}
				if (execution.signal.aborted)
					return failure("DEADLINE_EXCEEDED", callId);
				let committedResultUnavailable: CommittedResultUnavailable | undefined;
				let actionDispatched = false;
				try {
					const value = action
						? await input.executeAction({
								principal: caller,
								context,
								identity: contract.identity,
								operationInput,
								effectKey: effectKey!,
								callId,
								signal: execution.signal,
								...(timeout === undefined
									? {}
									: { timeoutMilliseconds: timeout }),
								...(execution.deadline === undefined
									? {}
									: { deadline: execution.deadline }),
								onHandlerDispatch: () => {
									actionDispatched = true;
								},
							})
						: await input.executeMutation({
								principal: caller,
								context,
								operation: prepared!,
								callId,
								signal: execution.signal,
								...(execution.deadline === undefined
									? {}
									: { deadline: execution.deadline }),
								onCommitted: (transactionId) => {
									committedResultUnavailable = new CommittedResultUnavailable(
										callId,
										transactionId,
										execution.signal.reason,
									);
								},
							});
					if (execution.signal.aborted && (!action || !actionDispatched))
						throw (
							committedResultUnavailable ??
							new OperationFailure("DEADLINE_EXCEEDED", true)
						);
					const body = encodeOperationResult(
						contract.output,
						value,
						callId,
						input.maximumResponseBytes,
					);
					if (body === null) return failure("RESOURCE_LIMIT", callId, !action);
					return response(body, 200);
				} catch (error) {
					if (error instanceof CommittedResultUnavailable && !action)
						return response(
							{
								callId,
								error: {
									code: "COMMITTED_RESULT_UNAVAILABLE",
									retryable: true,
									transactionId: error.payload.transactionId,
								},
							},
							500,
						);
					if (error instanceof DeclaredOperationError) {
						try {
							const declared = encodeOperationDeclaredOutcome(
								action ? contract : prepared!,
								error,
								callId,
							);
							return response(declared.body, declared.status);
						} catch {
							return failure("INTERNAL", callId);
						}
					}
					if (error instanceof RuntimeActionPostHandlerResourceLimit)
						return failure("RESOURCE_LIMIT", callId, false);
					if (
						action &&
						actionDispatched &&
						(execution.signal.aborted || isOperationAbort(error))
					)
						return response(
							{
								callId,
								error: {
									code: "ACTION_OUTCOME_AMBIGUOUS",
									retryable: false,
								},
							},
							500,
						);
					if (execution.signal.aborted)
						return failure("DEADLINE_EXCEEDED", callId);
					if (error instanceof OperationFailure)
						return failure(error.code, callId);
					if (error instanceof RuntimeCodecError)
						return failure("INTERNAL", callId);
					return failure("INTERNAL", callId);
				}
			} finally {
				execution.close();
			}
		},
	});
}
