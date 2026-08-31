import { describe, expect, test } from "bun:test";

import {
	decodeHttpObservationEnd,
	decodeIngressTracePlan,
	type NeutralTraceContextV1,
} from "./kernel";

const context: NeutralTraceContextV1 = Object.freeze({
	flags: 1,
	format: "questpie.trace-context",
	spanId: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]),
	traceId: Uint8Array.from([
		1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
	]),
	version: 1,
});

describe("OpenTelemetry ingress trace plan delta", () => {
	test("carries continue and restart as explicit disjoint plans", () => {
		expect(
			decodeIngressTracePlan({
				extracted: { context, tracestate: "vendor=value" },
				kind: "remote-parent",
			}),
		).toEqual({
			extracted: { context, tracestate: "vendor=value" },
			kind: "remote-parent",
		});
		expect(
			decodeIngressTracePlan({ kind: "root-with-links", links: [context] }),
		).toEqual({ kind: "root-with-links", links: [context] });
	});

	test("rejects ambiguous, structurally open, and invalid plans", () => {
		for (const value of [
			{ context, tracestate: null },
			{ kind: "continue", context, tracestate: null },
			{
				kind: "remote-parent",
				extracted: { context, tracestate: null },
				extra: 1,
			},
			{ kind: "root-with-links", links: [] },
			{ kind: "root-with-links", links: [context, context] },
			{ kind: "root-with-links", links: [context], tracestate: "must-drop" },
		])
			expect(decodeIngressTracePlan(value)).toBeNull();
	});
});

describe("OpenTelemetry HTTP terminal delta", () => {
	test("distinguishes a received Response from a pre-Response terminal", () => {
		expect(
			decodeHttpObservationEnd({
				httpResponseStatusCode: 201,
				kind: "fetch",
				outcome: "ok",
			}),
		).toEqual({
			httpResponseStatusCode: 201,
			kind: "fetch",
			outcome: "ok",
		});
		expect(
			decodeHttpObservationEnd({
				httpResponseStatusCode: null,
				kind: "route",
				outcome: "cancelled",
			}),
		).toEqual({
			httpResponseStatusCode: null,
			kind: "route",
			outcome: "cancelled",
		});
	});

	test("forbids synthetic, missing, successful, or declared-error pre-Response ends", () => {
		for (const value of [
			{ kind: "fetch", outcome: "framework_error" },
			{ httpResponseStatusCode: 0, kind: "fetch", outcome: "framework_error" },
			{ httpResponseStatusCode: 500, kind: "fetch", outcome: "declared_error" },
			{ httpResponseStatusCode: null, kind: "fetch", outcome: "ok" },
			{
				httpResponseStatusCode: null,
				kind: "fetch",
				outcome: "declared_error",
			},
			{
				errorCode: "INTERNAL",
				httpResponseStatusCode: null,
				kind: "fetch",
				outcome: "framework_error",
				extra: true,
			},
		])
			expect(decodeHttpObservationEnd(value)).toBeNull();
	});
});
