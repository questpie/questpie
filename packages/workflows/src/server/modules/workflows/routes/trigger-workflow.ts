import { route } from "questpie";
import { z } from "zod";

import {
	getCollections,
	getQueue,
	getWorkflowDefinitions,
} from "./_helpers.js";

export default route()
	.post()
	.schema(
		z.object({
			name: z.string(),
			input: z.unknown().default({}),
			idempotencyKey: z.string().optional(),
		}),
	)
	.handler(async ({ input, ...ctx }) => {
		const workflows = getWorkflowDefinitions(ctx);
		const definition = workflows[input.name];

		if (!definition) {
			throw new Error(`Unknown workflow: "${input.name}"`);
		}

		const { instances } = getCollections(ctx);
		const executeQueue = getQueue(ctx, "questpie-wf-execute");

		// Validate workflow input against schema
		const validated = definition.schema.parse(input.input);

		// Check idempotency
		if (input.idempotencyKey) {
			const existing = await instances.findOne(
				{
					where: {
						name: input.name,
						idempotencyKey: input.idempotencyKey,
					},
				},
				{ accessMode: "system" },
			);
			if (existing) {
				return { instanceId: existing.id, existing: true };
			}
		}

		// Calculate timeout
		let timeoutAt: Date | undefined;
		if (definition.timeout) {
			const { parseDuration } = await import("../../../engine/duration.js");
			timeoutAt = new Date(Date.now() + parseDuration(definition.timeout));
		}

		// Create instance
		const instance = await instances.create(
			{
				name: input.name,
				status: "pending",
				input: validated,
				output: null,
				error: null,
				attempt: 0,
				parentInstanceId: null,
				parentStepName: null,
				idempotencyKey: input.idempotencyKey ?? null,
				timeoutAt: timeoutAt ?? null,
				startedAt: null,
				suspendedAt: null,
				completedAt: null,
			},
			{ accessMode: "system" },
		);

		// Queue execution
		await executeQueue.publish({
			instanceId: instance.id,
			workflowName: input.name,
		});

		return { instanceId: instance.id, existing: false };
	});
