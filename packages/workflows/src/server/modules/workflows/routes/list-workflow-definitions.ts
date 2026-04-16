import { route } from "questpie";
import { z } from "zod";

export default route()
	.post()
	.schema(z.object({}))
	.handler(async ({ input, ...ctx }) => {
		const app = (ctx as any).app as any;
		const workflows = (app?.state?.workflows ?? {}) as Record<string, any>;

		return {
			definitions: Object.entries(workflows).map(
				([name, def]: [string, any]) => ({
					name,
					timeout: def.timeout ?? null,
					cron: def.cron ?? null,
					cronOverlap: def.cronOverlap ?? null,
					hasOnFailure: !!def.onFailure,
					logLevel: def.logLevel ?? "info",
					retention: def.retention ?? null,
				}),
			),
		};
	});
