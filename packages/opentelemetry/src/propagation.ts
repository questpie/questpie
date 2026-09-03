import {
	ROOT_CONTEXT,
	createTraceState,
	isSpanContextValid,
	trace,
	type Context,
	type ContextManager,
	type SpanContext,
	type TextMapGetter,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";

import type { NeutralContext, TracePlan } from "./projection";

type IngressHeaders = Readonly<{
	traceparent: string | null;
	tracestate: string | null;
}>;

const propagator = new W3CTraceContextPropagator();
const getter: TextMapGetter<IngressHeaders> = Object.freeze({
	get(carrier: IngressHeaders, key: string) {
		if (key === "traceparent" || key === "tracestate")
			return carrier[key] ?? undefined;
		return undefined;
	},
	keys() {
		return ["traceparent", "tracestate"];
	},
});

function bytes(hex: string): Uint8Array {
	return Uint8Array.from(hex.match(/../gu) ?? [], (pair) =>
		Number.parseInt(pair, 16),
	);
}

function hex(value: Uint8Array): string {
	return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

export function neutral(value: SpanContext): NeutralContext {
	return Object.freeze({
		format: "questpie.trace-context",
		version: 1,
		traceId: bytes(value.traceId),
		spanId: bytes(value.spanId),
		flags: value.traceFlags,
	});
}

export function spanContext(
	value: NeutralContext,
	remote = false,
): SpanContext {
	return {
		traceId: hex(value.traceId),
		spanId: hex(value.spanId),
		traceFlags: value.flags,
		isRemote: remote,
	};
}

function extractW3cContext(headers: IngressHeaders): SpanContext | null {
	if (headers.traceparent === null) return null;
	if (
		headers.tracestate !== null &&
		(headers.tracestate.length === 0 ||
			Buffer.byteLength(headers.tracestate, "utf8") > 512 ||
			!/^[\x20-\x7e]+$/u.test(headers.tracestate))
	)
		return null;
	try {
		const context = propagator.extract(ROOT_CONTEXT, headers, getter);
		const extracted = trace.getSpanContext(context);
		if (extracted === undefined || !isSpanContextValid(extracted)) return null;
		if (headers.tracestate !== null) {
			const normalized = headers.tracestate
				.split(",")
				.map((member) => member.trim())
				.join(",");
			if (extracted.traceState?.serialize() !== normalized) return null;
		}
		return extracted;
	} catch {
		return null;
	}
}

export function extractTracePlan(
	headers: IngressHeaders,
	trustBoundary: "continue" | "restart",
) {
	const span = extractW3cContext(headers);
	if (span === null) return null;
	const extracted = Object.freeze({
		context: neutral(span),
		tracestate: span.traceState?.serialize() ?? null,
	});
	return trustBoundary === "restart"
		? Object.freeze({
				kind: "root-with-links" as const,
				links: Object.freeze([extracted.context] as const),
			})
		: Object.freeze({ kind: "remote-parent" as const, extracted });
}

export function parentContext(
	plan: TracePlan,
	manager: ContextManager,
): Context {
	if (plan.kind === "active-parent") {
		const active = manager.active();
		const activeSpan = trace.getSpanContext(active);
		return activeSpan !== undefined && isSpanContextValid(activeSpan)
			? active
			: ROOT_CONTEXT;
	}
	if (plan.kind !== "remote-parent" || plan.extracted === undefined)
		return ROOT_CONTEXT;
	const extracted = plan.extracted;
	const value = spanContext(extracted.context, true);
	return trace.setSpanContext(
		ROOT_CONTEXT,
		extracted.tracestate === null
			? value
			: { ...value, traceState: createTraceState(extracted.tracestate) },
	);
}
