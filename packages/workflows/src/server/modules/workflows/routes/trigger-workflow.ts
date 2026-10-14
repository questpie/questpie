import { route } from "questpie";
import { z } from "zod";

import { createWorkflowClient } from "../../../client.js";
import { workflowRouteAccess } from "./_access.js";
import {
	getCollections,
	getQueue,
	getWorkflowDefinitions,
} from "./_helpers.js";

export default route()
	.post()
	.access(workflowRouteAccess("trigger"))
	.schema(
		z.object({
			name: z.string(),
			input: z.unknown().default({}),
			idempotencyKey: z.string().optional(),
		}),
	)
	.handler(async ({ input, ...ctx }) => {
		const { instances, steps, events } = getCollections(ctx);
		const client = createWorkflowClient(getWorkflowDefinitions(ctx), {
			instances,
			steps,
			events,
			publishExecute: getQueue(ctx, "questpie-wf-execute"),
		});
		return client.trigger(input.name, input.input, {
			idempotencyKey: input.idempotencyKey,
		});
	});
