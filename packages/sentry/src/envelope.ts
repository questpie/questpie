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
	const request = options.send
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

	// Every request, custom or fetch, settles by the deadline so its buffer
	// slot is released; a late rejection is absorbed.
	const executor = (transportRequest: TransportRequest) =>
		withTimeout(
			new Promise<TransportMakeRequestResponse>((resolve) =>
				resolve(request(transportRequest)),
			),
			timeoutMs,
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("Sentry envelope request timed out")),
			timeoutMs,
		);
		(timer as { unref?: () => void }).unref?.();
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
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
	const { exceptions, locations } = withoutAmbiguousLocations(input.exceptions);
	const values = exceptions
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

	const images = debugImages(locations);
	return {
		event_id: uuid4(),
		timestamp: dateTimestampInSeconds(),
		platform: input.platform,
		level: "error",
		// Without it, Sentry stores the sender's IP as the user of a browser
		// event and derives its location.
		sdk: {
			name: SDK_NAME,
			version: SDK_VERSION,
			settings: { infer_ip: "never" },
		},
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
function debugImages(locations: ReadonlyMap<string, string>): DebugImage[] {
	const registered = registeredFiles();
	const images: DebugImage[] = [];
	for (const [sanitized, raw] of locations) {
		const debugId = registered.get(raw);
		if (debugId) {
			images.push({
				type: "sourcemap",
				code_file: sanitized,
				debug_id: debugId,
			});
		}
	}
	return images;
}

/**
 * Two different files can rewrite to one location (the same `/assets/main.js`
 * on two hosts). A debug image per location could then symbolicate one file's
 * frames with the other's source map, so an ambiguous location is dropped from
 * every frame instead — they keep line and column. Returns the exceptions and
 * each remaining location's single raw filename.
 */
function withoutAmbiguousLocations(exceptions: SanitizedException[]): {
	exceptions: SanitizedException[];
	locations: Map<string, string>;
} {
	const raws = new Map<string, Set<string>>();
	for (const exception of exceptions) {
		for (const [location, names] of exception.rawFilenames) {
			const all = raws.get(location) ?? new Set<string>();
			for (const name of names) all.add(name);
			raws.set(location, all);
		}
	}
	const locations = new Map<string, string>();
	const ambiguous = new Set<string>();
	for (const [location, names] of raws) {
		if (names.size === 1) locations.set(location, [...names][0]!);
		else ambiguous.add(location);
	}
	if (ambiguous.size === 0) return { exceptions, locations };
	return {
		locations,
		exceptions: exceptions.map((exception) => ({
			...exception,
			frames: exception.frames.map((frame) =>
				frame.filename !== undefined && ambiguous.has(frame.filename)
					? { lineno: frame.lineno, colno: frame.colno }
					: frame,
			),
		})),
	};
}

/**
 * Raw filename → debug id for every build artifact the bundler plugin
 * registered in this process. These are the only files whose location is
 * trusted by default.
 */
export function registeredFiles(): ReadonlyMap<string, string> {
	try {
		return new Map(Object.entries(getFilenameToDebugIdMap(stackParser)));
	} catch {
		return new Map();
	}
}

// Keys are `new Error().stack` captured by the bundler snippet: V8 prefixes
// them with "Error", Gecko/WebKit do not. Sentry's StackParser contract is
// OLDEST frame first — `getFilenameToDebugIdMap` takes the last (newest) frame
// as the file that registered the id, i.e. the chunk running the snippet, not
// the entry that imported it. Stack strings list the newest first.
const stackParser: StackParser = (stack) =>
	parseFrames(stack, "Error")
		.map((frame) => ({
			filename: frame.filename,
			function: frame.function,
			lineno: frame.lineno,
			colno: frame.colno,
		}))
		.toReversed();
