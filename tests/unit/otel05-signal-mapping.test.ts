import { expect, test } from "bun:test";

import { digest } from "../../packages/compiler/src/canonical";
import { projectObservationSignalProjection } from "../../packages/compiler/src/observation";
import { EXPECTED_SIGNAL_PROJECTION_DIGEST } from "../../packages/opentelemetry/src/config";
import {
	SIGNAL_PROJECTION_ARTIFACT,
	SIGNAL_PROJECTION_DIGEST,
} from "../../packages/opentelemetry/src/generated/signal-projection.gen";
import {
	ADAPTER_METRIC_DEFINITIONS,
	DURABLE_HISTOGRAM_BOUNDARIES,
	OPERATION_HISTOGRAM_BOUNDARIES,
	projectSpanAttributes,
	spanDefinition,
} from "../../packages/opentelemetry/src/projection";
import {
	createOpenTelemetryTestHarness,
	installOpenTelemetryAmbientContextTestHarness,
} from "../../packages/opentelemetry/src/testing";
import { createApplicationObservation } from "../../packages/runtime/src/application/observation";

type ReadableSpan = Readonly<{
	attributes: Readonly<Record<string, unknown>>;
	events: readonly Readonly<{
		attributes?: Readonly<Record<string, unknown>>;
		name: string;
	}>[];
	instrumentationScope: Readonly<{ name: string; version?: string }>;
	kind: number;
	name: string;
	parentSpanContext?: Readonly<{ spanId: string }>;
	resource: Readonly<{ attributes: Readonly<Record<string, unknown>> }>;
	spanContext(): Readonly<{ spanId: string }>;
	status: Readonly<{ code: number; message?: string }>;
}>;

const INTERNAL = 0;
const SERVER = 1;
const CLIENT = 2;
const PRODUCER = 3;
const CONSUMER = 4;
const UNSET = 0;
const ERROR = 2;
const releaseVersion = "4.0.0-beta.1";

test("projects adapter attributes only through compiler-owned scope authority", () => {
	const attributes = projectSpanAttributes({
		metadata: {
			applicationIdentity: "application:attribute-authority",
			questpieVersion: releaseVersion,
			runtimeBuildDigest: "a".repeat(64),
			runtimeInstanceId: "01234567-89ab-4def-8123-456789abcdef",
			signalProjectionDigest: SIGNAL_PROJECTION_DIGEST,
		},
		operationalIds: "spans",
		scope: "query",
		start: {
			entry: "direct",
			kind: "query",
			resourceIdentity: "query:tickets.page",
			trace: { kind: "active-parent" },
		},
	});
	expect(attributes).toEqual({
		"questpie.execution.entry": "direct",
		"questpie.operation.kind": "query",
		"questpie.resource": "query:tickets.page",
		"questpie.runtime.instance.id": "01234567-89ab-4def-8123-456789abcdef",
	});
	expect(
		Object.keys(attributes).every((name) =>
			(
				SIGNAL_PROJECTION_ARTIFACT.spanAttributeScopes[
					name as keyof typeof SIGNAL_PROJECTION_ARTIFACT.spanAttributeScopes
				] as readonly string[]
			).includes("query"),
		),
	).toBe(true);
});

test("mechanically binds every executable adapter projection fact to the compiler artifact", () => {
	const canonical = projectObservationSignalProjection(releaseVersion);
	const starts = [
		{
			kind: "fetch",
			method: "POST",
			requestKind: "generated_operation",
			trace: { kind: "root" },
		},
		{
			kind: "route",
			method: "GET",
			routeTemplate: "/tickets/:ticketId",
			trace: { kind: "root" },
		},
		{
			kind: "fetch",
			method: "_OTHER",
			requestKind: "unmatched",
			trace: { kind: "root" },
		},
		{ kind: "execution", trace: { kind: "root" } },
		{
			kind: "query",
			resourceIdentity: "query:tickets.page",
			trace: { kind: "root" },
		},
		{
			kind: "mutation",
			resourceIdentity: "mutation:tickets.close",
			trace: { kind: "root" },
		},
		{
			kind: "action",
			resourceIdentity: "action:notifications.send",
			trace: { kind: "root" },
		},
		{ kind: "transaction", trace: { kind: "root" } },
		{
			kind: "postgresql",
			databaseOperation: "UPDATE",
			trace: { kind: "root" },
		},
		{
			kind: "job.accept",
			resourceIdentity: "job:reports.digest",
			trace: { kind: "root" },
		},
		{
			kind: "reaction.accept",
			resourceIdentity: "reaction:tickets.changed",
			trace: { kind: "root" },
		},
		{
			kind: "job.attempt",
			resourceIdentity: "job:reports.digest",
			trace: { kind: "root" },
		},
		{
			kind: "reaction.attempt",
			resourceIdentity: "reaction:tickets.changed",
			trace: { kind: "root" },
		},
		{
			kind: "action.effect",
			resourceIdentity: "action:notifications.send",
			trace: { kind: "root" },
		},
	] as const;
	const kindName = [
		"INTERNAL",
		"SERVER",
		"CLIENT",
		"PRODUCER",
		"CONSUMER",
	] as const;

	expect(SIGNAL_PROJECTION_ARTIFACT).toEqual(canonical.artifact);
	expect(SIGNAL_PROJECTION_DIGEST).toBe(canonical.digest);
	expect(EXPECTED_SIGNAL_PROJECTION_DIGEST).toBe(canonical.digest);
	expect(
		starts.map((start) => {
			const definition = spanDefinition(start);
			if (definition === null) throw new Error("expected projected span");
			return { kind: kindName[definition.kind], name: definition.name };
		}),
	).toEqual(
		canonical.artifact.spanGraph.map(({ kind, name }) => ({
			kind,
			name: name
				.replace("{METHOD} {matched route template}", "GET /tickets/:ticketId")
				.replace("{METHOD}", "_OTHER")
				.replace("{UPPERCASE SQL verb}", "UPDATE")
				.replace(
					"{Resource identity}",
					name.startsWith("query ")
						? "query:tickets.page"
						: name.startsWith("mutation ")
							? "mutation:tickets.close"
							: name.startsWith("reaction ")
								? "reaction:tickets.changed"
								: name.startsWith("job ")
									? "job:reports.digest"
									: "action:notifications.send",
				),
		})),
	);
	expect(ADAPTER_METRIC_DEFINITIONS).toEqual(canonical.artifact.metrics);
	expect(OPERATION_HISTOGRAM_BOUNDARIES).toEqual(
		canonical.artifact.operationHistogramBoundariesSeconds,
	);
	expect(DURABLE_HISTOGRAM_BOUNDARIES).toEqual(
		canonical.artifact.durableHistogramBoundariesSeconds,
	);
	const mutants = [
		{
			...structuredClone(canonical.artifact),
			spanGraph: canonical.artifact.spanGraph.slice(1),
		},
		{ ...structuredClone(canonical.artifact), spanAttributeScopes: {} },
		{
			...structuredClone(canonical.artifact),
			spanEventNames: canonical.artifact.spanEventNames.slice(1),
		},
		{
			...structuredClone(canonical.artifact),
			durableHistogramBoundariesSeconds: [1],
		},
	];
	for (const mutant of mutants) {
		expect(mutant).not.toEqual(SIGNAL_PROJECTION_ARTIFACT);
		expect(digest("questpie-opentelemetry-projection-v1", mutant)).not.toBe(
			SIGNAL_PROJECTION_DIGEST,
		);
	}
});

test("suppresses owned same-layer instrumentation and re-enables outbound Action work", async () => {
	const ambient = installOpenTelemetryAmbientContextTestHarness();
	const harness = await createOpenTelemetryTestHarness({});
	createApplicationObservation({
		applicationIdentity: "application:same-layer-suppression",
		createRuntimeInstanceId: () => "01234567-89ab-4def-8123-456789abcdef",
		observability: harness.observability,
		runtimeBuildDigest: "a".repeat(64),
		signalProjectionDigest: harness.signalProjectionDigest,
		questpieVersion: releaseVersion,
	});
	const adapter = harness.adapter()!;
	try {
		const fetch = adapter.begin({
			kind: "fetch",
			method: "GET",
			principalKind: "anonymous",
			requestKind: "unmatched",
			scheme: "https",
			suppressHttp: true,
			trace: { kind: "root" },
		});
		await fetch.run(async () => {
			expect(ambient.isTracingSuppressed()).toBe(true);
			const action = adapter.begin({
				entry: "direct",
				kind: "action",
				principalKind: "user",
				resourceIdentity: "action:notifications.send",
				trace: { kind: "active-parent" },
			});
			await action.run(async () => {
				expect(ambient.isTracingSuppressed()).toBe(false);
			});
			action.end({ kind: "action", outcome: "ok" });
		});
		fetch.end({ httpResponseStatusCode: 200, kind: "fetch", outcome: "ok" });

		const postgres = adapter.begin({
			databaseOperation: "SELECT",
			kind: "postgresql",
			principalKind: "user",
			statementIdentity: "query.tickets.page",
			suppressPostgres: true,
			trace: { kind: "root" },
		});
		await postgres.run(async () => {
			expect(ambient.isTracingSuppressed()).toBe(true);
		});
		postgres.end({ kind: "postgresql", outcome: "ok" });
	} finally {
		await harness.close();
		ambient.close();
	}
});

function byName(spans: readonly ReadableSpan[], name: string): ReadableSpan {
	const span = spans.find((candidate) => candidate.name === name);
	expect(span, `missing exported span ${name}`).toBeDefined();
	return span!;
}

test("projects one root Execution, Query, and PostgreSQL call without forbidden material", async () => {
	const harness = await createOpenTelemetryTestHarness({
		options: { operationalIds: "omit" },
	});
	try {
		const observation = createApplicationObservation({
			applicationIdentity: "application:signal-mapping",
			createRuntimeInstanceId: () => "01234567-89ab-4def-8123-456789abcdef",
			observability: harness.observability,
			runtimeBuildDigest: "a".repeat(64),
			signalProjectionDigest: harness.signalProjectionDigest,
			questpieVersion: releaseVersion,
		});
		expect(observation).not.toBeNull();

		const execution = observation!.beginExecution({
			entry: "direct",
			kind: "execution",
			principalKind: "user",
			trace: { kind: "root" },
		});
		expect(execution).not.toBeNull();
		await execution!.scope.run(async () => {
			execution!.scope.event({ kind: "context.completed" });
			const query = execution!.observation.begin({
				entry: "direct",
				kind: "query",
				principalKind: "user",
				resourceIdentity: "query:messages.page",
				trace: { kind: "active-parent" },
			});
			await query.run(async () => {
				const postgres = execution!.observation.begin({
					databaseOperation: "SELECT",
					kind: "postgresql",
					principalKind: "user",
					statementIdentity: "query.messages.page.select",
					suppressPostgres: true,
					trace: { kind: "active-parent" },
				});
				await postgres.run(async () => undefined);
				postgres.end({
					errorCode: "STATEMENT_FAILED",
					kind: "postgresql",
					outcome: "framework_error",
				});
			});
			query.end({ kind: "query", outcome: "ok" });
		});
		execution!.scope.end({ kind: "execution", outcome: "ok" });
		await harness.forceFlush();

		const spans = harness.finishedSpans() as readonly ReadableSpan[];
		expect(spans).toHaveLength(3);
		const root = byName(spans, "questpie execution");
		const query = byName(spans, "query query:messages.page");
		const postgres = byName(spans, "SELECT");

		expect(root.kind).toBe(INTERNAL);
		expect(root.parentSpanContext).toBeUndefined();
		expect(query.kind).toBe(INTERNAL);
		expect(query.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
		expect(postgres.kind).toBe(CLIENT);
		expect(postgres.parentSpanContext?.spanId).toBe(query.spanContext().spanId);

		expect(root.attributes).toEqual({
			"questpie.execution.entry": "direct",
			"questpie.outcome": "ok",
		});
		expect(
			root.events.map(({ attributes, name }) => ({ attributes, name })),
		).toEqual([{ attributes: {}, name: "questpie.context.completed" }]);
		expect(root.status).toEqual({ code: UNSET });
		expect(query.attributes).toEqual({
			"questpie.execution.entry": "direct",
			"questpie.operation.kind": "query",
			"questpie.outcome": "ok",
			"questpie.resource": "query:messages.page",
		});
		expect(query.events).toEqual([]);
		expect(query.status).toEqual({ code: UNSET });
		expect(postgres.attributes).toEqual({
			"db.operation.name": "SELECT",
			"db.system.name": "postgresql",
			"questpie.error.code": "STATEMENT_FAILED",
			"questpie.outcome": "framework_error",
			"questpie.statement.identity": "query.messages.page.select",
		});
		expect(postgres.events).toEqual([]);
		expect(postgres.status).toEqual({ code: ERROR });

		for (const span of spans) {
			expect(span.instrumentationScope).toMatchObject({
				name: "questpie",
				version: releaseVersion,
			});
			expect(span.resource.attributes).toEqual({
				"questpie.runtime_build.digest": "a".repeat(64),
				"service.instance.id": "01234567-89ab-4def-8123-456789abcdef",
				"service.name": "application:signal-mapping",
				"service.version": releaseVersion,
			});
		}

		const rawProjection = JSON.stringify(
			spans.map((span) => ({
				attributes: span.attributes,
				events: span.events,
				name: span.name,
				resource: span.resource.attributes,
				status: span.status,
			})),
		);
		for (const forbidden of [
			"callIdentity",
			"callId",
			"credentials",
			"databaseUrl",
			"errorMessage",
			"headers",
			"policyEvidence",
			"principalIdentity",
			"providerPayload",
			"requestBody",
			"responseBody",
			"serviceState",
			"sqlParameters",
			"sqlText",
			"stack",
			"tenantIdentity",
			"forbidden-sentinel-value",
		])
			expect(rawProjection).not.toContain(forbidden);
	} finally {
		await harness.close();
	}
});

test("records database-owned Job queue delay without an operational identity dimension", async () => {
	const harness = await createOpenTelemetryTestHarness({ options: {} });
	try {
		const observation = createApplicationObservation({
			applicationIdentity: "application:signal-mapping",
			createRuntimeInstanceId: () => "01234567-89ab-4def-8123-456789abcdef",
			observability: harness.observability,
			runtimeBuildDigest: "a".repeat(64),
			signalProjectionDigest: harness.signalProjectionDigest,
			questpieVersion: releaseVersion,
		})!;
		const execution = observation.beginExecution({
			entry: "worker",
			kind: "execution",
			principalKind: "service",
			trace: { kind: "root" },
		})!;
		await execution.scope.run(async () => {
			const attempt = execution.observation.begin({
				attemptId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6202",
				attemptNumber: 1,
				dispatchId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6201",
				kind: "job.attempt",
				principalKind: "service",
				queueDelayMilliseconds: 125,
				resourceIdentity: "job:reports.companyDigest",
				runId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6200",
				trace: { kind: "root" },
			});
			await attempt.run(async () => undefined);
			attempt.end({ kind: "job.attempt", outcome: "ok" });
		});
		execution.scope.end({ kind: "execution", outcome: "ok" });
		await harness.forceFlush();
		const metrics = harness
			.finishedMetrics()
			.flatMap((resource) => resource.scopeMetrics)
			.flatMap((scope) => scope.metrics);
		const queue = metrics.find(
			(metric) => metric.descriptor.name === "questpie.job.queue.delay",
		);
		expect(queue).toBeDefined();
		const point = queue!.dataPoints[0] as Readonly<{
			attributes: Readonly<Record<string, unknown>>;
			value: Readonly<{ count: number; sum?: number }>;
		}>;
		expect(point.attributes).toEqual({
			"questpie.resource": "job:reports.companyDigest",
		});
		expect(point.value).toMatchObject({ count: 1, sum: 0.125 });
		expect(
			(point.value as Readonly<{ buckets: { boundaries: number[] } }>).buckets
				.boundaries,
		).toEqual([
			0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
			30, 60, 300, 900,
		]);
		expect(point.attributes).not.toHaveProperty("questpie.attempt.id");
	} finally {
		await harness.close();
	}
});

test("keeps the complete accepted span graph closed and runtime spanless", async () => {
	const harness = await createOpenTelemetryTestHarness({ options: {} });
	createApplicationObservation({
		applicationIdentity: "application:closed-span-graph",
		createRuntimeInstanceId: () => "01234567-89ab-4def-8123-456789abcdef",
		observability: harness.observability,
		runtimeBuildDigest: "a".repeat(64),
		signalProjectionDigest: harness.signalProjectionDigest,
		questpieVersion: releaseVersion,
	});
	const adapter = harness.adapter()!;
	const active = { kind: "active-parent" } as const;
	const starts = [
		{
			kind: "runtime",
			principalKind: "service",
			trace: { kind: "root" },
		},
		{
			kind: "fetch",
			method: "POST",
			principalKind: null,
			requestKind: "generated_operation",
			scheme: "https",
			suppressHttp: true,
			trace: { kind: "root" },
		},
		{
			kind: "route",
			method: "GET",
			principalKind: null,
			routeTemplate: "/tickets/:ticketId",
			scheme: "https",
			suppressHttp: true,
			trace: { kind: "root" },
		},
		{
			kind: "fetch",
			method: "_OTHER",
			principalKind: null,
			requestKind: "unmatched",
			scheme: "http",
			suppressHttp: true,
			trace: { kind: "root" },
		},
		{
			entry: "direct",
			kind: "execution",
			principalKind: "user",
			trace: { kind: "root" },
		},
		{
			entry: "direct",
			kind: "query",
			principalKind: "user",
			resourceIdentity: "query:tickets.page",
			trace: active,
		},
		{
			entry: "direct",
			kind: "mutation",
			principalKind: "user",
			resourceIdentity: "mutation:tickets.close",
			trace: active,
		},
		{
			entry: "direct",
			kind: "action",
			principalKind: "user",
			resourceIdentity: "action:notifications.send",
			trace: active,
		},
		{ kind: "transaction", principalKind: "user", trace: active },
		{
			databaseOperation: "UPDATE",
			kind: "postgresql",
			principalKind: "user",
			statementIdentity: "tickets.close.update",
			suppressPostgres: true,
			trace: active,
		},
		{
			kind: "job.accept",
			principalKind: "user",
			resourceIdentity: "job:reports.digest",
			trace: active,
		},
		{
			kind: "reaction.accept",
			principalKind: "user",
			resourceIdentity: "reaction:tickets.changed",
			trace: active,
		},
		{
			attemptNumber: 1,
			kind: "job.attempt",
			principalKind: "service",
			queueDelayMilliseconds: 0,
			resourceIdentity: "job:reports.digest",
			trace: { kind: "root" },
		},
		{
			attemptNumber: 1,
			kind: "reaction.attempt",
			principalKind: "service",
			resourceIdentity: "reaction:tickets.changed",
			trace: { kind: "root" },
		},
		{
			kind: "action.effect",
			principalKind: "service",
			resourceIdentity: "action:notifications.send",
			trace: active,
		},
	] as const;
	try {
		for (const start of starts) {
			const scope = adapter.begin(start);
			await scope.run(async () => undefined);
			if (start.kind === "execution") {
				scope.event({ kind: "context.completed" });
				scope.event({ kind: "execution.cancelled" });
				scope.event({ kind: "execution.deadline_exceeded" });
				for (let index = 0; index < 30; index += 1)
					scope.event({ kind: "context.completed" });
			} else if (start.kind === "mutation") {
				scope.event({ kind: "receipt.replayed" });
				scope.event({ kind: "operation.post_commit_ambiguous" });
			} else if (start.kind === "transaction") {
				scope.event({ kind: "transaction.committed" });
			} else if (start.kind === "job.accept") {
				scope.event({ kind: "durable.accepted" });
			} else if (start.kind === "job.attempt") {
				scope.event({ kind: "durable.fenced" });
				scope.event({
					attemptNumber: 1,
					kind: "durable.retry_scheduled",
					retryDelayMilliseconds: 250,
				});
				scope.event({ kind: "durable.terminal", outcome: "ok" });
			} else if (start.kind === "action.effect") {
				scope.event({ kind: "action.ambiguous" });
			}
			scope.end(
				(start.kind === "fetch" || start.kind === "route"
					? {
							httpResponseStatusCode: 200,
							kind: start.kind,
							outcome: "ok",
						}
					: { kind: start.kind, outcome: "ok" }) as never,
			);
		}
		await harness.forceFlush();
		expect(
			harness
				.finishedSpans()
				.map(({ kind, name }) => ({ kind, name }))
				.sort((left, right) =>
					`${left.kind}:${left.name}`.localeCompare(
						`${right.kind}:${right.name}`,
					),
				),
		).toEqual(
			[
				{ kind: SERVER, name: "POST /_questpie/operation" },
				{ kind: SERVER, name: "GET /tickets/:ticketId" },
				{ kind: SERVER, name: "_OTHER" },
				{ kind: INTERNAL, name: "questpie execution" },
				{ kind: INTERNAL, name: "query query:tickets.page" },
				{ kind: INTERNAL, name: "mutation mutation:tickets.close" },
				{ kind: INTERNAL, name: "action action:notifications.send" },
				{ kind: INTERNAL, name: "questpie transaction" },
				{ kind: CLIENT, name: "UPDATE" },
				{ kind: PRODUCER, name: "job job:reports.digest accept" },
				{
					kind: PRODUCER,
					name: "reaction reaction:tickets.changed accept",
				},
				{ kind: CONSUMER, name: "job job:reports.digest attempt" },
				{
					kind: CONSUMER,
					name: "reaction reaction:tickets.changed attempt",
				},
				{ kind: CLIENT, name: "action action:notifications.send" },
			].sort((left, right) =>
				`${left.kind}:${left.name}`.localeCompare(
					`${right.kind}:${right.name}`,
				),
			),
		);
		const metrics = harness
			.finishedMetrics()
			.flatMap((resource) => resource.scopeMetrics)
			.flatMap((scope) => scope.metrics);
		expect(metrics.map((metric) => metric.descriptor.name).sort()).toEqual(
			projectObservationSignalProjection(releaseVersion)
				.artifact.metrics.map(({ name }) => name)
				.sort(),
		);
		const dropped = metrics.find(
			(metric) => metric.descriptor.name === "questpie.observation.dropped",
		)!;
		expect(dropped.dataPoints).toHaveLength(1);
		expect(dropped.dataPoints[0]).toMatchObject({
			attributes: { cause: "event_limit", signal: "event" },
			value: 1,
		});
		expect(
			harness.finishedSpans().find(({ name }) => name === "questpie execution")
				?.events,
		).toHaveLength(32);
		expect(
			[
				...new Set(
					harness
						.finishedSpans()
						.flatMap((span) => span.events.map(({ name }) => name)),
				),
			].sort(),
		).toEqual(
			projectObservationSignalProjection(releaseVersion).artifact
				.spanEventNames,
		);
	} finally {
		await harness.close();
	}
});

test("keeps opted-in operational identities on spans and out of metrics", async () => {
	const harness = await createOpenTelemetryTestHarness({
		options: { operationalIds: "spans" },
	});
	createApplicationObservation({
		applicationIdentity: "application:operational-identities",
		createRuntimeInstanceId: () => "01234567-89ab-4def-8123-456789abcdef",
		observability: harness.observability,
		runtimeBuildDigest: "a".repeat(64),
		signalProjectionDigest: harness.signalProjectionDigest,
		questpieVersion: releaseVersion,
	});
	const adapter = harness.adapter()!;
	const dispatchId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6201";
	const runId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6202";
	const attemptId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6203";
	try {
		const transaction = adapter.begin({
			kind: "transaction",
			principalKind: "user",
			trace: { kind: "active-parent" },
			transactionId: "42",
		});
		transaction.end({ kind: "transaction", outcome: "ok" });
		const attempt = adapter.begin({
			attemptId,
			attemptNumber: 1,
			dispatchId,
			kind: "job.attempt",
			principalKind: "service",
			queueDelayMilliseconds: 10,
			resourceIdentity: "job:reports.digest",
			runId,
			trace: { kind: "root" },
		});
		attempt.end({ kind: "job.attempt", outcome: "ok" });
		await harness.forceFlush();
		const spans = harness.finishedSpans();
		expect(
			byName(spans as readonly ReadableSpan[], "questpie transaction")
				.attributes,
		).toMatchObject({
			"questpie.runtime.instance.id": "01234567-89ab-4def-8123-456789abcdef",
			"questpie.transaction.id": "42",
		});
		expect(
			byName(spans as readonly ReadableSpan[], "job job:reports.digest attempt")
				.attributes,
		).toMatchObject({
			"questpie.attempt.id": attemptId,
			"questpie.dispatch.id": dispatchId,
			"questpie.run.id": runId,
			"questpie.runtime.instance.id": "01234567-89ab-4def-8123-456789abcdef",
		});
		const metricAttributes = JSON.stringify(
			harness
				.finishedMetrics()
				.flatMap((resource) => resource.scopeMetrics)
				.flatMap((scope) => scope.metrics)
				.flatMap((metric) => metric.dataPoints)
				.map((point) => point.attributes),
		);
		for (const forbidden of [
			attemptId,
			dispatchId,
			runId,
			"01234567-89ab-4def-8123-456789abcdef",
		])
			expect(metricAttributes).not.toContain(forbidden);
	} finally {
		await harness.close();
	}
});
