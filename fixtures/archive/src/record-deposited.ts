import { codec, durable, operation } from "questpie";

import { defineReaction } from "#questpie/app";

import { archiveRecordPage } from "./record-page";

export const recordDeposited = defineReaction({
	name: "recordDeposited",
	input: codec.object({
		archiveCode: codec.text(),
		catalogueNumber: codec.text(),
	}),
	output: codec.object({
		archiveCode: codec.text(),
		catalogueNumber: codec.text(),
		provenanceSequence: codec.integer(),
	}),
	runAs: durable.caller({ whenDenied: "fail" }),
	retry: durable.retry({
		maximumAttempts: 8,
		initialDelay: "1s",
		backoff: "exponential",
		maximumDelay: "900s",
		jitter: "full",
		horizon: "24h",
	}),
	effects: [],
	errors: {
		recordUnavailable: operation.error({
			code: "RECORD_UNAVAILABLE",
			status: 404,
		}),
	},
	handler: async ({ input, ctx, errors }) => {
		await ctx.attempt.heartbeat();
		const page = await ctx.data.run(archiveRecordPage, {
			archiveCode: input.archiveCode,
			first: 100,
			after: null,
		});
		if (
			!page.nodes.some(
				({ catalogueNumber }) => catalogueNumber === input.catalogueNumber,
			)
		)
			throw errors.recordUnavailable();
		const appended = await ctx.mutations.provenance.recordReaction(input, {
			callId: `run:${ctx.run.id}`,
		});
		return { ...input, provenanceSequence: appended.sequence };
	},
});
