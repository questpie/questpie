import { canonicalBytes } from "../canonical";
import type { RealtimeWireContractV1 } from "./realtime-wire";

export function renderClientRealtime(
	input: Readonly<{
		application: string;
		clientContractDigest: string;
		enabled: boolean;
		realtime?: RealtimeWireContractV1;
	}>,
): Readonly<{
	watchTypes: string;
	realtimeTypes: string;
	realtimeScope: string;
}> {
	const watchTypes = !input.enabled
		? ""
		: `
export type QueryDelivery =
	| Readonly<{ readonly kind: "initial" }>
	| Readonly<{ readonly kind: "update" }>
	| Readonly<{ readonly kind: "reset"; readonly reason: "authority-changed" | "deployment-changed" | "resume-unavailable" }>;

export type WatchState =
	| Readonly<{ readonly kind: "connected" }>
	| Readonly<{ readonly kind: "reconnecting"; readonly attempt: number }>;

export type WatchFailure = Readonly<{
	readonly code: "AUTHORIZATION_FAILED" | "OUTPUT_INVALID" | "RESOURCE_LIMIT" | "TRANSPORT_FAILED" | "VERSION_INCOMPATIBLE";
}>;

export interface WatchOptions {
	readonly signal?: AbortSignal;
	readonly onStateChange?: (state: WatchState) => void;
	readonly onError?: (error: WatchFailure) => void;
}

export interface WatchableQueryMethod<Input, Output> {
	(input: Input, options?: CallOptions): Promise<Output>;
	watch(input: Input, callback: (result: Output, delivery: QueryDelivery) => void, options?: WatchOptions): () => void;
}
`;
	const realtimeTypes = !input.enabled
		? ""
		: `
type RealtimeBinding = {
	readonly query: string;
	readonly input: unknown;
	readonly callback: (result: unknown, delivery: QueryDelivery) => void;
	readonly options: WatchOptions;
	resumeToken: string | null;
};
`;
	const realtimeScope =
		input.realtime === undefined
			? ""
			: `
		const scopeId = crypto.randomUUID();
		const bindings = new Map<string, RealtimeBinding>();
		let streamStarted = false;
		let streamReady = false;
		let streamAbort: AbortController | undefined;
		let reconnectAttempt = 0;
		let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
		const command = async (body: WireRecord): Promise<void> => {
			const response = await transport(new Request(new URL(${JSON.stringify(input.realtime.path)}, input.baseUrl), {
				method: "POST",
				headers: { "content-type": ${JSON.stringify(input.realtime.commandMediaType)} },
				body: JSON.stringify(body),
			}));
			if (response.status !== 202) protocolFailure();
		};
		const commandBase = Object.freeze({ protocol: ${canonicalBytes(input.realtime.protocol).trim()}, application: ${JSON.stringify(input.application)}, clientContractDigest: ${JSON.stringify(input.clientContractDigest)}, realtimeWireDigest: ${JSON.stringify(input.realtime.digest)}, scopeId });
		const openBinding = (bindingId: string, binding: RealtimeBinding): void => {
			void command({ ...commandBase, command: "open", bindingId, context, input: binding.input, query: binding.query, resumeToken: binding.resumeToken }).catch(() => binding.options.onError?.(Object.freeze({ code: "TRANSPORT_FAILED" })));
		};
		const consumeFrame = async (value: unknown): Promise<void> => {
			const frame = wireRecord(value);
			const protocol = wireRecord(frame.protocol);
			exactKeys(protocol, ["name", "version"]);
			if (protocol.name !== "questpie.realtime" || protocol.version !== 1) protocolFailure();
			if (frame.kind === "ready") {
				exactKeys(frame, ["kind", "protocol", "scopeId"]);
				if (frame.scopeId !== scopeId) protocolFailure();
				streamReady = true;
				reconnectAttempt = 0;
				for (const [bindingId, binding] of bindings) {
					binding.options.onStateChange?.(Object.freeze({ kind: "connected" }));
					openBinding(bindingId, binding);
				}
				return;
			}
			if (frame.kind === "delivery") {
				exactKeys(frame, ["bindingId", "delivery", "kind", "payload", "protocol", "query", "resetReason", "resumeToken"]);
				if (typeof frame.bindingId !== "string" || typeof frame.query !== "string" || typeof frame.resumeToken !== "string") protocolFailure();
				const binding = bindings.get(frame.bindingId);
				if (!binding || binding.query !== frame.query || !["initial", "reset", "update"].includes(String(frame.delivery))) protocolFailure();
				const result = decode(outputCodecs[binding.query], frame.payload);
				const delivery = frame.delivery === "reset"
					? ["authority-changed", "deployment-changed", "resume-unavailable"].includes(String(frame.resetReason))
						? Object.freeze({ kind: "reset" as const, reason: frame.resetReason as "authority-changed" | "deployment-changed" | "resume-unavailable" })
						: protocolFailure()
					: frame.resetReason === null
						? Object.freeze({ kind: frame.delivery as "initial" | "update" })
						: protocolFailure();
				binding.callback(result, delivery);
				binding.resumeToken = frame.resumeToken;
				await command({ ...commandBase, command: "ack", bindingId: frame.bindingId, resumeToken: frame.resumeToken });
				return;
			}
			if (frame.kind === "failure") {
				exactKeys(frame, ["bindingId", "error", "kind", "protocol", "query"]);
				if (typeof frame.bindingId !== "string" || typeof frame.query !== "string") protocolFailure();
				const binding = bindings.get(frame.bindingId);
				const error = wireRecord(frame.error);
				exactKeys(error, ["code"]);
				if (!binding || binding.query !== frame.query || !["AUTHORIZATION_FAILED", "OUTPUT_INVALID", "RESOURCE_LIMIT", "TRANSPORT_FAILED", "VERSION_INCOMPATIBLE"].includes(String(error.code))) protocolFailure();
				binding.options.onError?.(Object.freeze({ code: error.code as WatchFailure["code"] }));
				return;
			}
			if (frame.kind === "closed") {
				exactKeys(frame, ["kind", "protocol", "reason", "retryable", "scopeId"]);
				if (frame.scopeId !== scopeId || typeof frame.retryable !== "boolean") protocolFailure();
				throw Object.assign(new Error("REALTIME_CLOSED"), { retryable: frame.retryable });
			}
			protocolFailure();
		};
		const scheduleReconnect = (): void => {
			if (bindings.size === 0 || reconnectTimer !== undefined) return;
			reconnectAttempt += 1;
			for (const binding of bindings.values()) binding.options.onStateChange?.(Object.freeze({ kind: "reconnecting", attempt: reconnectAttempt }));
			reconnectTimer = setTimeout(() => {
				reconnectTimer = undefined;
				ensureStream();
			}, Math.min(250 * 2 ** (reconnectAttempt - 1), 5_000));
		};
		const ensureStream = (): void => {
			if (streamStarted) return;
			streamStarted = true;
			streamAbort = new AbortController();
			void (async () => {
				const response = await transport(new Request(new URL(${JSON.stringify(input.realtime.path)}, input.baseUrl), {
					method: "GET",
					headers: { accept: ${JSON.stringify(input.realtime.streamMediaType)}, "x-questpie-realtime-scope": scopeId },
					signal: streamAbort?.signal,
				}));
				if (response.status !== 200 || response.headers.get("content-type") !== ${JSON.stringify(input.realtime.streamMediaType)} || !response.body) protocolFailure();
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffered = "";
				while (true) {
					const part = await reader.read();
					buffered += decoder.decode(part.value, { stream: !part.done });
					if (new TextEncoder().encode(buffered).byteLength > ${input.realtime.limits.bufferedBytesPerClient}) throw new Error("RESOURCE_LIMIT");
					let boundary: number;
					while ((boundary = buffered.indexOf("\\n\\n")) >= 0) {
						const event = buffered.slice(0, boundary);
						buffered = buffered.slice(boundary + 2);
						const data = event.split("\\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\\n");
						if (data.length > 0) await consumeFrame(JSON.parse(data));
					}
					if (part.done) break;
				}
			})().then(() => {
				if (!streamAbort?.signal.aborted) scheduleReconnect();
			}).catch((error: unknown) => {
				if (streamAbort?.signal.aborted) return;
				if (error instanceof Error && error.message === "PROTOCOL_UNSUPPORTED") {
					for (const binding of bindings.values()) binding.options.onError?.(Object.freeze({ code: "VERSION_INCOMPATIBLE" }));
					return;
				}
				if (error instanceof Error && error.message === "RESOURCE_LIMIT") {
					for (const binding of bindings.values()) binding.options.onError?.(Object.freeze({ code: "RESOURCE_LIMIT" }));
					return;
				}
				if (error instanceof Error && (error as Error & { retryable?: boolean }).retryable === false) {
					for (const binding of bindings.values()) binding.options.onError?.(Object.freeze({ code: "TRANSPORT_FAILED" }));
					return;
				}
				scheduleReconnect();
			}).finally(() => { streamStarted = false; streamReady = false; });
		};
		const watchBinding = <Result>(query: string, operationInput: unknown, callback: (result: Result, delivery: QueryDelivery) => void, options: WatchOptions = {}): (() => void) => {
			const bindingId = crypto.randomUUID();
			const binding: RealtimeBinding = { query, input: structuredClone(operationInput), callback: callback as RealtimeBinding["callback"], options, resumeToken: null };
			bindings.set(bindingId, binding);
			ensureStream();
			if (streamReady) openBinding(bindingId, binding);
			let closed = false;
			const close = (): void => {
				if (closed) return;
				closed = true;
				bindings.delete(bindingId);
				const closing = command({ ...commandBase, command: "close", bindingId }).catch(() => undefined);
				if (bindings.size === 0) {
					void closing.finally(() => {
						if (bindings.size !== 0) return;
						streamAbort?.abort();
						if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
						reconnectTimer = undefined;
						streamStarted = false;
						streamReady = false;
					});
				}
			};
			if (options.signal?.aborted) close();
			else options.signal?.addEventListener("abort", close, { once: true });
			return close;
		};`;
	return Object.freeze({ watchTypes, realtimeTypes, realtimeScope });
}
