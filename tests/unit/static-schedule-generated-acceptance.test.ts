import { expect, test } from "bun:test";

import { codec, defineContext } from "questpie";

import { renderStaticScheduleOwner } from "../../packages/compiler/src/runtime/application-schedules";
import { decodeRuntimeCodec } from "../../packages/runtime/src/codec";
import {
	createJobAcceptance,
	type JobAcceptanceRecord,
} from "../../packages/runtime/src/durable/acceptance";
import { durablePrincipal } from "../../packages/runtime/src/durable/principal";
import type { StaticScheduleAcceptance } from "../../packages/runtime/src/durable/schedule/contract";
import { createApplicationRuntime } from "../../packages/runtime/src/execution";

test("generated producer enters ordinary Context and uses the supplied acceptance transaction", async () => {
	const material = { tenant: "tenant-one", at: "2026-09-06T00:00:00.000Z" };
	let contextCalls = 0;
	let denied = false;
	const contextDefinition = defineContext({
		name: "generated.context",
		input: codec.object({ tenant: codec.text(), at: codec.timestamp() }),
		resolve: ({ input, principal }) => {
			contextCalls++;
			if (denied) throw new Error("CONTEXT_DENIED");
			expect(principal.kind).toBe("service");
			expect(input.at).toBeInstanceOf(Date);
			return { tenant: { id: input.tenant }, values: {} };
		},
	});
	const runtime = createApplicationRuntime({
		context: contextDefinition,
		services: [],
		bootstrap: () => ({
			read: async () => {
				throw new Error("unavailable");
			},
		}),
		project: (scope) => {
			expect(scope.facts.authority).toEqual({ kind: "ordinary" });
			return { execution: { ...scope.facts, actionScope: scope } };
		},
	});
	let acceptance: StaticScheduleAcceptance | undefined;
	const records: JobAcceptanceRecord[] = [];
	const transaction = Object.freeze({
		identity: "the existing schedule transaction",
	});
	const job = {
		identity: "job:sweep",
		member: "sweep",
		semanticVersion: 1,
		input: { kind: "object", properties: { at: { kind: "timestamp" } } },
		runAs: { actor: "caller", whenDenied: "fail" },
		retry: {
			maximumAttempts: 3,
			initialDelayMilliseconds: 1,
			maximumDelayMilliseconds: 100,
			horizonMilliseconds: 60000,
			backoff: "exponential",
			jitter: "full",
		},
		contractDigest: "c".repeat(64),
	};
	const artifact = { test: "verified artifact envelope" };
	const instantiate = new Function(
		"database",
		"loaded",
		"runtime",
		"mutationArtifacts",
		"contextDefinition",
		"createPostgresStaticSchedules",
		"durablePrincipal",
		"decodeRuntimeCodec",
		"createJobAcceptance",
		"createPostgresJobAcceptanceTransaction",
		"executionObservationOf",
		`let schedules; ${renderStaticScheduleOwner({ application: "application:generated", contextDefinition: "contextDefinition" })}; return schedules;`,
	);
	try {
		const result = instantiate(
			{},
			{
				artifacts: {
					runtimeBuild: {
						digest: "d".repeat(64),
						compilerRuntimeBuildDigest: "a".repeat(64),
						later: { jobDigest: "b".repeat(64) },
					},
				},
				artifactFiles: { "job-schedules.json": JSON.stringify(artifact) },
			},
			runtime,
			{
				jobs: { byIdentity: new Map([[job.identity, job]]) },
				transactionStatements: "compiled SQL descriptors",
			},
			contextDefinition,
			(input: {
				accept: StaticScheduleAcceptance;
				artifact: unknown;
				bindings: unknown;
			}) => {
				acceptance = input.accept;
				expect(input.artifact).toEqual(artifact);
				expect(input.bindings).toEqual({
					application: "application:generated",
					compilerRuntimeBuildDigest: "a".repeat(64),
					jobProjectionDigest: "b".repeat(64),
				});
				return Object.freeze({
					activate: () => {
						throw new Error("must be explicit");
					},
					reconcile: () => {},
				});
			},
			durablePrincipal,
			decodeRuntimeCodec,
			createJobAcceptance,
			(input: {
				transaction: unknown;
				callId: string;
				sourceOperation: string;
			}) => {
				expect(input.transaction).toBe(transaction);
				expect(input.callId).toBe("schedule:tick-one");
				return {
					accept: async (record: JobAcceptanceRecord) => {
						records.push(record);
						return { status: "accepted" };
					},
				};
			},
			() => null,
		);
		expect(Object.keys(result).sort()).toEqual(["activate", "reconcile"]);
		expect(contextCalls).toBe(0);
		const request: Parameters<StaticScheduleAcceptance>[0] = {
			transaction: transaction as never,
			schedule: {
				jobIdentity: job.identity,
				principal: { kind: "service", id: "sweep" },
				contextJson: JSON.stringify(material),
				inputJson: JSON.stringify({ at: material.at }),
			} as never,
			tickId: "tick-one",
			scheduledMinute: new Date(material.at),
			observedAt: new Date("2026-09-06T00:01:30.000Z"),
			signal: new AbortController().signal,
		};
		const receipt = await acceptance!(request);
		expect(contextCalls).toBe(1);
		expect(receipt.resource).toBe("job:sweep");
		expect(records).toHaveLength(1);
		expect(records[0]!.principal).toMatchObject({
			kind: "service",
			id: "sweep",
		});
		expect(records[0]!.tenantId).toBe("tenant-one");
		expect(records[0]!.causationId).toBe("schedule:tick-one");
		expect(records[0]!.causationKind).toBe("explicit");
		expect(records[0]!.acceptedAt.toISOString()).toBe(
			"2026-09-06T00:01:30.000Z",
		);
		expect(new TextDecoder().decode(records[0]!.payloadBytes)).toBe(
			'{"at":"2026-09-06T00:00:00.000Z"}\n',
		);
		denied = true;
		await expect(acceptance!(request)).rejects.toThrow("CONTEXT_DENIED");
		expect(records).toHaveLength(1);
		denied = false;
		const cancelled = new AbortController();
		cancelled.abort(new Error("PRODUCER_CANCELLED"));
		await expect(
			acceptance!({ ...request, signal: cancelled.signal }),
		).rejects.toThrow("PRODUCER_CANCELLED");
		expect(records).toHaveLength(1);
	} finally {
		await runtime.close();
	}
});
