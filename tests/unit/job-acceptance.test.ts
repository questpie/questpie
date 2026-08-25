import { expect, test } from "bun:test";

import { principal } from "questpie";

import {
	createJobAcceptance,
	JobAcceptanceConflict,
	type JobAcceptanceRecord,
	type JobAcceptanceTransaction,
} from "../../packages/runtime/src/durable";
import type { LinkedJobMember } from "../../packages/runtime/src/durable";

const tenantId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";
const principalId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4";
const acceptedAt = new Date("2026-08-25T08:00:00.000Z");
const notBefore = new Date("2026-08-25T09:30:00.000Z");

const job = Object.freeze({
	identity: "job:reports.companyDigest",
	member: "reports.companyDigest",
	semanticVersion: 2,
	input: {
		kind: "object",
		properties: { companyId: { kind: "uuid" } },
	},
	output: { kind: "object", properties: {} },
	declaredErrors: Object.freeze({}),
	runAs: Object.freeze({ actor: "caller", whenDenied: "fail" }),
	retry: Object.freeze({
		maximumAttempts: 3,
		initialDelayMilliseconds: 1_000,
		backoff: "exponential",
		maximumDelayMilliseconds: 60_000,
		jitter: "full",
		horizonMilliseconds: 86_400_000,
	}),
	contractDigest: "c".repeat(64),
}) as LinkedJobMember;

function memoryTransaction() {
	const records = new Map<string, JobAcceptanceRecord>();
	const writes: JobAcceptanceRecord[] = [];
	const transaction: JobAcceptanceTransaction = {
		async accept(record) {
			writes.push(record);
			const current = records.get(record.dispatchId);
			if (current)
				return Object.freeze({
					status: "existing" as const,
					requestDigest: current.requestDigest,
				});
			records.set(record.dispatchId, record);
			return Object.freeze({ status: "accepted" as const });
		},
	};
	return { records, transaction, writes };
}

function acceptance(
	transaction: JobAcceptanceTransaction,
	overrides: Readonly<{
		acceptedAt?: Date;
		contextInput?: Readonly<{ companyId: string }>;
		principalId?: string;
	}> = {},
) {
	return createJobAcceptance({
		application: "application:collaboration",
		tenantId,
		principal: principal.user({ id: overrides.principalId ?? principalId }),
		contextInput: overrides.contextInput ?? { companyId: "tenant" },
		contextInputCodec: {
			kind: "object",
			properties: { companyId: { kind: "text" } },
		},
		runtimeBuildDigest: "d".repeat(64),
		acceptedAt: overrides.acceptedAt ?? acceptedAt,
		causation: Object.freeze({
			kind: "mutationDispatch",
			id: "mutation-call",
			correlationId: "mutation-call",
		}),
		transaction,
	});
}

test("accepts independently keyed Jobs and replays an equivalent canonical request", async () => {
	const store = memoryTransaction();
	const firstOwner = acceptance(store.transaction);
	const first = await firstOwner.accept(
		job,
		{ companyId: tenantId },
		{ idempotencyKey: "digest:morning", notBefore },
	);
	const second = await firstOwner.accept(
		job,
		{ companyId: tenantId },
		{ idempotencyKey: "digest:evening" },
	);
	const replayOwner = acceptance(store.transaction, {
		acceptedAt: new Date("2026-08-25T08:05:00.000Z"),
	});
	const replay = await replayOwner.accept(
		job,
		{ companyId: tenantId },
		{ idempotencyKey: "digest:morning", notBefore },
	);

	expect(first).toEqual(replay);
	expect(first).not.toEqual(second);
	expect(store.writes[0]?.dispatchId).toBe(
		"c98cbc88-0e2a-5321-a90d-1d15b988ad45",
	);
	expect(first.resource).toBe("job:reports.companyDigest");
	expect(store.records.size).toBe(2);
	expect(store.writes).toHaveLength(3);
	expect(store.writes[0]).toMatchObject({
		runId: first.runId,
		resource: "job:reports.companyDigest",
		semanticVersion: 2,
		state: "delayed",
		availableAt: notBefore,
	});
	expect(store.writes[1]).toMatchObject({
		runId: second.runId,
		state: "ready",
		availableAt: acceptedAt,
	});
});

test("conflicts when one scoped Job identity changes input, notBefore, Context, or run-as", async () => {
	for (const changed of ["input", "notBefore", "context", "runAs"] as const) {
		const store = memoryTransaction();
		await acceptance(store.transaction).accept(
			job,
			{ companyId: tenantId },
			{ idempotencyKey: "same-key", notBefore },
		);
		const next =
			changed === "context"
				? acceptance(store.transaction, {
						contextInput: { companyId: "changed" },
					})
				: acceptance(store.transaction);
		const changedJob =
			changed === "runAs"
				? ({
						...job,
						runAs: { actor: "service", whenDenied: "fail" },
					} as unknown as LinkedJobMember)
				: job;
		const attempt = next.accept(
			changedJob,
			{
				companyId:
					changed === "input"
						? "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a1"
						: tenantId,
			},
			{
				idempotencyKey: "same-key",
				notBefore:
					changed === "notBefore"
						? new Date("2026-08-25T09:31:00.000Z")
						: notBefore,
			},
		);
		await expect(attempt).rejects.toBeInstanceOf(JobAcceptanceConflict);
	}
});

test("preserves explicit causation and distinct accepted and delayed timestamps", async () => {
	const store = memoryTransaction();
	const owner = createJobAcceptance({
		application: "application:collaboration",
		tenantId,
		principal: principal.user({ id: principalId }),
		contextInput: {},
		contextInputCodec: { kind: "object", properties: {} },
		runtimeBuildDigest: "d".repeat(64),
		acceptedAt,
		causation: Object.freeze({
			kind: "explicit",
			id: "server-execution",
			correlationId: "server-execution",
		}),
		transaction: store.transaction,
	});

	await owner.accept(
		job,
		{ companyId: tenantId },
		{ idempotencyKey: "direct", notBefore },
	);
	expect(store.writes[0]).toMatchObject({
		causationKind: "explicit",
		acceptedAt,
		availableAt: notBefore,
		state: "delayed",
	});
});

test("validates bounded NFC idempotency identity and absolute notBefore before persistence", async () => {
	const store = memoryTransaction();
	const owner = acceptance(store.transaction);
	for (const idempotencyKey of [
		"",
		"e\u0301",
		"x\0y",
		"x".repeat(257),
		"😀".repeat(257),
	]) {
		await expect(
			owner.accept(job, { companyId: tenantId }, { idempotencyKey }),
		).rejects.toThrow("Job idempotency key is invalid");
	}
	await expect(
		owner.accept(
			job,
			{ companyId: tenantId },
			{ idempotencyKey: "valid", notBefore: new Date(Number.NaN) },
		),
	).rejects.toThrow("Job notBefore must be an absolute timestamp");
	expect(store.writes).toHaveLength(0);
});

test("scopes stable identity by Principal while keeping idempotency material opaque", async () => {
	const store = memoryTransaction();
	const key = "private/customer@example.test";
	const first = await acceptance(store.transaction).accept(
		job,
		{ companyId: tenantId },
		{ idempotencyKey: key },
	);
	const second = await acceptance(store.transaction, {
		principalId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a5",
	}).accept(job, { companyId: tenantId }, { idempotencyKey: key });

	expect(first).not.toEqual(second);
	expect(JSON.stringify([...store.records.values()])).not.toContain(key);
});
