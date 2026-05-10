import { route } from "questpie";
import { z } from "zod";

import { authenticateWorker, getAiServices } from "../lib/service-context.js";

const heartbeatSchema = z.object({
  workerId: z.string(),
});

export default route()
  .post()
  .schema(heartbeatSchema)
  .handler(async (ctx) => {
    await authenticateWorker(ctx);
    const { aiWorkerManager } = getAiServices(ctx);
    return aiWorkerManager.heartbeat(ctx.input.workerId);
  });
