import { route } from "questpie";
import { z } from "zod";

import { getWorkflowDefinitions } from "./_helpers.js";

export default route()
	.post()
	.schema(z.object({}))
	.handler(async ({ ...ctx }) => {
		const workflows = getWorkflowDefinitions(ctx);

		return {
			definitions: Object.entries(workflows).map(([name, def]) => ({
				name,
				timeout: def.timeout ?? null,
				cron: def.cron ?? null,
				cronOverlap: def.cronOverlap ?? null,
				hasOnFailure: !!def.onFailure,
				logLevel: def.logLevel ?? "info",
				retention: def.retention ?? null,
			})),
		};
	});
