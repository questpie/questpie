/**
 * Event construction and delivery on `@sentry/core` primitives only.
 *
 * There is no Sentry client, no `init`, no global scope and no integration:
 * the event below is the complete payload. `createEventEnvelope` adds only
 * the envelope header (event id, DSN, SDK name/version, sent_at), and
 * `createTransport` adds rate-limit handling and a bounded buffer. Nothing
 * from a process-wide Sentry scope, OpenTelemetry context or request can be
 * merged in, because nothing here reads them.
 */

import {
	createEventEnvelope,
	createTransport,
	dateTimestampInSeconds,
	type DebugImage,
	type DsnComponents,
	type Event,
	getEnvelopeEndpointWithUrlEncodedAuth,
	getFilenameToDebugIdMap,
	makeDsn,
	type StackFrame,
	type StackParser,
	type Transport,
	type TransportMakeRequestResponse,
	type TransportRequest,
	uuid4,
} from "@sentry/core";

import { parseFrames, type SanitizedException } from "./sanitize.js";

export const SDK_NAME = "sentry.javascript.questpie";
// Kept equal to the pinned `@sentry/core` version in package.json.
export const SDK_VERSION = "11.9.0";

export interface DeliveryOptions {
	/** Project DSN. Without one, nothing is sent. */
	dsn?: string;
	/** Must match the release your source maps were uploaded for. */
	release?: string;
	environment?: string;
	/**
	 * Send envelopes to this same-origin URL instead of the Sentry host, and
	 * forward them server-side. Keeps the browser's IP and the page origin
	 * away from the ingest host.
	 */
	tunnel?: string;
	/** Per-request deadline for one envelope. @default 5000 */
	timeoutMs?: number;
	/** Maximum envelopes in flight; further ones are dropped. @default 30 */
	bufferSize?: number;
	/**
	 * Replace the network request — for a local capture transport in tests or
	 * a custom HTTP client. Receives the serialized envelope.
	 */
	send?: (request: { url: string; body: string | Uint8Array }) => Promise<{
		statusCode?: number;
		headers?: Record<string, string | null>;
	}>;
}

export interface Delivery {
	send(event: Event): Promise<void>;
	flush(timeoutMs: number): Promise<boolean>;
}

export function createDelivery(
	options: DeliveryOptions,
	fetchInit: RequestInit = {},
): Delivery | undefined {
	const dsn = options.dsn ? makeDsn(options.dsn) : undefined;
	if (!dsn) return undefined;
	const url = getEnvelopeEndpointWithUrlEncodedAuth(dsn, options.tunnel, {
		name: SDK_NAME,
		version: SDK_VERSION,
	});
	const timeoutMs = options.timeoutMs ?? 5_000;
	const executor = options.send
		? (request: TransportRequest) =>
				options.send!({ url, body: request.body }).then(toTransportResponse)
		: (request: TransportRequest) =>
				fetch(url, {
					...fetchInit,
					method: "POST",
					body: request.body as BodyInit,
					// The page URL can carry invite tokens or ids; never send it.
					referrerPolicy: "no-referrer",
					credentials: "omit",
					signal: AbortSignal.timeout(timeoutMs),
				}).then((response) =>
					toTransportResponse({
						statusCode: response.status,
						headers: {
							"x-sentry-rate-limits": response.headers.get(
								"x-sentry-rate-limits",
							),
							"retry-after": response.headers.get("retry-after"),
						},
					}),
				);

	const transport: Transport = createTransport(
		{
			bufferSize: options.bufferSize ?? 30,
			recordDroppedEvent: () => {},
		},
		executor,
	);

	return {
		async send(event) {
			const envelope = createEventEnvelope(
				event,
				dsn as DsnComponents,
				{ sdk: { name: SDK_NAME, version: SDK_VERSION } },
				options.tunnel,
			);
			await transport.send(envelope);
		},
		async flush(timeoutMs) {
			return transport.flush(timeoutMs);
		},
	};
}

function toTransportResponse(response: {
	statusCode?: number;
	headers?: Record<string, string | null>;
}): TransportMakeRequestResponse {
	return {
		statusCode: response.statusCode,
		headers: {
			"x-sentry-rate-limits":
				response.headers?.["x-sentry-rate-limits"] ?? null,
			"retry-after": response.headers?.["retry-after"] ?? null,
		},
	};
}

export interface EventInput {
	platform: "node" | "javascript";
	exceptions: SanitizedException[];
	/** Shown in place of the (never sent) error message. */
	value: string;
	mechanism: string;
	handled: boolean;
	transaction?: string;
	tags: Record<string, string>;
	trace?: { traceId: string; spanId: string };
	release?: string;
	environment?: string;
}

/** The complete event. Every field is listed here; nothing else is sent. */
export function buildEvent(input: EventInput): Event {
	const values = input.exceptions
		.map((exception, index) => ({
			type: exception.type,
			value: index === 0 ? input.value : "[redacted]",
			...(exception.frames.length
				? { stacktrace: { frames: exception.frames as StackFrame[] } }
				: {}),
			mechanism: {
				type: index === 0 ? input.mechanism : "chained",
				handled: input.handled,
				exception_id: index,
				...(index > 0 ? { parent_id: index - 1, source: "cause" } : {}),
			},
		}))
		// Sentry lists the outermost exception last.
		.toReversed();

	const images = debugImages(input.exceptions);
	return {
		event_id: uuid4(),
		timestamp: dateTimestampInSeconds(),
		platform: input.platform,
		level: "error",
		...(input.release ? { release: input.release } : {}),
		...(input.environment ? { environment: input.environment } : {}),
		...(input.transaction ? { transaction: input.transaction } : {}),
		tags: input.tags,
		exception: { values },
		...(input.trace
			? {
					contexts: {
						trace: {
							trace_id: input.trace.traceId,
							span_id: input.trace.spanId,
						},
					},
				}
			: {}),
		...(images.length ? { debug_meta: { images } } : {}),
	};
}

/**
 * Debug-id images for symbolication. The bundler plugin registers
 * `_sentryDebugIds` keyed by a stack captured in each bundle; the map is
 * built from the RAW filenames, then emitted under the sanitized filename so
 * `code_file` matches the frame's `abs_path` on the wire.
 */
function debugImages(exceptions: SanitizedException[]): DebugImage[] {
	let map: Record<string, string>;
	try {
		map = getFilenameToDebugIdMap(stackParser);
	} catch {
		return [];
	}
	const images: DebugImage[] = [];
	const seen = new Set<string>();
	for (const exception of exceptions) {
		for (const [sanitized, raw] of exception.rawFilenames) {
			const debugId = map[raw];
			if (!debugId || seen.has(sanitized)) continue;
			seen.add(sanitized);
			images.push({
				type: "sourcemap",
				code_file: sanitized,
				debug_id: debugId,
			});
		}
	}
	return images;
}

// Keys are `new Error().stack` captured by the bundler snippet: V8 prefixes
// them with "Error", Gecko/WebKit do not.
const stackParser: StackParser = (stack) =>
	parseFrames(stack, "Error").map((frame) => ({
		filename: frame.filename,
		function: frame.function,
		lineno: frame.lineno,
		colno: frame.colno,
	}));
