import { expect, test } from "bun:test";

import { createMutationCheckpointAttemptOwner } from "../../packages/runtime/src/durable/checkpoint-attempt";

type Command = Readonly<{ name: string }>;
type Adapter = Parameters<
	typeof createMutationCheckpointAttemptOwner<Command, string, string, Command>
>[0];

function attempt(overrides: Partial<Adapter> = {}) {
	const events: string[] = [];
	const owner = createMutationCheckpointAttemptOwner({
		historyLength: 0,
		capture: (command: Command) => command,
		async reserve(command: Command, ordinal: number) {
			events.push(`reserve:${ordinal}:${command.name}`);
			return `call-${ordinal}`;
		},
		async invoke(_command: Command, callId: string) {
			events.push(`invoke:${callId}`);
			return "committed";
		},
		async complete(_command: Command, ordinal: number) {
			events.push(`complete:${ordinal}`);
		},
		...overrides,
	});
	return { ...owner, events };
}

test("checkpoint value is unavailable until its receipt completion finishes", async () => {
	const entered = Promise.withResolvers<void>();
	const completion = Promise.withResolvers<void>();
	const owner = attempt({
		async complete() {
			entered.resolve();
			await completion.promise;
		},
	});
	let returned = false;
	const result = owner.mutation({ name: "publish" }).then((value) => {
		returned = true;
		return value;
	});
	await entered.promise;
	expect(returned).toBe(false);
	completion.resolve();
	expect(await result).toBe("committed");
	await owner.finish();
	expect(owner.events).toEqual(["reserve:1:publish", "invoke:call-1"]);
});

for (const stage of ["reserve", "invoke", "complete"] as const) {
	for (const failure of [new Error("first failure"), undefined]) {
		test(`caught ${stage} rejection (${failure === undefined ? "undefined" : "Error"}) permanently dooms checkpoint admission`, async () => {
			const owner = attempt({
				[stage]: async () => {
					throw failure;
				},
			});
			await expect(owner.mutation({ name: "first" })).rejects.toBe(failure);
			const events = [...owner.events];
			await expect(owner.mutation({ name: "later" })).rejects.toBe(failure);
			await expect(owner.finish()).rejects.toBe(failure);
			expect(owner.events).toEqual(events);
		});
	}
}

for (const stage of ["reserve", "invoke", "complete"] as const) {
	test(`concurrent admission during ${stage} preserves its first failure after adapter rejection`, async () => {
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const owner = attempt({
			[stage]: async () => {
				entered.resolve();
				await release.promise;
				throw new Error("later adapter rejection");
			},
		});
		const pending = owner.mutation({ name: "first" });
		await entered.promise;
		const failure = await owner
			.mutation({ name: "second" })
			.catch((e: unknown) => e);
		expect(failure).toMatchObject({ code: "CHECKPOINT_INVALID" });
		const joined = owner.finish().catch((e: unknown) => e);
		release.resolve();
		await expect(pending).rejects.toBe(failure);
		expect(await joined).toBe(failure);
		expect(
			owner.events.filter((event) => event.startsWith("reserve:")),
		).toHaveLength(stage === "reserve" ? 0 : 1);
	});

	test(`finish joins forgotten ${stage} work and cannot settle successfully`, async () => {
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const owner = attempt({
			[stage]: async () => {
				entered.resolve();
				await release.promise;
				return "committed";
			},
		});
		const pending = owner.mutation({ name: "forgotten" });
		await entered.promise;
		let settled = false;
		const joined = owner.finish().catch((e: unknown) => {
			settled = true;
			return e;
		});
		await Promise.resolve();
		expect(settled).toBe(false);
		release.resolve();
		const failure = await joined;
		expect(failure).toMatchObject({ code: "CHECKPOINT_INVALID" });
		await expect(pending).rejects.toBe(failure);
		expect(owner.events.some((event) => event.startsWith("complete:"))).toBe(
			false,
		);
		if (stage === "reserve") expect(owner.events).toEqual([]);
	});
}

for (const finishWhilePending of [false, true]) {
	test(`abort after reservation keeps its reason through finish (pending=${finishWhilePending})`, async () => {
		const controller = new AbortController();
		const reason = new Error("original abort");
		const release = Promise.withResolvers<string>();
		const owner = attempt({
			signal: controller.signal,
			reserve: () => release.promise,
		});
		const pending = owner.mutation({ name: "cancelled" });
		controller.abort(reason);
		const joined = finishWhilePending
			? owner.finish().catch((e: unknown) => e)
			: undefined;
		release.resolve("reserved");
		await expect(pending).rejects.toBe(reason);
		if (joined) expect(await joined).toBe(reason);
		else await expect(owner.finish()).rejects.toBe(reason);
		expect(owner.events).toEqual([]);
	});
}

test("finished and truncated attempts cannot admit late repair work", async () => {
	for (const historyLength of [0, 1]) {
		const owner = attempt({ historyLength });
		if (historyLength)
			await expect(owner.finish()).rejects.toMatchObject({
				code: "CHECKPOINT_INVALID",
			});
		else await owner.finish();
		await expect(owner.mutation({ name: "late" })).rejects.toMatchObject({
			code: "CHECKPOINT_INVALID",
		});
		expect(owner.events).toEqual([]);
	}
});

test("handler failure before recorded steps remains retryable instead of becoming truncated success", async () => {
	const failure = new Error("transient handler failure");
	const owner = attempt({ historyLength: 1 });
	await expect(owner.finish({ reason: failure })).rejects.toBe(failure);
	await expect(owner.mutation({ name: "late" })).rejects.toBe(failure);
});

test("64 recorded checkpoints replay but a 65th never reserves", async () => {
	const owner = attempt({ historyLength: 64 });
	for (let ordinal = 1; ordinal <= 64; ordinal++)
		await owner.mutation({ name: `step-${ordinal}` });
	await expect(owner.mutation({ name: "surplus" })).rejects.toMatchObject({
		code: "RESOURCE_LIMIT",
	});
	await expect(owner.finish()).rejects.toMatchObject({
		code: "RESOURCE_LIMIT",
	});
	expect(
		owner.events.filter((event) => event.startsWith("reserve:")),
	).toHaveLength(64);
});

test("invalid stored history bounds never enter the checkpoint attempt", () => {
	for (const historyLength of [
		-1,
		1.5,
		65,
		Number.NaN,
		Number.POSITIVE_INFINITY,
	]) {
		expect(() => attempt({ historyLength })).toThrow("RESOURCE_LIMIT");
	}
});
