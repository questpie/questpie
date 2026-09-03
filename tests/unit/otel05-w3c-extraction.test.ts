import { expect, test } from "bun:test";

import { decodeOpenTelemetryConfiguration } from "../../packages/opentelemetry/src/config";
import { parentContext } from "../../packages/opentelemetry/src/propagation";
import { createOpenTelemetrySdk } from "../../packages/opentelemetry/src/sdk";

const traceId = "0af7651916cd43dd8448eb211c80319c";
const spanId = "b7ad6b7169203331";
const metadata = Object.freeze({
	applicationIdentity: "application:w3c-extraction",
	questpieVersion: "4.0.0-beta.1",
	runtimeBuildDigest: "a".repeat(64),
	runtimeInstanceId: "01234567-89ab-4def-8123-456789abcdef",
	signalProjectionDigest:
		"b2138ccb6f40f0a95df1573848fb239124b57420609e6f9f9d97d378b6a62d58",
});

test("treats an invalid ambient span as an absent active parent", () => {
	const invalid = { getValue: () => undefined };
	const manager = { active: () => invalid };
	expect(parentContext({ kind: "active-parent" }, manager as never)).toBe(
		parentContext({ kind: "root" }, manager as never),
	);
});

function sdk(trustBoundary: "continue" | "restart") {
	return createOpenTelemetrySdk({
		metadata,
		configuration: decodeOpenTelemetryConfiguration(
			{ ingress: { trustBoundary } },
			{ OTEL_METRICS_EXPORTER: "none", OTEL_TRACES_EXPORTER: "none" },
		),
	});
}

test("uses the local W3C propagator for continue and restart plans", async () => {
	const continuing = sdk("continue");
	const restarting = sdk("restart");
	try {
		const exactBoundary = `a=${"x".repeat(255)},b=${"y".repeat(252)}`;
		expect(Buffer.byteLength(exactBoundary, "utf8")).toBe(512);
		expect(
			continuing.adapter.extract({
				traceparent: `00-${traceId}-${spanId}-00`,
				tracestate: exactBoundary,
			}),
		).toMatchObject({
			kind: "remote-parent",
			extracted: { context: { flags: 0 }, tracestate: exactBoundary },
		});
		const headers = {
			traceparent: `01-${traceId}-${spanId}-01-future=value`,
			tracestate: "vendor=value,tenant@system=opaque",
		};
		expect(continuing.adapter.extract(headers)).toEqual({
			kind: "remote-parent",
			extracted: {
				context: {
					format: "questpie.trace-context",
					version: 1,
					traceId: Uint8Array.from(Buffer.from(traceId, "hex")),
					spanId: Uint8Array.from(Buffer.from(spanId, "hex")),
					flags: 1,
				},
				tracestate: "vendor=value,tenant@system=opaque",
			},
		});
		const restart = restarting.adapter.extract(headers);
		expect(restart).toMatchObject({
			kind: "root-with-links",
			links: [
				{ traceId: expect.any(Uint8Array), spanId: expect.any(Uint8Array) },
			],
		});
		expect(restart).not.toHaveProperty("extracted");
		expect(JSON.stringify(restart)).not.toContain("vendor=value");
	} finally {
		await continuing.close();
		await restarting.close();
	}
});

test("rejects invalid W3C parent and tracestate as an absent plan", async () => {
	const telemetry = sdk("continue");
	try {
		for (const headers of [
			{ traceparent: null, tracestate: "vendor=value" },
			{ traceparent: `ff-${traceId}-${spanId}-01`, tracestate: null },
			{
				traceparent: `00-${traceId.toUpperCase()}-${spanId}-01`,
				tracestate: null,
			},
			{ traceparent: `00-${traceId.slice(1)}-${spanId}-01`, tracestate: null },
			{ traceparent: `00-${"0".repeat(32)}-${spanId}-01`, tracestate: null },
			{ traceparent: `00-${traceId}-${"0".repeat(16)}-01`, tracestate: null },
			{ traceparent: `00-${traceId}-${spanId}-01-extra`, tracestate: null },
			{
				traceparent: `00-${traceId}-${spanId}-01`,
				tracestate: "bad key=value",
			},
			{ traceparent: `00-${traceId}-${spanId}-01`, tracestate: "a=1,a=2" },
			{
				traceparent: `00-${traceId}-${spanId}-01`,
				tracestate: `a=${"x".repeat(511)}`,
			},
			{ traceparent: `00-${traceId}-${spanId}-01`, tracestate: "a=ok\u007f" },
		] as const)
			expect(telemetry.adapter.extract(headers)).toBeNull();
	} finally {
		await telemetry.close();
	}
});
