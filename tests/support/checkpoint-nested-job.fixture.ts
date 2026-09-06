import { codec, durable } from "questpie";

import { defineJob } from "#questpie/app";

/** Compiled only inside the disposable PostgreSQL checkpoint tracer. */
export const companyDigest = defineJob({
	name: "reports.companyDigest",
	input: codec.object({
		companyId: codec.uuid(),
		restartProbe: codec.optional(codec.text()),
	}),
	output: codec.object({
		firstAt: codec.timestamp(),
		secondAt: codec.timestamp(),
	}),
	runAs: durable.caller({ whenDenied: "fail" }),
	retry: durable.retry({
		maximumAttempts: 1,
		initialDelay: "1s",
		backoff: "exponential",
		maximumDelay: "5s",
		jitter: "full",
		horizon: "1h",
	}),
	handler: async ({ input, ctx }) => {
		const command = {
			channelId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2",
			body: input.restartProbe ?? "nested-checkpoint",
			metadata: { at: new Date("2026-09-06T12:34:56.789Z"), note: "present" },
		};
		if (command.body.startsWith("invalid-codec")) {
			await Reflect.apply(ctx.run.step.mutation, undefined, [
				"invalid-codec",
				ctx.mutations.message.publish,
				{ ...command, metadata: { ...command.metadata, note: 42 } },
			]).catch(() => undefined);
			return { firstAt: command.metadata.at, secondAt: command.metadata.at };
		}
		if (command.body.startsWith("declared-rollback")) {
			command.metadata.note = "reject-after-write";
			const failure = await ctx.run.step
				.mutation("write-then-reject", ctx.mutations.message.publish, command)
				.catch((error: unknown) => error);
			const later = await ctx.run.step
				.mutation("must-not-dispatch", ctx.mutations.message.publish, {
					...command,
					body: `${command.body}-later`,
					metadata: { ...command.metadata, note: "present" },
				})
				.catch((error: unknown) => error);
			if (failure !== later)
				throw new Error("checkpoint changed its declared failure");
			return { firstAt: command.metadata.at, secondAt: command.metadata.at };
		}
		const pending = ctx.run.step.mutation(
			"first",
			ctx.mutations.message.publish,
			command,
		);
		command.body = "mutated-after-capture";
		command.metadata.at.setUTCFullYear(2030);
		command.metadata.note = "reject-after-write";
		const first = await pending;
		const second = await ctx.run.step.mutation(
			"second",
			ctx.mutations.message.publish,
			{
				channelId: command.channelId,
				body: `${input.restartProbe}-second`,
				metadata: { at: new Date("2026-09-07T12:34:56.789Z") },
			},
		);
		return { firstAt: first.createdAt, secondAt: second.createdAt };
	},
});
