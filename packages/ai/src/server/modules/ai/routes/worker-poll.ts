import { route } from "questpie";
import { z } from "zod";

import { authenticateWorker, getAiServices } from "../lib/service-context.js";

const pollSchema = z.object({
  workerId: z.string(),
  runtimes: z.array(z.string()).min(1),
  models: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(10).default(1),
});

export default route()
  .post()
  .schema(pollSchema)
  .handler(async (ctx) => {
    await authenticateWorker(ctx);
    const { aiWorkerManager } = getAiServices(ctx);
    const claimed = await aiWorkerManager.claimRun({
      workerId: ctx.input.workerId,
      runtimes: ctx.input.runtimes,
      models: ctx.input.models,
      limit: ctx.input.limit,
    });
    return { run: claimed };
  });
