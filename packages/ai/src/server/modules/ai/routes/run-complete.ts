import { route } from "questpie";
import { z } from "zod";

import { authenticateWorker, getAiServices } from "../lib/service-context.js";

const completeSchema = z.object({
  runId: z.string(),
  workerId: z.string(),
  result: z.object({
    text: z.string().optional(),
    sessionRef: z.string().optional(),
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    cost: z.number().optional(),
    stopReason: z.string().optional(),
  }),
});

export default route()
  .post()
  .schema(completeSchema)
  .handler(async (ctx) => {
    await authenticateWorker(ctx);
    const { aiWorkerManager } = getAiServices(ctx);
    await aiWorkerManager.completeRun({
      runId: ctx.input.runId,
      workerId: ctx.input.workerId,
      result: ctx.input.result,
    });
    return { ok: true };
  });
