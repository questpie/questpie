import { route } from "questpie";
import { z } from "zod";

import type {
	WorkflowLogRecord,
	WorkflowStepRecord,
} from "../../../workflow/types.js";
import { getCollections } from "./_helpers.js";

export default route()
	.post()
	.schema(
		z.object({
			id: z.string(),
			includeSteps: z.boolean().default(true),
			includeLogs: z.boolean().default(false),
		}),
	)
	.handler(async ({ input, ...ctx }) => {
		const { instances, steps, logs } = getCollections(ctx);

		const instance = await instances.findOne(
			{ where: { id: input.id } },
			{ accessMode: "system" },
		);

		if (!instance) {
			throw new Error(`Workflow instance not found: ${input.id}`);
		}

		let stepDocs: WorkflowStepRecord[] = [];
		if (input.includeSteps) {
			const stepResult = await steps.find(
				{
					where: { instanceId: input.id },
					sort: { createdAt: "asc" },
					limit: 10_000,
				},
				{ accessMode: "system" },
			);
			stepDocs = stepResult.docs;
		}

		let logDocs: WorkflowLogRecord[] = [];
		if (input.includeLogs) {
			const logResult = await logs.find(
				{
					where: { instanceId: input.id },
					sort: { createdAt: "asc" },
					limit: 10_000,
				},
				{ accessMode: "system" },
			);
			logDocs = logResult.docs;
		}

		return {
			instance,
			steps: stepDocs,
			logs: logDocs,
		};
	});
