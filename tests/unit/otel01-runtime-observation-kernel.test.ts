import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import {
	createObservationKernel,
	type ExecutionEventV2,
} from "../../packages/runtime/src/observation";

const RUNTIME_INSTANCE_ID = "01234567-89ab-4def-8123-456789abcdef";
const OCCURRED_AT = "2026-08-31T12:00:00.000Z";

describe("OTEL-01 Runtime observation kernel", () => {
	test("projects one issued Execution and nested Query through the null adapter", async () => {
		const events: ExecutionEventV2[] = [];
		const lines: string[] = [];
		let rejectedNestedMutations = 0;
		const kernel = createObservationKernel({
			applicationIdentity: "supportDesk",
			createRuntimeInstanceId: () => RUNTIME_INSTANCE_ID,
			emitCanonicalLine: (line) => lines.push(line),
			events: (event) => {
				if (event.kind === "scope.started")
					try {
						(event.start as { kind: string }).kind = "mutated";
					} catch {
						rejectedNestedMutations += 1;
					}
				events.push(event);
			},
			runtimeBuildDigest: "a".repeat(64),
			wallClock: () => new Date(OCCURRED_AT),
		});

		expect(kernel.hasAdapter).toBe(false);
		expect(kernel.hasCloseWork).toBe(false);
		expect(kernel.current()).toBeNull();

		const execution = kernel.beginExecution({
			entry: "direct",
			kind: "execution",
			principalKind: "user",
			trace: { kind: "root" },
		});
		expect(execution).not.toBeNull();
		if (execution === null) throw new Error("expected an Execution");

		await execution.scope.run(async () => {
			expect(kernel.current()).toEqual({
				context: null,
				suppressHttp: false,
				suppressPostgres: false,
			});
			execution.scope.event({ kind: "context.completed" });
			const query = kernel.beginScope(execution.identity, {
				entry: "direct",
				kind: "query",
				principalKind: "user",
				resourceIdentity: "tickets.detail",
				trace: { kind: "active-parent" },
			});
			await query.run(async () => {
				expect(kernel.current()?.context).toBeNull();
			});
			query.end({ kind: "query", outcome: "ok" });
		});
		execution.scope.end({ kind: "execution", outcome: "ok" });

		expect(events.map((event) => [event.kind, event.scopeKind])).toEqual([
			["scope.started", "execution"],
			["scope.event", "execution"],
			["scope.started", "query"],
			["scope.ended", "query"],
			["scope.ended", "execution"],
		]);
		expect(events.map((event) => event.eventSequence)).toEqual([
			"1",
			"2",
			"3",
			"4",
			"5",
		]);
		expect(
			events.every(
				(event) => event.executionId === `${RUNTIME_INSTANCE_ID}:execution:1`,
			),
		).toBe(true);
		expect(events.every((event) => event.occurredAt === OCCURRED_AT)).toBe(
			true,
		);
		expect(events.some((event) => "traceContext" in event)).toBe(false);
		expect(rejectedNestedMutations).toBe(2);
		expect(lines).toHaveLength(5);
		expect(lines.every((line) => line.endsWith("\n"))).toBe(true);
		expect(lines.map((line) => JSON.parse(line))).toEqual(events);
		expect(Buffer.byteLength(lines.join(""))).toBe(2_779);
		expect(createHash("sha256").update(lines.join("")).digest("hex")).toBe(
			"a3e90df77f585779dc6c7e8920c7d12241ae17f198352de1163a39833bde9ad4",
		);
	});
});
