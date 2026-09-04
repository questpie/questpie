import { expect, jest, test } from "bun:test";

import { createOpenTelemetry } from "../../packages/opentelemetry/src";
import { createOpenTelemetryTestHarness } from "../../packages/opentelemetry/src/testing";
import { createApplicationObservation } from "../../packages/runtime/src/application/observation";

const releaseVersion = "4.0.0-beta.2";
const runtimeInput = Object.freeze({
	applicationIdentity: "application:adapter-fault",
	createRuntimeInstanceId: () => "01234567-89ab-4def-8123-456789abcdef",
	runtimeBuildDigest: "a".repeat(64),
	questpieVersion: releaseVersion,
});

test("accounts one contained adapter event fault without changing Runtime work", async () => {
	const harness = await createOpenTelemetryTestHarness({
		faults: {
			beforeSpanEvent: () => {
				throw new Error("private exporter sentinel");
			},
		},
	} as never);
	try {
		const observation = createApplicationObservation({
			...runtimeInput,
			observability: harness.observability,
			signalProjectionDigest: harness.signalProjectionDigest,
		})!;
		const execution = observation.beginExecution({
			entry: "direct",
			kind: "execution",
			principalKind: "user",
			trace: { kind: "root" },
		})!;
		let work = 0;
		await execution.scope.run(async () => {
			work += 1;
			execution.scope.event({ kind: "context.completed" });
		});
		execution.scope.end({ kind: "execution", outcome: "ok" });
		await harness.forceFlush();
		expect(work).toBe(1);
		expect(harness.finishedSpans()).toEqual([]);

		const dropped = harness
			.finishedMetrics()
			.flatMap((resource) => resource.scopeMetrics)
			.flatMap((scope) => scope.metrics)
			.find(
				(metric) => metric.descriptor.name === "questpie.observation.dropped",
			);
		expect(dropped?.dataPoints).toHaveLength(1);
		expect(dropped?.dataPoints[0]?.attributes).toEqual({
			cause: "adapter_fault",
			signal: "event",
		});
		expect(dropped?.dataPoints[0]?.value).toBe(1);
	} finally {
		await harness.close();
	}
});

test("shares one bounded close after binding", async () => {
	jest.useFakeTimers();
	let shutdownCalls = 0;
	const never = new Promise<void>(() => undefined);
	const harness = await createOpenTelemetryTestHarness({
		closeTimeoutMilliseconds: 25,
		sdkClose: () => {
			shutdownCalls += 1;
			return never;
		},
	} as never);
	try {
		expect(
			createApplicationObservation({
				...runtimeInput,
				observability: harness.observability,
				signalProjectionDigest: harness.signalProjectionDigest,
			}),
		).not.toBeNull();
		const first = harness.close();
		const concurrent = harness.close();
		expect(concurrent).toBe(first);
		expect(shutdownCalls).toBe(1);
		jest.advanceTimersByTime(24);
		let settled = false;
		void first.then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);
		jest.advanceTimersByTime(1);
		await first;
		expect(settled).toBe(true);
		expect(shutdownCalls).toBe(1);
		await expect(harness.close()).resolves.toBeUndefined();
		expect(shutdownCalls).toBe(1);
	} finally {
		jest.useRealTimers();
	}
});

test("public pre-bind close is concurrent, idempotent, and terminal", async () => {
	const telemetry = await createOpenTelemetry();
	const first = telemetry.close();
	const concurrent = telemetry.close();
	expect(concurrent).toBe(first);
	await expect(first).resolves.toBeUndefined();
	await expect(telemetry.close()).resolves.toBeUndefined();
	expect(() =>
		createApplicationObservation({
			...runtimeInput,
			observability: telemetry,
			signalProjectionDigest:
				"7e192a2a4d0a61b5c926415fd2f612c6b2d45ec05149fc6d2f407f30f2aeddd3",
		}),
	).toThrow("QP-OTEL-001 invalidConfiguration: closed");
});
