import { Buffer } from "node:buffer";

import { principal, type Principal } from "questpie";

import {
	decodeRuntimeCodec,
	encodeRuntimeCodec,
	RuntimeCodecError,
} from "../../codec";
import type { ObservedLiveQueryPlanV1 } from "../../live-query";
import { isOperationCallId, readBoundedRequestBody } from "../../operation";
import type {
	DecodedRealtimeQueryV1,
	DecodedRealtimeWireContractV1,
} from "./contract";
import type {
	LiveQueryCoordinator,
	LiveQueryCoordinatorDelivery,
} from "./coordinator";

type MaybePromise<Value> = Value | Promise<Value>;
type WireRecord = Readonly<Record<string, unknown>>;
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

type Binding = {
	readonly id: string;
	readonly query: DecodedRealtimeQueryV1;
	readonly controller: AbortController;
	token: string | null;
	observedPlan: ObservedLiveQueryPlanV1 | null;
};

type QueuedFrame = Readonly<{ bytes: Uint8Array; size: number }>;

type Session = {
	readonly scopeId: string;
	readonly principal: Principal;
	readonly principalKey: string;
	readonly response: Response;
	readonly bindings: Map<string, Binding>;
	enqueue(frame: WireRecord): boolean;
	close(reason: string, retryable: boolean): void;
};

function record(value: unknown): WireRecord | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as WireRecord)
		: null;
}

function exactKeys(value: WireRecord, expected: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const sorted = [...expected].sort();
	return (
		actual.length === sorted.length &&
		actual.every((key, index) => key === sorted[index])
	);
}

function principalKey(value: Principal): string {
	return `${value.kind}:${value.id}`;
}

function empty(status: number): Response {
	return new Response(null, { status });
}

function sseBytes(frame: WireRecord): Uint8Array {
	return new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`);
}

function createSession(
	input: Readonly<{
		contract: DecodedRealtimeWireContractV1;
		scopeId: string;
		principal: Principal;
		onDispose(session: Session): void;
	}>,
): Session {
	const pending: QueuedFrame[] = [];
	let pendingBytes = 0;
	let inFlightBytes = 0;
	let closing = false;
	let disposed = false;
	let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
	const bindings = new Map<string, Binding>();
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		for (const binding of bindings.values())
			binding.controller.abort(
				new DOMException("Realtime session closed", "AbortError"),
			);
		input.onDispose(session);
	};
	const pump = () => {
		if (!controller || controller.desiredSize === null) return;
		if (inFlightBytes > 0 && controller.desiredSize > 0) inFlightBytes = 0;
		if (controller.desiredSize <= 0) return;
		const next = pending.shift();
		if (next) {
			pendingBytes -= next.size;
			inFlightBytes = next.size;
			controller.enqueue(next.bytes);
			return;
		}
		if (closing) {
			controller.close();
			dispose();
		}
	};
	const append = (frame: WireRecord): boolean => {
		if (disposed || closing) return false;
		const bytes = sseBytes(frame);
		const total = pendingBytes + inFlightBytes + bytes.byteLength;
		if (total > input.contract.limits.bufferedBytesPerClient) return false;
		pending.push({ bytes, size: bytes.byteLength });
		pendingBytes += bytes.byteLength;
		pump();
		return true;
	};
	const close = (reason: string, retryable: boolean) => {
		if (disposed || closing) return;
		const bytes = sseBytes({
			protocol: input.contract.protocol,
			kind: "closed",
			reason,
			retryable,
			scopeId: input.scopeId,
		});
		if (
			pendingBytes + inFlightBytes + bytes.byteLength >
			input.contract.limits.bufferedBytesPerClient
		) {
			pending.length = 0;
			pendingBytes = 0;
		}
		pending.push({ bytes, size: bytes.byteLength });
		pendingBytes += bytes.byteLength;
		closing = true;
		pump();
	};
	const stream = new ReadableStream<Uint8Array>({
		start(value) {
			controller = value;
		},
		pull() {
			pump();
		},
		cancel() {
			dispose();
		},
	});
	const session: Session = {
		scopeId: input.scopeId,
		principal: input.principal,
		principalKey: principalKey(input.principal),
		bindings,
		response: new Response(stream, {
			status: 200,
			headers: {
				"cache-control": "no-cache, no-transform",
				"content-type": input.contract.streamMediaType,
			},
		}),
		enqueue(frame) {
			if (append(frame)) return true;
			close("buffer-limit", true);
			return false;
		},
		close,
	};
	return session;
}

function commandKind(
	frame: WireRecord,
	contract: DecodedRealtimeWireContractV1,
): "ack" | "close" | "open" | null {
	const protocol = record(frame.protocol);
	if (
		!protocol ||
		!exactKeys(protocol, ["name", "version"]) ||
		protocol.name !== contract.protocol.name ||
		protocol.version !== contract.protocol.version ||
		frame.application !== contract.application ||
		frame.clientContractDigest !== contract.clientContractDigest ||
		frame.realtimeWireDigest !== contract.digest ||
		!isOperationCallId(frame.scopeId) ||
		!isOperationCallId(frame.bindingId)
	)
		return null;
	if (
		frame.command === "open" &&
		exactKeys(frame, [
			"application",
			"bindingId",
			"clientContractDigest",
			"command",
			"context",
			"input",
			"protocol",
			"query",
			"realtimeWireDigest",
			"resumeToken",
			"scopeId",
		]) &&
		typeof frame.query === "string" &&
		(frame.resumeToken === null ||
			(typeof frame.resumeToken === "string" && frame.resumeToken.length > 0))
	)
		return "open";
	if (
		frame.command === "ack" &&
		exactKeys(frame, [
			"application",
			"bindingId",
			"clientContractDigest",
			"command",
			"protocol",
			"realtimeWireDigest",
			"resumeToken",
			"scopeId",
		]) &&
		typeof frame.resumeToken === "string" &&
		frame.resumeToken.length > 0
	)
		return "ack";
	if (
		frame.command === "close" &&
		exactKeys(frame, [
			"application",
			"bindingId",
			"clientContractDigest",
			"command",
			"protocol",
			"realtimeWireDigest",
			"scopeId",
		])
	)
		return "close";
	return null;
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
	const activeByPrincipal = new Map<string, number>();
	const removeBinding = (session: Session, bindingId: string) => {
		const binding = session.bindings.get(bindingId);
		if (!binding) return;
		binding.controller.abort(new DOMException("Watch closed", "AbortError"));
		input.coordinator?.close(session.scopeId, bindingId);
		session.bindings.delete(bindingId);
		const remaining = (activeByPrincipal.get(session.principalKey) ?? 1) - 1;
		if (remaining === 0) activeByPrincipal.delete(session.principalKey);
		else activeByPrincipal.set(session.principalKey, remaining);
	};
	const disposeSession = (session: Session) => {
		if (sessions.get(session.scopeId) === session)
			sessions.delete(session.scopeId);
		for (const bindingId of session.bindings.keys())
			removeBinding(session, bindingId);
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
	const evaluate = async (
		session: Session,
		binding: Binding,
		context: Context,
		queryInput: unknown,
		resumeToken: string | null,
	) => {
		try {
			const evaluateComplete = async () => {
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
				return Object.freeze({
					payload,
					observedPlan: evaluation.observedPlan,
				});
			};
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
						evaluate: evaluateComplete,
						publish,
					})
				: undefined;
			const evaluation = coordinated ?? (await evaluateComplete());
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
					: record(error)?.code === "AUTHORIZATION_FAILED"
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
				if (prior.principalKey !== principalKey(resolved)) return empty(404);
				prior.close("connection-replaced", true);
				disposeSession(prior);
			}
			const session = createSession({
				contract: input.contract,
				scopeId,
				principal: resolved,
				onDispose: disposeSession,
			});
			sessions.set(scopeId, session);
			session.enqueue({
				protocol: input.contract.protocol,
				kind: "ready",
				scopeId,
			});
			request.signal.addEventListener(
				"abort",
				() => session.close("connection-aborted", true),
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
		const frame = record(raw);
		if (!frame) return empty(400);
		const kind = commandKind(frame, input.contract);
		if (!kind) return empty(400);
		const scopeId = frame.scopeId as string;
		const bindingId = frame.bindingId as string;
		const session = sessions.get(scopeId);
		if (!session) return empty(404);
		let resolved: Principal | null;
		try {
			resolved = await input.resolvePrincipal(request);
		} catch {
			return empty(500);
		}
		if (
			!resolved ||
			!principal.is(resolved) ||
			principalKey(resolved) !== session.principalKey
		)
			return empty(404);
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
		const active = activeByPrincipal.get(session.principalKey) ?? 0;
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
		activeByPrincipal.set(session.principalKey, active + 1);
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
		for (const session of sessions.values())
			session.close("runtime-draining", true);
	};
	return Object.freeze({ fetch, beginDrain, drain });
}
