import { codec, durable } from "questpie";

import { defineJob } from "#questpie/app";
import type { ExecutionInput, GeneratedApp, JobContext } from "#questpie/app";
import type { GeneratedClient } from "#questpie/client";

function waitUntil(dueAt: Date, signal: AbortSignal): Promise<void> {
	const delay = dueAt.getTime() - Date.now();
	if (delay <= 0) return Promise.resolve();
	if (signal.aborted) return Promise.reject(signal.reason);

	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, delay);
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal.reason);
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

export const slaFollowUp = defineJob({
	name: "ticket.slaFollowUp",
	input: codec.object({
		organizationId: codec.uuid(),
		ticketId: codec.uuid(),
		reference: codec.text(),
		summary: codec.text(),
		dueAt: codec.timestamp(),
	}),
	output: codec.object({
		ticketId: codec.uuid(),
		reference: codec.text(),
		dueAt: codec.timestamp(),
		attemptNumber: codec.integer(),
	}),
	runAs: durable.caller({ whenDenied: "fail" }),
	retry: durable.retry({
		maximumAttempts: 5,
		initialDelay: "1s",
		backoff: "exponential",
		maximumDelay: "10s",
		jitter: "full",
		horizon: "1h",
	}),
	handler: async ({ input, ctx }) => {
		await ctx.attempt.heartbeat();
		await waitUntil(input.dueAt, ctx.signal);
		ctx.signal.throwIfAborted();
		return {
			ticketId: input.ticketId,
			reference: input.reference,
			dueAt: input.dueAt,
			attemptNumber: ctx.attempt.number,
		};
	},
});

function jobCapabilityContract(ctx: JobContext): void {
	// @ts-expect-error Job handlers cannot accept more durable work.
	void ctx.jobs;
	// @ts-expect-error Job handlers have no generated Query callers.
	void ctx.queries;
	// @ts-expect-error Job handlers have no generated Mutation callers.
	void ctx.mutations;
	// @ts-expect-error Job handlers cannot execute external-effect Actions.
	void ctx.actions;
}

void jobCapabilityContract;

function browserJobCapabilityContract(client: GeneratedClient): void {
	// @ts-expect-error Browser clients expose no generic Job acceptance surface.
	void client.jobs;
}

void browserJobCapabilityContract;

function jobAcceptanceCapabilityContract(
	app: GeneratedApp,
	execution: ExecutionInput,
): Promise<unknown> {
	const dueAt = new Date("2030-01-01T00:00:00.000Z");
	return app.execution(execution, ({ jobs }) =>
		jobs.ticket.slaFollowUp.accept(
			{
				organizationId: execution.context.organizationId,
				ticketId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131",
				reference: "SUP-7131",
				summary: "Generated acceptance contract",
				dueAt,
			},
			{
				idempotencyKey: "direct-delayed-sla-follow-up",
				notBefore: dueAt,
			},
		),
	);
}

void jobAcceptanceCapabilityContract;
