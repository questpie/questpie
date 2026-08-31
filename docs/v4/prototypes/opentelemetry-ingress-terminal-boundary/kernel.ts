export type NeutralTraceContextV1 = Readonly<{
	flags: number;
	format: "questpie.trace-context";
	spanId: Uint8Array;
	traceId: Uint8Array;
	version: 1;
}>;

export type ExtractedTraceContextV1 = Readonly<{
	context: NeutralTraceContextV1;
	tracestate: string | null;
}>;

export type IngressTracePlanV1 =
	| Readonly<{
			extracted: ExtractedTraceContextV1;
			kind: "remote-parent";
	  }>
	| Readonly<{
			kind: "root-with-links";
			links: readonly [NeutralTraceContextV1];
	  }>;

type HttpObservationOutcome =
	| "ok"
	| "framework_error"
	| "cancelled"
	| "deadline";

export type HttpObservationEndV1 =
	| Readonly<{
			errorCode?: string;
			httpResponseStatusCode: number;
			kind: "fetch" | "route";
			outcome: HttpObservationOutcome;
	  }>
	| Readonly<{
			errorCode?: string;
			httpResponseStatusCode: null;
			kind: "fetch" | "route";
			outcome: Exclude<HttpObservationOutcome, "ok">;
	  }>;

const ENCODER = new TextEncoder();

function exactKeys(
	value: object,
	allowed: readonly string[],
	required: readonly string[],
): boolean {
	const allow = new Set(allowed);
	return (
		Reflect.ownKeys(value).every(
			(key) => typeof key === "string" && allow.has(key),
		) && required.every((key) => Object.hasOwn(value, key))
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTraceBytes(value: unknown, length: number): value is Uint8Array {
	return (
		value instanceof Uint8Array &&
		value.byteLength === length &&
		value.some((byte) => byte !== 0)
	);
}

function decodeContext(value: unknown): NeutralTraceContextV1 | null {
	if (
		!isRecord(value) ||
		!exactKeys(
			value,
			["flags", "format", "spanId", "traceId", "version"],
			["flags", "format", "spanId", "traceId", "version"],
		) ||
		value.format !== "questpie.trace-context" ||
		value.version !== 1 ||
		!Number.isInteger(value.flags) ||
		(value.flags as number) < 0 ||
		(value.flags as number) > 255 ||
		!isTraceBytes(value.traceId, 16) ||
		!isTraceBytes(value.spanId, 8)
	)
		return null;
	return Object.freeze({
		flags: value.flags as number,
		format: "questpie.trace-context",
		spanId: Uint8Array.from(value.spanId),
		traceId: Uint8Array.from(value.traceId),
		version: 1,
	});
}

function validTracestate(value: unknown): value is string | null {
	return (
		value === null ||
		(typeof value === "string" &&
			ENCODER.encode(value).byteLength <= 512 &&
			/^[\x20-\x7e]+$/u.test(value))
	);
}

export function decodeIngressTracePlan(
	value: unknown,
): IngressTracePlanV1 | null {
	if (!isRecord(value)) return null;
	if (value.kind === "remote-parent") {
		if (
			!exactKeys(value, ["extracted", "kind"], ["extracted", "kind"]) ||
			!isRecord(value.extracted) ||
			!exactKeys(
				value.extracted,
				["context", "tracestate"],
				["context", "tracestate"],
			) ||
			!validTracestate(value.extracted.tracestate)
		)
			return null;
		const context = decodeContext(value.extracted.context);
		if (context === null) return null;
		return Object.freeze({
			extracted: Object.freeze({
				context,
				tracestate: value.extracted.tracestate,
			}),
			kind: "remote-parent",
		});
	}
	if (
		value.kind !== "root-with-links" ||
		!exactKeys(value, ["kind", "links"], ["kind", "links"]) ||
		!Array.isArray(value.links) ||
		value.links.length !== 1
	)
		return null;
	const context = decodeContext(value.links[0]);
	if (context === null) return null;
	return Object.freeze({
		kind: "root-with-links",
		links: Object.freeze([context]) as readonly [NeutralTraceContextV1],
	});
}

const HTTP_OUTCOMES = new Set<HttpObservationOutcome>([
	"ok",
	"framework_error",
	"cancelled",
	"deadline",
]);

export function decodeHttpObservationEnd(
	value: unknown,
): HttpObservationEndV1 | null {
	if (
		!isRecord(value) ||
		!exactKeys(
			value,
			["errorCode", "httpResponseStatusCode", "kind", "outcome"],
			["httpResponseStatusCode", "kind", "outcome"],
		) ||
		(value.kind !== "fetch" && value.kind !== "route") ||
		typeof value.outcome !== "string" ||
		!HTTP_OUTCOMES.has(value.outcome as HttpObservationOutcome) ||
		(value.errorCode !== undefined &&
			(typeof value.errorCode !== "string" ||
				ENCODER.encode(value.errorCode).byteLength > 128 ||
				!/^[A-Za-z0-9_.:-]+$/u.test(value.errorCode)))
	)
		return null;
	if (value.httpResponseStatusCode === null) {
		if (value.outcome === "ok") return null;
	} else if (
		!Number.isInteger(value.httpResponseStatusCode) ||
		(value.httpResponseStatusCode as number) < 100 ||
		(value.httpResponseStatusCode as number) > 599
	)
		return null;
	return Object.freeze({ ...value }) as HttpObservationEndV1;
}
