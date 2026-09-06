import { expect, test } from "bun:test";

import { createMutationCheckpointAttempt } from "./checkpoint-attempt";

test("returns a Mutation value only after its reservation and receipt completion", async () => {
	const events: string[] = [];
	const attempt = createMutationCheckpointAttempt({
		historyLength: 0,
		reserve: async (command: Readonly<{ name: string }>, ordinal: number) => {
			events.push(`reserve:${ordinal}:${command.name}`);
			return { callId: "run-1/step-1" };
		},
		invoke: async (_command, reservation) => {
			events.push(`invoke:${reservation.callId}`);
			return { written: true };
		},
		complete: async (_command, ordinal, reservation) => {
			events.push(`complete:${ordinal}:${reservation.callId}`);
		},
	});
	expect(await attempt.mutation({ name: "dispatch-due" })).toEqual({
		written: true,
	});
	await attempt.finish();
	expect(events).toEqual([
		"reserve:1:dispatch-due",
		"invoke:run-1/step-1",
		"complete:1:run-1/step-1",
	]);
});

for (const failingStage of ["reserve", "invoke", "complete"] as const) {
	test(`a caught ${failingStage} failure cannot continue checkpoints or settle successfully`, async () => {
		const failure = new Error("declared or unknown outcome");
		const writes: string[] = [];
		const attempt = createMutationCheckpointAttempt({
			historyLength: 0,
			reserve: async (
				_command: Readonly<{ name: string }>,
				_ordinal: number,
			) => {
				if (failingStage === "reserve") throw failure;
				return { callId: "stable-call" };
			},
			invoke: async (command) => {
				if (failingStage === "invoke") throw failure;
				writes.push(command.name);
				return "committed";
			},
			complete: async () => {
				if (failingStage === "complete") throw failure;
			},
		});
		await expect(attempt.mutation({ name: "first" })).rejects.toBe(failure);
		await expect(attempt.mutation({ name: "later" })).rejects.toBe(failure);
		await expect(attempt.finish()).rejects.toBe(failure);
		expect(writes).toEqual(failingStage === "complete" ? ["first"] : []);
	});
}

test("concurrent commands doom the attempt before a second Mutation dispatch", async () => {
	const reservation = Promise.withResolvers<Readonly<{ callId: string }>>();
	const writes: string[] = [];
	const attempt = createMutationCheckpointAttempt({
		historyLength: 0,
		reserve: async (_command: Readonly<{ name: string }>) =>
			reservation.promise,
		invoke: async (command) => {
			writes.push(command.name);
			return "written";
		},
		complete: async () => {},
	});
	const first = attempt.mutation({ name: "first" });
	const second = attempt.mutation({ name: "second" });
	const outcomes = Promise.allSettled([first, second]);
	reservation.resolve({ callId: "first-call" });
	expect((await outcomes).map((outcome) => outcome.status)).toEqual([
		"rejected",
		"rejected",
	]);
	expect(writes).toEqual([]);
	await expect(attempt.finish()).rejects.toThrow("CONCURRENT_STEP");
});

test("returning while a step is unresolved cannot settle or later dispatch it", async () => {
	const reservation = Promise.withResolvers<Readonly<{ callId: string }>>();
	let writes = 0;
	const attempt = createMutationCheckpointAttempt({
		historyLength: 0,
		reserve: async (_command: Readonly<{ name: string }>) =>
			reservation.promise,
		invoke: async () => {
			writes += 1;
			return "written";
		},
		complete: async () => {},
	});
	const pending = attempt.mutation({ name: "first" });
	const outcome = Promise.allSettled([pending]);
	const closed = attempt.finish().catch((error: unknown) => error);
	reservation.resolve({ callId: "first-call" });
	expect((await outcome)[0]?.status).toBe("rejected");
	expect(await closed).toBeInstanceOf(Error);
	expect(writes).toBe(0);
});

test("truncated recovery cannot be caught and repaired within the same attempt", async () => {
	let writes = 0;
	const attempt = createMutationCheckpointAttempt({
		historyLength: 1,
		reserve: async (_command: Readonly<{ name: string }>) => ({
			callId: "first-call",
		}),
		invoke: async () => {
			writes += 1;
			return "written";
		},
		complete: async () => {},
	});
	await expect(attempt.finish()).rejects.toThrow("TRUNCATED_HISTORY");
	await expect(attempt.mutation({ name: "omitted" })).rejects.toThrow(
		"TRUNCATED_HISTORY",
	);
	expect(writes).toBe(0);
});

test("an abort observed after reservation preserves its reason and prevents dispatch", async () => {
	const controller = new AbortController();
	const reason = new Error("cancelled attempt");
	let writes = 0;
	const attempt = createMutationCheckpointAttempt({
		historyLength: 0,
		signal: controller.signal,
		reserve: async (_command: Readonly<{ name: string }>) => {
			controller.abort(reason);
			return { callId: "reserved-call" };
		},
		invoke: async () => {
			writes += 1;
			return "written";
		},
		complete: async () => {},
	});
	await expect(attempt.mutation({ name: "cancelled" })).rejects.toBe(reason);
	await expect(attempt.finish()).rejects.toBe(reason);
	expect(writes).toBe(0);
});

test("a successfully finished attempt admits no more Mutation work", async () => {
	let writes = 0;
	const attempt = createMutationCheckpointAttempt({
		historyLength: 0,
		reserve: async (_command: Readonly<{ name: string }>) => ({
			callId: "late-call",
		}),
		invoke: async () => {
			writes += 1;
			return "written";
		},
		complete: async () => {},
	});
	await attempt.finish();
	await expect(attempt.mutation({ name: "too-late" })).rejects.toThrow(
		"ATTEMPT_FINISHED",
	);
	expect(writes).toBe(0);
});

test("the 65th command is rejected before reservation and cannot settle success", async () => {
	const reservations: number[] = [];
	const attempt = createMutationCheckpointAttempt({
		historyLength: 64,
		reserve: async (_command: Readonly<{ name: string }>, ordinal: number) => {
			reservations.push(ordinal);
			return { callId: `call-${ordinal}` };
		},
		invoke: async () => "receipt",
		complete: async () => {},
	});
	for (let ordinal = 1; ordinal <= 64; ordinal += 1)
		await attempt.mutation({ name: `step-${ordinal}` });
	await expect(attempt.mutation({ name: "surplus" })).rejects.toThrow(
		"CHECKPOINT_LIMIT",
	);
	expect(reservations).toHaveLength(64);
	await expect(attempt.finish()).rejects.toThrow("CHECKPOINT_LIMIT");
});

test("invalid history bounds cannot enter an attempt", () => {
	for (const historyLength of [
		-1,
		1.5,
		65,
		Number.NaN,
		Number.POSITIVE_INFINITY,
	]) {
		expect(() =>
			createMutationCheckpointAttempt({
				historyLength,
				reserve: async (_command: Readonly<{ name: string }>) => ({
					callId: "unused",
				}),
				invoke: async () => "unused",
				complete: async () => {},
			}),
		).toThrow("CHECKPOINT_LIMIT");
	}
});

test("finish joins a forgotten in-flight Mutation before reporting failure", async () => {
	const entered = Promise.withResolvers<void>();
	const mutation = Promise.withResolvers<string>();
	const attempt = createMutationCheckpointAttempt({
		historyLength: 0,
		reserve: async (_command: Readonly<{ name: string }>) => ({
			callId: "pending",
		}),
		invoke: async () => {
			entered.resolve();
			return mutation.promise;
		},
		complete: async () => {},
	});
	void attempt.mutation({ name: "unawaited" });
	await entered.promise;
	let settled = false;
	const closed = Promise.resolve()
		.then(() => attempt.finish())
		.then(
			() => {
				settled = true;
			},
			(error: unknown) => {
				settled = true;
				return error;
			},
		);
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	const settledBeforeMutation = settled;
	mutation.resolve("already committed");
	const failure = await closed;
	expect(settledBeforeMutation).toBe(false);
	expect(failure).toBeInstanceOf(Error);
});

test("author mutation after reservation cannot alter dispatched command input", async () => {
	const reserved = Promise.withResolvers<Readonly<{ callId: string }>>();
	const original = { name: "first", input: { amount: 1 } };
	const attempt = createMutationCheckpointAttempt({
		historyLength: 0,
		reserve: async (_command: typeof original) => reserved.promise,
		invoke: async (command) => command.input.amount,
		complete: async (command) => {
			expect(command.input.amount).toBe(1);
		},
	});
	const result = attempt.mutation(original);
	original.input.amount = 99;
	reserved.resolve({ callId: "snapshot" });
	expect(await result).toBe(1);
	await attempt.finish();
});

test("undefined rejection remains a permanent failure rather than a missing flag", async () => {
	const attempt = createMutationCheckpointAttempt({
		historyLength: 0,
		reserve: async (_command: Readonly<{ name: string }>) => ({
			callId: "failed",
		}),
		invoke: async () => {
			throw undefined;
		},
		complete: async () => {},
	});
	await expect(attempt.mutation({ name: "first" })).rejects.toBeUndefined();
	await expect(attempt.mutation({ name: "later" })).rejects.toBeUndefined();
	await expect(attempt.finish()).rejects.toBeUndefined();
});

test("finish retains an already-observed abort while joining its pending command", async () => {
	const reservation = Promise.withResolvers<Readonly<{ callId: string }>>();
	const controller = new AbortController();
	const reason = new Error("original abort");
	const attempt = createMutationCheckpointAttempt({
		historyLength: 0,
		signal: controller.signal,
		reserve: async (_command: Readonly<{ name: string }>) =>
			reservation.promise,
		invoke: async () => "unused",
		complete: async () => {},
	});
	const pending = attempt.mutation({ name: "first" });
	controller.abort(reason);
	const closed = attempt.finish().catch((error: unknown) => error);
	reservation.resolve({ callId: "reserved" });
	await expect(pending).rejects.toBe(reason);
	expect(await closed).toBe(reason);
});

for (const pendingStage of ["invoke", "complete"] as const) {
	test(`concurrency during ${pendingStage} cannot hide the first attempt failure`, async () => {
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		let writes = 0;
		const laterFailure = new Error("later adapter failure");
		const pause = async () => {
			entered.resolve();
			await release.promise;
			throw laterFailure;
		};
		const attempt = createMutationCheckpointAttempt({
			historyLength: 0,
			reserve: async (_command: Readonly<{ name: string }>) => ({
				callId: "first",
			}),
			invoke: async () => {
				writes += 1;
				if (pendingStage === "invoke") await pause();
				return "committed";
			},
			complete: async () => {
				if (pendingStage === "complete") await pause();
			},
		});
		const first = attempt.mutation({ name: "first" });
		await entered.promise;
		await expect(attempt.mutation({ name: "second" })).rejects.toThrow(
			"CONCURRENT_STEP",
		);
		const closed = attempt.finish().then(
			() => ({ status: "fulfilled" as const }),
			(reason: unknown) => ({ status: "rejected" as const, reason }),
		);
		release.resolve();
		await expect(first).rejects.toThrow("CONCURRENT_STEP");
		expect(await closed).toMatchObject({
			status: "rejected",
			reason: new Error("CONCURRENT_STEP"),
		});
		expect(writes).toBe(1);
	});
}
