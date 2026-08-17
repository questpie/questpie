import type { Principal } from "questpie";

import { isOperationCallId } from "../../operation";
import type {
	DecodedRealtimeQueryV1,
	DecodedRealtimeWireContractV1,
} from "./contract";

export type RealtimeWireRecord = Readonly<Record<string, unknown>>;

export type RealtimeCarrierBinding = {
	readonly id: string;
	readonly query: DecodedRealtimeQueryV1;
	readonly controller: AbortController;
};

export type RealtimeCarrierSession = {
	readonly scopeId: string;
	readonly principal: Principal;
	readonly principalKey: string;
	readonly response: Response;
	readonly bindings: Map<string, RealtimeCarrierBinding>;
	enqueue(frame: RealtimeWireRecord): boolean;
	close(reason: string, retryable: boolean): void;
};

type QueuedFrame = Readonly<{ bytes: Uint8Array; size: number }>;

export function realtimeWireRecord(value: unknown): RealtimeWireRecord | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as RealtimeWireRecord)
		: null;
}

function exactKeys(
	value: RealtimeWireRecord,
	expected: readonly string[],
): boolean {
	const actual = Object.keys(value).sort();
	const sorted = [...expected].sort();
	return (
		actual.length === sorted.length &&
		actual.every((key, index) => key === sorted[index])
	);
}

export function realtimePrincipalKey(value: Principal): string {
	return `${value.kind}:${value.id}`;
}

function sseBytes(frame: RealtimeWireRecord): Uint8Array {
	return new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`);
}

export function createRealtimeSession(
	input: Readonly<{
		contract: DecodedRealtimeWireContractV1;
		scopeId: string;
		principal: Principal;
		onDispose(session: RealtimeCarrierSession): void;
	}>,
): RealtimeCarrierSession {
	const pending: QueuedFrame[] = [];
	let pendingBytes = 0;
	let inFlightBytes = 0;
	let closing = false;
	let disposed = false;
	let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
	const bindings = new Map<string, RealtimeCarrierBinding>();
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
	const append = (frame: RealtimeWireRecord): boolean => {
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
	const session: RealtimeCarrierSession = {
		scopeId: input.scopeId,
		principal: input.principal,
		principalKey: realtimePrincipalKey(input.principal),
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

export function realtimeCommandKind(
	frame: RealtimeWireRecord,
	contract: DecodedRealtimeWireContractV1,
): "ack" | "close" | "open" | null {
	const protocol = realtimeWireRecord(frame.protocol);
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
