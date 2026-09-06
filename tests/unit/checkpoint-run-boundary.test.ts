import { expect, test } from "bun:test";

import type { RuntimeCodec } from "../../packages/runtime/src/codec";
import { createMutationCheckpointRun } from "../../packages/runtime/src/durable/checkpoint";
import type { MutationCheckpointCommand } from "../../packages/runtime/src/durable/checkpoint-postgres";
import type { DurableClaim } from "../../packages/runtime/src/durable/rows";

const claim: DurableClaim = {
	acceptanceTrace: null,
	runId: "00000000-0000-4000-8000-000000000001",
	dispatchId: "00000000-0000-4000-8000-000000000002",
	resource: "job:checkpoint",
	semanticVersion: 1,
	attemptId: "00000000-0000-4000-8000-000000000003",
	attemptNumber: 1,
	queueDelayMilliseconds: 0,
	leaseToken: "owned-checkpoint-lease",
	leaseMilliseconds: 1000,
	leaseExpiresAt: new Date("2026-09-06T00:00:01Z"),
	deadlineAt: new Date("2026-09-06T00:01:00Z"),
	workerId: "checkpoint-worker",
	tenantId: "checkpoint-tenant",
	principal: { kind: "service", id: "checkpoint-service" },
	contextInputBytes: new Uint8Array(),
	payloadBytes: new Uint8Array(),
	retry: {
		maximumAttempts: 3,
		initialDelayMilliseconds: 1000,
		backoff: "exponential",
		maximumDelayMilliseconds: 5000,
		jitter: "full",
		horizonMilliseconds: 60000,
	},
	runtimeBuildDigest: "a".repeat(64),
	executableDigest: "b".repeat(64),
	causationId: "checkpoint-cause",
	correlationId: "checkpoint-correlation",
	cancellationRequested: false,
};

const nestedCodec: RuntimeCodec = {
	kind: "object",
	properties: {
		body: { kind: "text" },
		metadata: {
			kind: "object",
			properties: {
				at: { kind: "timestamp" },
				note: { kind: "optional", codec: { kind: "text" } },
			},
		},
	},
};

async function run(
	options: {
		input?: RuntimeCodec;
		output?: RuntimeCodec;
		reserved?: Promise<void>;
		invoke?: (input: unknown) => Promise<unknown>;
	} = {},
) {
	const reservations: MutationCheckpointCommand[] = [];
	const dispatched: unknown[] = [];
	const completions: MutationCheckpointCommand[] = [];
	const owner = await createMutationCheckpointRun({
		claim,
		signal: new AbortController().signal,
		bindings: [
			{
				identity: "mutation:publish",
				input: options.input ?? nestedCodec,
				output: options.output ?? nestedCodec,
				contractDigest: "a".repeat(64),
				runtimeGraphDigest: "b".repeat(64),
			},
		],
		store: {
			async load() {
				return 0;
			},
			async reserve(_claim, command) {
				reservations.push(command);
				await options.reserved;
				return {
					status: "reserved" as const,
					callId: `checkpoint-call-${command.ordinal}`,
					commandDigest: "c".repeat(64),
					state: "reserved" as const,
					receiptTransactionId: null,
					receiptResultDigest: null,
				};
			},
			async complete(_claim, command) {
				completions.push(command);
				return { status: "completed" as const, receiptTransactionId: "123" };
			},
		},
		async invoke(_binding, input) {
			dispatched.push(input);
			return options.invoke ? options.invoke(input) : input;
		},
	});
	return {
		owner,
		reservations,
		dispatched,
		completions,
		reference: owner.reference("mutation:publish"),
	};
}

test("checkpoint captures nested Date and optional codec values before reservation yields", async () => {
	const reserved = Promise.withResolvers<void>();
	const probe = await run({ reserved: reserved.promise });
	const input = {
		body: "captured",
		metadata: { at: new Date("2026-09-06T01:02:03.004Z"), note: "present" },
	};
	const pending = probe.owner.step.mutation("first", probe.reference, input);
	input.body = "changed";
	input.metadata.at.setUTCFullYear(2030);
	input.metadata.note = "changed";
	reserved.resolve();
	const original = {
		body: "captured",
		metadata: { at: new Date("2026-09-06T01:02:03.004Z"), note: "present" },
	};
	expect(await pending).toEqual(original);
	expect(probe.dispatched).toEqual([original]);
	expect(probe.reservations[0]?.input).toEqual({
		...original,
		metadata: { ...original.metadata, at: "2026-09-06T01:02:03.004Z" },
	});
	const absent = {
		body: "second",
		metadata: { at: new Date("2026-09-07T00:00:00.000Z") },
	};
	expect(
		await probe.owner.step.mutation("second", probe.reference, absent),
	).toEqual(absent);
	await probe.owner.finish();
	expect(
		probe.completions.map((command) => [command.ordinal, command.name]),
	).toEqual([
		[1, "first"],
		[2, "second"],
	]);
});

test("borrowed, copied, and callable references cannot reserve or invoke a checkpoint", async () => {
	const previous = await run();
	await previous.owner.finish();
	let called = false;
	const callback = () => {
		called = true;
	};
	for (const reference of [
		previous.reference,
		{ ...previous.reference },
		{},
		callback,
	]) {
		const probe = await run();
		const failure = await probe.owner.step
			.mutation("invalid", reference, {})
			.catch((e: unknown) => e);
		expect(failure).toMatchObject({ code: "CHECKPOINT_INVALID" });
		await expect(
			probe.owner.step.mutation("later", probe.reference, {}),
		).rejects.toBe(failure);
		await expect(probe.owner.finish()).rejects.toBe(failure);
		expect(probe.reservations).toEqual([]);
		expect(probe.dispatched).toEqual([]);
	}
	expect(called).toBe(false);
});

test("invalid nested optional input reports only the ordinary safe codec failure before reservation", async () => {
	const probe = await run();
	const failure = await probe.owner.step
		.mutation("invalid", probe.reference, {
			body: "invalid",
			metadata: { at: new Date("2026-09-06T00:00:00.000Z"), note: 42 },
		})
		.catch((e: unknown) => e);
	expect(failure).toBeInstanceOf(Error);
	expect(failure).toMatchObject({
		code: "PROTOCOL_UNSUPPORTED",
		retryable: false,
		message: "PROTOCOL_UNSUPPORTED",
	});
	expect(Object.getOwnPropertyNames(failure).sort()).toEqual([
		"code",
		"retryable",
	]);
	await expect(
		probe.owner.step.mutation("later", probe.reference, {}),
	).rejects.toBe(failure);
	await expect(probe.owner.finish()).rejects.toBe(failure);
	expect(probe.reservations).toEqual([]);
	expect(probe.dispatched).toEqual([]);
});

test("checkpoint input limit counts canonical UTF-8 bytes including JSON framing", async () => {
	// {"body":""} is 11 bytes and canonicalMutationBytes adds one newline.
	for (const extra of ["", "x"]) {
		const probe = await run({
			input: { kind: "object", properties: { body: { kind: "text" } } },
			output: { kind: "boolean" },
			invoke: async () => true,
		});
		const pending = probe.owner.step.mutation("bounded", probe.reference, {
			body: "é".repeat(524_282) + extra,
		});
		if (extra) {
			const failure = await pending.catch((e: unknown) => e);
			expect(failure).toMatchObject({ code: "RESOURCE_LIMIT" });
			await expect(probe.owner.finish()).rejects.toBe(failure);
			expect(probe.reservations).toEqual([]);
			expect(probe.dispatched).toEqual([]);
		} else {
			expect(await pending).toBe(true);
			await probe.owner.finish();
			expect(probe.reservations).toHaveLength(1);
			expect(probe.completions).toHaveLength(1);
		}
	}
});
