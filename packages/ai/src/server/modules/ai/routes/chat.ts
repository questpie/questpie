import { route } from "questpie";
import { z } from "zod";

import { getAiServices } from "../lib/service-context.js";

const chatSchema = z.object({
  sessionId: z.string().optional(),
  content: z.string().min(1),
  model: z.string().optional(),
  provider: z.string().optional(),
  attachments: z
    .array(
      z.object({
        type: z.string(),
        id: z.string(),
        meta: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .optional(),
  scope: z.object({ projectId: z.string().optional() }).optional(),
});

export default route()
  .post()
  .schema(chatSchema)
  .handler(async (ctx) => {
    const { aiChat } = getAiServices(ctx);
    return aiChat.sendMessage({
      sessionId: ctx.input.sessionId,
      content: ctx.input.content,
      model: ctx.input.model,
      provider: ctx.input.provider,
      attachments: ctx.input.attachments,
      scope: ctx.input.scope,
    });
  });
