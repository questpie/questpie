import { route } from "questpie";
import { z } from "zod";

import { getAiServices } from "../lib/service-context.js";
import { generateSecret } from "../services/worker-manager.js";

const enrollSchema = z.object({
  token: z.string(),
  name: z.string(),
  deviceId: z.string(),
  volumeId: z.string(),
  capabilities: z.unknown().default({}),
});

export default route()
  .post()
  .schema(enrollSchema)
  .handler(async (ctx) => {
    const { aiWorkerManager } = getAiServices(ctx);
    const secret = generateSecret();
    const result = await aiWorkerManager.registerWorker({
      deviceId: ctx.input.deviceId,
      name: ctx.input.name,
      volumeId: ctx.input.volumeId,
      capabilities: ctx.input.capabilities,
      secret,
    });
    return { workerId: result.workerId, secret };
  });
