import { Buffer } from "node:buffer";

import { principal, type Principal } from "questpie";

import { canonicalJsonLine, sha256Digest } from "../../canonical-json";
import {
	decodeRuntimeCodec,
	encodeRuntimeCodec,
	RuntimeCodecError,
} from "../../codec";
import type { ObservedLiveQueryPlanV1 } from "../../live-query";
import { isOperationCallId, readBoundedRequestBody } from "../../operation";
import {
	createRealtimeSession,
	realtimeCommandKind,
	realtimePrincipalKey,
	realtimeWireRecord,
	type RealtimeCarrierBinding as Binding,
	type RealtimeCarrierSession as Session,
} from "./carrier-wire";
import type { DecodedRealtimeWireContractV1 } from "./contract";
import type {
	LiveQueryCoordinator,
	LiveQueryCoordinatorDelivery,
} from "./coordinator";
import type { DurableRealtimeAttachment } from "./durable";

type MaybePromise<Value> = Value | Promise<Value>;
type FailureCode =
	| "AUTHORIZATION_FAILED"
	| "OUTPUT_INVALID"
	| "RESOURCE_LIMIT"
	| "TRANSPORT_FAILED"
	| "VERSION_INCOMPATIBLE";

class CarrierEvaluationFailure extends Error {
	readonly code: FailureCode;

	constructor(code: FailureCode) {
		super(code);
		this.code = code;
	}
}

export type RealtimeCarrierEvaluation<Context> = Readonly<{
	principal: Principal;
	context: Context;
	query: string;
	input: unknown;
	signal: AbortSignal;
}>;

export type RealtimeCarrierEvaluationResult = Readonly<{
	result: unknown;
	observedPlan: ObservedLiveQueryPlanV1;
}>;

export type RealtimeCarrierObservedPlan = Readonly<{
	scopeId: string;
	bindingId: string;
	query: string;
	plan: ObservedLiveQueryPlanV1;
}>;

export interface RealtimeCarrier {
	fetch(request: Request): Promise<Response | null>;
	beginDrain(): void;
	drain(): Promise<void>;
}

function empty(status: number): Response {
	return new Response(null, { status });
}

export function createRealtimeCarrier<Context>(
	input: Readonly<{
		contract: DecodedRealtimeWireContractV1;
		resolvePrincipal(request: Request): MaybePromise<Principal | null>;
		decodeContext(value: unknown): Context;
		evaluate(
			input: RealtimeCarrierEvaluation<Context>,
		): Promise<RealtimeCarrierEvaluationResult>;
		onObservedPlan?(input: RealtimeCarrierObservedPlan): MaybePromise<void>;
		coordinator?: LiveQueryCoordinator<Context>;
	}>,
): RealtimeCarrier {
	let state: "draining" | "ready" = "ready";
	const sessions = new Map<string, Session>();
	const disposedSessions = new WeakSet<Session>();
	const durablyAttachedSessions = new WeakSet<Session>();
	const pendingDisposals = new Set<Promise<void>>();
	const removeBinding = (
		session: Session,
		bindingId: string,
		closeCoordinator = true,
	) => {
		const binding = session.bindings.get(bindingId);
		if (!binding) return;
		binding.controller.abort(new DOMException("Watch closed", "AbortError"));
		if (closeCoordinator && !input.coordinator?.durable)
			input.coordinator?.close(session.scopeId, bindingId);
		session.bindings.delete(bindingId);
	};
	const disposeSession = (session: Session) => {
		if (disposedSessions.has(session)) return;
		disposedSessions.add(session);
		if (sessions.get(session.scopeId) === session)
			sessions.delete(session.scopeId);
		for (const bindingId of session.bindings.keys())
			removeBinding(session, bindingId, false);
		if (input.coordinator?.durable && durablyAttachedSessions.has(session)) {
			const disposal = input.coordinator.durable
				.detach(session.scopeId, session.principal)
				.catch(() => {})
				.finally(() => pendingDisposals.delete(disposal));
			pendingDisposals.add(disposal);
		}
	};
	const frameFailure = (
		session: Session,
		binding: Binding,
		code: FailureCode,
	) =>
		session.enqueue({
			protocol: input.contract.protocol,
			kind: "failure",
			bindingId: binding.id,
			query: binding.query.identity,
			error: { code },
		});
	const evaluateComplete = async (
		session: Session,
		binding: Binding,
		context: Context,
		queryInput: unknown,
	) => {
		const evaluation = await input.evaluate({
			principal: session.principal,
			context,
			query: binding.query.identity,
			input: queryInput,
			signal: binding.controller.signal,
		});
		let payload: unknown;
		try {
			payload = encodeRuntimeCodec(
				binding.query.output,
				evaluation.result,
				"$result",
			);
		} catch (error) {
			if (!(error instanceof RuntimeCodecError)) throw error;
			throw new CarrierEvaluationFailure("OUTPUT_INVALID");
		}
		if (
			Buffer.byteLength(JSON.stringify(payload)) >
			input.contract.limits.resultBytes
		)
			throw new CarrierEvaluationFailure("RESOURCE_LIMIT");
		return Object.freeze({ payload, observedPlan: evaluation.observedPlan });
	};
	const evaluate = async (
		session: Session,
		binding: Binding,
		context: Context,
		queryInput: unknown,
		resumeToken: string | null,
	) => {
		try {
			const complete = () =>
				evaluateComplete(session, binding, context, queryInput);
			const publish = async (
				delivery: LiveQueryCoordinatorDelivery,
			): Promise<boolean> => {
				await input.onObservedPlan?.({
					scopeId: session.scopeId,
					bindingId: binding.id,
					query: binding.query.identity,
					plan: delivery.observedPlan,
				});
				binding.observedPlan = delivery.observedPlan;
				binding.token = delivery.resumeToken;
				return session.enqueue({
					protocol: input.contract.protocol,
					kind: "delivery",
					bindingId: binding.id,
					query: binding.query.identity,
					delivery: delivery.delivery,
					resetReason: delivery.resetReason,
					payload: delivery.payload,
					resumeToken: delivery.resumeToken,
				});
			};
			const coordinated = input.coordinator
				? await input.coordinator.open({
						scopeId: session.scopeId,
						bindingId: binding.id,
						principal: session.principal,
						context,
						query: binding.query.identity,
						input: queryInput,
						resumeToken,
						signal: binding.controller.signal,
						evaluate: complete,
						publish,
					})
				: undefined;
			const evaluation = coordinated ?? (await complete());
			if (binding.controller.signal.aborted) return;
			const token = coordinated?.resumeToken ?? crypto.randomUUID();
			await input.onObservedPlan?.({
				scopeId: session.scopeId,
				bindingId: binding.id,
				query: binding.query.identity,
				plan: evaluation.observedPlan,
			});
			binding.observedPlan = evaluation.observedPlan;
			binding.token = token;
			session.enqueue({
				protocol: input.contract.protocol,
				kind: "delivery",
				bindingId: binding.id,
				query: binding.query.identity,
				delivery:
					coordinated?.delivery ?? (resumeToken === null ? "initial" : "reset"),
				resetReason:
					coordinated !== undefined
						? coordinated.resetReason
						: resumeToken === null
							? null
							: "resume-unavailable",
				payload: evaluation.payload,
				resumeToken: token,
			});
		} catch (error) {
			if (binding.controller.signal.aborted) return;
			const code =
				error instanceof CarrierEvaluationFailure
					? error.code
					: realtimeWireRecord(error)?.code === "AUTHORIZATION_FAILED"
						? "AUTHORIZATION_FAILED"
						: "TRANSPORT_FAILED";
			frameFailure(session, binding, code);
		}
	};
	const fetch = async (request: Request): Promise<Response | null> => {
		const url = new URL(request.url);
		if (url.pathname !== input.contract.path) return null;
		if (state !== "ready") return empty(503);
		if (request.method === "GET") {
			if (request.headers.get("accept") !== input.contract.streamMediaType)
				return empty(406);
			const scopeId = request.headers.get("x-questpie-realtime-scope");
			if (!isOperationCallId(scopeId)) return empty(400);
			let resolved: Principal | null;
			try {
				resolved = await input.resolvePrincipal(request);
			} catch {
				return empty(500);
			}
			if (!resolved || !principal.is(resolved)) return empty(404);
			const prior = sessions.get(scopeId);
			if (prior) {
				if (prior.principalKey !== realtimePrincipalKey(resolved))
					return empty(404);
				if (input.coordinator?.durable && durablyAttachedSessions.delete(prior))
					await input.coordinator.durable.detach(
						prior.scopeId,
						prior.principal,
					);
				prior.close("connection-replaced", true);
				disposeSession(prior);
			}
			const session = createRealtimeSession({
				contract: input.contract,
				scopeId,
				principal: resolved,
				onDispose: disposeSession,
			});
			if (input.coordinator?.durable) {
				const attachment: DurableRealtimeAttachment = {
					scopeId,
					principal: resolved,
					prepare(watch) {
						const queryName = `query:${watch.queryIdentity}`;
						const query = input.contract.watchableQueries.get(queryName);
						if (
							!query ||
							!Buffer.from(watch.queryBytes).equals(
								Buffer.from(canonicalJsonLine({ identity: queryName })),
							)
						)
							return null;
						let contextWire: unknown;
						let inputWire: unknown;
						try {
							contextWire = JSON.parse(
								new TextDecoder("utf-8", { fatal: true }).decode(
									watch.contextInputBytes,
								),
							);
							inputWire = JSON.parse(
								new TextDecoder("utf-8", { fatal: true }).decode(
									watch.inputBytes,
								),
							);
							if (
								!Buffer.from(canonicalJsonLine(contextWire)).equals(
									Buffer.from(watch.contextInputBytes),
								) ||
								!Buffer.from(canonicalJsonLine(inputWire)).equals(
									Buffer.from(watch.inputBytes),
								)
							)
								return null;
							const context = input.decodeContext(contextWire);
							const queryInput = decodeRuntimeCodec(
								query.input,
								inputWire,
								"$input",
							);
							let binding = session.bindings.get(watch.bindingIdentity);
							if (binding && binding.query.identity !== queryName) return null;
							if (!binding) {
								binding = {
									id: watch.bindingIdentity,
									query,
									controller: new AbortController(),
									token: null,
									observedPlan: null,
								};
								session.bindings.set(watch.bindingIdentity, binding);
							}
							return Object.freeze({
								authorityPartitionDigest: sha256Digest(
									canonicalJsonLine({
										principal: {
											kind: resolved.kind,
											id: resolved.id,
										},
										context,
									}),
								),
								evaluate: () =>
									evaluateComplete(session, binding, context, queryInput),
							});
						} catch {
							return null;
						}
					},
					async publish(watch, delivery) {
						const binding = session.bindings.get(watch.bindingIdentity);
						if (!binding || binding.controller.signal.aborted) return false;
						await input.onObservedPlan?.({
							scopeId,
							bindingId: binding.id,
							query: binding.query.identity,
							plan: delivery.observedPlan,
						});
						binding.observedPlan = delivery.observedPlan;
						binding.token = delivery.resumeToken;
						return session.enqueue({
							protocol: input.contract.protocol,
							kind: "delivery",
							bindingId: binding.id,
							query: binding.query.identity,
							delivery: delivery.delivery,
							resetReason: delivery.resetReason,
							payload: delivery.payload,
							resumeToken: delivery.resumeToken,
						});
					},
					synchronize(bindingIds) {
						for (const bindingId of session.bindings.keys())
							if (!bindingIds.has(bindingId))
								removeBinding(session, bindingId, false);
					},
				};
				if (!(await input.coordinator.durable.attach(attachment))) {
					session.close("scope-unavailable", false);
					return empty(404);
				}
				durablyAttachedSessions.add(session);
			}
			sessions.set(scopeId, session);
			session.enqueue({
				protocol: input.contract.protocol,
				kind: "ready",
				scopeId,
			});
			request.signal.addEventListener(
				"abort",
				() => {
					session.close("connection-aborted", true);
					disposeSession(session);
				},
				{ once: true },
			);
			return session.response;
		}
		if (request.method !== "POST") return empty(405);
		if (request.headers.get("content-type") !== input.contract.commandMediaType)
			return empty(415);
		const body = await readBoundedRequestBody(
			request,
			input.contract.limits.resultBytes,
		);
		if (body.kind === "tooLarge") return empty(413);
		if (body.kind === "invalid") return empty(400);
		let raw: unknown;
		try {
			raw = JSON.parse(body.text);
		} catch {
			return empty(400);
		}
		const frame = realtimeWireRecord(raw);
		if (!frame) return empty(400);
		const kind = realtimeCommandKind(frame, input.contract);
		if (!kind) return empty(400);
		const scopeId = frame.scopeId as string;
		const bindingId = frame.bindingId as string;
		const session = sessions.get(scopeId);
		if (!session && !input.coordinator?.durable) return empty(404);
		let resolved: Principal | null;
		try {
			resolved = await input.resolvePrincipal(request);
		} catch {
			return empty(500);
		}
		if (
			!resolved ||
			!principal.is(resolved) ||
			(session !== undefined &&
				realtimePrincipalKey(resolved) !== session.principalKey)
		)
			return empty(404);
		if (input.coordinator?.durable) {
			if (kind === "close")
				return empty(
					(await input.coordinator.durable.close(scopeId, bindingId, resolved))
						? 202
						: 404,
				);
			if (kind === "ack")
				return empty(
					(await input.coordinator.durable.acknowledge(
						scopeId,
						bindingId,
						resolved,
						frame.resumeToken as string,
					))
						? 202
						: 409,
				);
			const query = input.contract.watchableQueries.get(frame.query as string);
			if (!query) return empty(404);
			let decodedContext: Context;
			let decodedInput: unknown;
			try {
				decodedContext = input.decodeContext(frame.context);
				decodedInput = decodeRuntimeCodec(query.input, frame.input, "$input");
			} catch (error) {
				if (error instanceof RuntimeCodecError || error instanceof TypeError)
					return empty(400);
				return empty(500);
			}
			const contextInputBytes = canonicalJsonLine(decodedContext);
			const inputBytes = canonicalJsonLine(decodedInput);
			const result = await input.coordinator.durable.open({
				scopeId,
				bindingId,
				principal: resolved,
				authorityPartitionDigest: sha256Digest(
					canonicalJsonLine({
						principal: { kind: resolved.kind, id: resolved.id },
						context: decodedContext,
					}),
				),
				queryIdentity: query.identity.slice("query:".length),
				queryBytes: canonicalJsonLine({ identity: query.identity }),
				inputBytes,
				inputDigest: sha256Digest(inputBytes),
				contextInputBytes,
				resumeRequested: frame.resumeToken !== null,
				requestedResumeToken: frame.resumeToken as string | null,
			});
			return empty(result === "opened" ? 202 : result === "limit" ? 429 : 404);
		}
		if (!session) return empty(404);
		if (kind === "close") {
			if (!session.bindings.has(bindingId)) return empty(404);
			removeBinding(session, bindingId);
			return empty(202);
		}
		if (kind === "ack") {
			const binding = session.bindings.get(bindingId);
			if (!binding || binding.token !== frame.resumeToken) return empty(409);
			if (
				input.coordinator &&
				!(await input.coordinator.acknowledge(
					scopeId,
					bindingId,
					frame.resumeToken as string,
				))
			)
				return empty(409);
			return empty(202);
		}
		if (session.bindings.has(bindingId)) return empty(409);
		const query = input.contract.watchableQueries.get(frame.query as string);
		if (!query) return empty(404);
		const active = [...sessions.values()].reduce(
			(count, candidate) =>
				count +
				(candidate.principalKey === session.principalKey
					? candidate.bindings.size
					: 0),
			0,
		);
		if (active >= input.contract.limits.activeWatchesPerPrincipal)
			return empty(429);
		let decodedContext: Context;
		let decodedInput: unknown;
		try {
			decodedContext = input.decodeContext(frame.context);
			decodedInput = decodeRuntimeCodec(query.input, frame.input, "$input");
		} catch (error) {
			if (error instanceof RuntimeCodecError || error instanceof TypeError)
				return empty(400);
			return empty(500);
		}
		const binding: Binding = {
			id: bindingId,
			query,
			controller: new AbortController(),
			token: null,
			observedPlan: null,
		};
		session.bindings.set(bindingId, binding);
		void evaluate(
			session,
			binding,
			decodedContext,
			decodedInput,
			frame.resumeToken as string | null,
		);
		return empty(202);
	};
	const beginDrain = () => {
		state = "draining";
	};
	const drain = async () => {
		beginDrain();
		for (const session of sessions.values()) {
			session.close("runtime-draining", true);
			disposeSession(session);
		}
		await Promise.allSettled(pendingDisposals);
	};
	return Object.freeze({ fetch, beginDrain, drain });
}
