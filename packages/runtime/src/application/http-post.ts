import { principal, type Principal } from "questpie";

import { RuntimeActionPostHandlerResourceLimit } from "../action";
import {
	decodeRuntimeCodec,
	encodeRuntimeCodec,
	type RuntimeCodec,
	RuntimeCodecError,
} from "../codec";
import {
	RuntimeCredentialMalformed,
	RuntimeCredentialUnavailable,
} from "../execution";
import {
	CommittedResultUnavailable,
	DeclaredOperationError,
	encodeDeclaredOperationError,
	OperationFailure,
	type PreparedOperation,
	readBoundedRequestBody,
	type RuntimeOperationContract,
} from "../operation";
import {
	awaitHttpPhase,
	decodeHttpIdentity as decodeIdentity,
	decodeHttpTimeout as decodeTimeout,
	createHttpExecutionControl,
	exactHttpKeys as exactKeys,
	httpFailure,
	httpJsonResponse as response,
	httpProtocolFailure as protocol,
	httpRecord as record,
	readHttpHeader as header,
} from "./http-carrier";

const MUTATION_PREFIX = "/_questpie/mutation/";
const ACTION_PREFIX = "/_questpie/action/";

function contentType(value: string | null): boolean {
	return (
		value !== null &&
		/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?$/iu.test(value)
	);
}

function parseJsonWithoutDuplicateKeys(source: string): unknown {
	let offset = 0;
	const whitespace = () => {
		while (/\s/u.test(source[offset] ?? "")) offset += 1;
	};
	const string = (): string => {
		const start = offset;
		offset += 1;
		while (offset < source.length) {
			const character = source[offset]!;
			offset += 1;
			if (character === "\\") {
				offset += 1;
				continue;
			}
			if (character === '"')
				return JSON.parse(source.slice(start, offset)) as string;
		}
		return protocol();
	};
	const value = (): void => {
		whitespace();
		if (source[offset] === "{") {
			offset += 1;
			whitespace();
			const keys = new Set<string>();
			if (source[offset] === "}") {
				offset += 1;
				return;
			}
			while (offset < source.length) {
				whitespace();
				if (source[offset] !== '"') protocol();
				const key = string();
				if (keys.has(key)) protocol();
				keys.add(key);
				whitespace();
				if (source[offset] !== ":") protocol();
				offset += 1;
				value();
				whitespace();
				if (source[offset] === "}") {
					offset += 1;
					return;
				}
				if (source[offset] !== ",") protocol();
				offset += 1;
			}
			return protocol();
		}
		if (source[offset] === "[") {
			offset += 1;
			whitespace();
			if (source[offset] === "]") {
				offset += 1;
				return;
			}
			while (offset < source.length) {
				value();
				whitespace();
				if (source[offset] === "]") {
					offset += 1;
					return;
				}
				if (source[offset] !== ",") protocol();
				offset += 1;
			}
			return protocol();
		}
		if (source[offset] === '"') {
			string();
			return;
		}
		while (offset < source.length && !/[\s,\]}]/u.test(source[offset] ?? ""))
			offset += 1;
	};
	value();
	whitespace();
	if (offset !== source.length) protocol();
	return JSON.parse(source) as unknown;
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
		executeMutation(
			value: Readonly<{
				principal: Principal;
				context: ContextInput;
				operation: PreparedOperation<View>;
				callId: string;
				signal: AbortSignal;
				deadline?: number;
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
				let caller: Principal | null;
				try {
					caller = await awaitHttpPhase(execution.signal, () =>
						input.resolvePrincipal(request, execution.signal),
					);
				} catch (error) {
					if (execution.signal.aborted)
						return failure("DEADLINE_EXCEEDED", callId);
					if (error instanceof RuntimeCredentialMalformed)
						return failure("UNAUTHENTICATED", callId);
					return failure(
						error instanceof RuntimeCredentialUnavailable
							? "RUNTIME_UNAVAILABLE"
							: "INTERNAL",
						callId,
					);
				}
				if (execution.signal.aborted)
					return failure("DEADLINE_EXCEEDED", callId);
				if (!caller || !principal.is(caller))
					return failure("UNAUTHENTICATED", callId);
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
							});
					if (execution.signal.aborted)
						return failure("DEADLINE_EXCEEDED", callId);
					const body = {
						callId,
						result: encodeRuntimeCodec(contract.output, value),
					};
					if (
						Buffer.byteLength(JSON.stringify(body), "utf8") >
						input.maximumResponseBytes
					)
						return failure("RESOURCE_LIMIT", callId, !action);
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
							const declared = encodeDeclaredOperationError(
								(action
									? {
											declaredErrors: contract.declaredErrors,
										}
									: prepared!) as PreparedOperation<View>,
								error,
							);
							return response(
								{
									callId,
									error: {
										code: declared.code,
										payload: declared.payload,
									},
								},
								declared.status,
							);
						} catch {
							return failure("INTERNAL", callId);
						}
					}
					if (execution.signal.aborted)
						return failure("DEADLINE_EXCEEDED", callId);
					if (error instanceof RuntimeActionPostHandlerResourceLimit)
						return failure("RESOURCE_LIMIT", callId, false);
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
