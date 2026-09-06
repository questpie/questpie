import { codec, durable, principal } from "questpie";

import { defineJob } from "#questpie/app";

/** Compiled only inside the disposable PostgreSQL checkpoint tracer. */
export const companyDigest = defineJob({
	name: "reports.companyDigest",
	schedule: {
		cron: "* * * * *",
		execution: {
			principal: principal.service({
				name: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
			}),
			context: { companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0" },
		},
		input: {
			companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
			restartProbe: "scheduled-checkpoint",
		},
	},
	input: codec.object({
		companyId: codec.uuid(),
		restartProbe: codec.optional(codec.text()),
	}),
	output: codec.object({
		attemptNumber: codec.integer(),
		companyId: codec.uuid(),
		contextResolutionId: codec.uuid(),
		invocationId: codec.uuid(),
		role: codec.text(),
	}),
	runAs: durable.caller({ whenDenied: "fail" }),
	retry: durable.retry({
		maximumAttempts: 3,
		initialDelay: "1s",
		backoff: "exponential",
		maximumDelay: "5s",
		jitter: "full",
		horizon: "1h",
	}),
	handler: async ({ input, ctx }) => {
		const result = (invocationId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2") => ({
			attemptNumber: ctx.attempt.number,
			companyId: input.companyId,
			contextResolutionId: ctx.values.contextResolutionId,
			invocationId,
			role: ctx.values.selectedRole,
		});
		const command = {
			channelId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2",
			body: input.restartProbe ?? "checkpoint-worker",
		};
		if (input.restartProbe?.startsWith("non-text-name")) {
			// Deliberately untyped JavaScript ingress; generated callers require text.
			await Reflect.apply(ctx.run.step.mutation, undefined, [
				12,
				ctx.mutations.message.publish,
				command,
			]).catch(() => undefined);
			return result();
		}
		if (input.restartProbe?.startsWith("forged")) {
			await ctx.run.step
				.mutation("publish", { ...ctx.mutations.message.publish }, command)
				.catch(() => undefined);
			await ctx.run.step
				.mutation("later", ctx.mutations.message.publish, command)
				.catch(() => undefined);
			return result();
		}
		if (input.restartProbe?.startsWith("unawaited")) {
			void ctx.run.step.mutation(
				"publish",
				ctx.mutations.message.publish,
				command,
			);
			return result();
		}
		if (input.restartProbe?.startsWith("concurrent")) {
			const first = ctx.run.step.mutation(
				"publish",
				ctx.mutations.message.publish,
				command,
			);
			await ctx.run.step
				.mutation("second", ctx.mutations.message.publish, command)
				.catch(() => undefined);
			await first.catch(() => undefined);
			return result();
		}
		if (input.restartProbe?.startsWith("captured")) {
			const pending = ctx.run.step.mutation(
				"publish",
				ctx.mutations.message.publish,
				command,
			);
			command.body = "changed-after-capture";
			return result((await pending).id);
		}
		if (
			input.restartProbe?.startsWith("retry-after-checkpoint-truncated") &&
			ctx.attempt.number > 1
		)
			return result();
		if (
			input.restartProbe?.startsWith("retry-after-checkpoint-transient") &&
			ctx.attempt.number === 2
		)
			throw new Error("transient before replay");
		const message = await ctx.run.step.mutation(
			input.restartProbe?.startsWith("retry-after-checkpoint-renamed") &&
				ctx.attempt.number > 1
				? "renamed"
				: "publish",
			ctx.mutations.message.publish,
			{
				channelId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2",
				body:
					input.restartProbe?.startsWith("retry-after-checkpoint-changed") &&
					ctx.attempt.number > 1
						? `${input.restartProbe}-changed`
						: (input.restartProbe ?? "checkpoint-worker"),
			},
		);
		if (input.restartProbe?.startsWith("duplicate"))
			await ctx.run.step
				.mutation("publish", ctx.mutations.message.publish, command)
				.catch(() => undefined);
		if (
			input.restartProbe?.startsWith("retry-after-checkpoint") &&
			ctx.attempt.number === 1
		)
			throw new Error("proof retry after completed checkpoint");
		return {
			attemptNumber: ctx.attempt.number,
			companyId: input.companyId,
			contextResolutionId: ctx.values.contextResolutionId,
			invocationId: message.id,
			role: ctx.values.selectedRole,
		};
	},
});
