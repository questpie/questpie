import { Buffer } from "node:buffer";

import { principal, type Principal } from "questpie";

import { canonicalJsonLine, sha256Digest } from "../../canonical-json";
import {
	decodeRuntimeCodec,
	encodeRuntimeCodec,
	RuntimeCodecError,
} from "../../codec";
import type { ObservedLiveQueryPlanV1 } from "../../live-query";
import {
	DeclaredOperationError,
	isOperationCallId,
	readBoundedRequestBody,
} from "../../operation";
import {
	createRealtimeSession,
	realtimeCommandKind,
	realtimePrincipalKey,
	realtimeWireRecord,
	type RealtimeCarrierBinding as Binding,
	type RealtimeCarrierSession as Session,
} from "./carrier-wire";
import type { DecodedRealtimeWireContractV1 } from "./contract";
import { LiveQueryEvaluationFailure } from "./coordinator";
import type {
	DurableRealtimeAttachment,
	DurableRealtimeCoordinator,
} from "./durable";

type MaybePromise<Value> = Value | Promise<Value>;

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
		durableCoordinator: DurableRealtimeCoordinator;
	}>,
): RealtimeCarrier {
	let state: "draining" | "ready" = "ready";
	const sessions = new Map<string, Session>();
	const disposedSessions = new WeakSet<Session>();
	const durableAttachments = new WeakMap<Session, DurableRealtimeAttachment>();
	const pendingDisposals = new Set<Promise<void>>();
	const removeBinding = (session: Session, bindingId: string) => {
		const binding = session.bindings.get(bindingId);
		if (!binding) return;
		binding.controller.abort(new DOMException("Watch closed", "AbortError"));
		session.bindings.delete(bindingId);
	};
	const disposeSession = (session: Session) => {
		if (disposedSessions.has(session)) return;
		disposedSessions.add(session);
		if (sessions.get(session.scopeId) === session)
			sessions.delete(session.scopeId);
		for (const bindingId of session.bindings.keys())
			removeBinding(session, bindingId);
		const durableAttachment = durableAttachments.get(session);
		if (durableAttachment) {
			durableAttachments.delete(session);
			const disposal = input.durableCoordinator
				.detach(durableAttachment)
				.catch(() => {})
				.finally(() => pendingDisposals.delete(disposal));
			pendingDisposals.add(disposal);
		}
	};
	const evaluateComplete = async (
		session: Session,
		binding: Binding,
		context: Context,
		queryInput: unknown,
	) => {
		let evaluation: Awaited<ReturnType<typeof input.evaluate>>;
		try {
			evaluation = await input.evaluate({
				principal: session.principal,
				context,
				query: binding.query.identity,
				input: queryInput,
				signal: binding.controller.signal,
			});
		} catch (error) {
			// A Context or Policy denial is a declared refusal of this Principal, not
			// a coordinator fault. It has to reach the client as the contracted
			// failure frame instead of escaping the reconciliation tick.
			if (!(error instanceof DeclaredOperationError)) throw error;
			throw new LiveQueryEvaluationFailure("AUTHORIZATION_FAILED");
		}
		let payload: unknown;
		try {
			payload = encodeRuntimeCodec(
				binding.query.output,
				evaluation.result,
				"$result",
			);
		} catch (error) {
			if (!(error instanceof RuntimeCodecError)) throw error;
			throw new LiveQueryEvaluationFailure("OUTPUT_INVALID");
		}
		if (
			Buffer.byteLength(JSON.stringify(payload)) >
			input.contract.limits.resultBytes
		)
			throw new LiveQueryEvaluationFailure("RESOURCE_LIMIT");
		return Object.freeze({ payload, observedPlan: evaluation.observedPlan });
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
			}
			const session = createRealtimeSession({
				contract: input.contract,
				scopeId,
				principal: resolved,
				onDispose: disposeSession,
			});
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
				publishFailure(watch, code) {
					const binding = session.bindings.get(watch.bindingIdentity);
					if (!binding || binding.controller.signal.aborted) return false;
					return session.enqueue({
						protocol: input.contract.protocol,
						kind: "failure",
						bindingId: binding.id,
						query: binding.query.identity,
						error: { code },
					});
				},
				synchronize(bindingIds) {
					for (const bindingId of session.bindings.keys())
						if (!bindingIds.has(bindingId)) removeBinding(session, bindingId);
				},
			};
			if (!(await input.durableCoordinator.attach(attachment))) {
				session.close("scope-unavailable", false);
				return empty(404);
			}
			durableAttachments.set(session, attachment);
			if (prior) {
				prior.close("connection-replaced", true);
				disposeSession(prior);
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
		if (kind === "close")
			return empty(
				(await input.durableCoordinator.close(scopeId, bindingId, resolved))
					? 202
					: 404,
			);
		if (kind === "ack")
			return empty(
				(await input.durableCoordinator.acknowledge(
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
		const result = await input.durableCoordinator.open({
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
