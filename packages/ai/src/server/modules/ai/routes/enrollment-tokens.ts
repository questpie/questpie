import { route } from "questpie";
import { z } from "zod";

import { asAiJsonRoute } from "../lib/handler-context.js";
import { generateSecret, hashSecret } from "../services/worker-manager.js";

const tokenSchema = z.object({
  description: z.string().optional(),
  ttlSeconds: z.number().int().positive().default(3600),
});

export default route()
  .post()
  .schema(tokenSchema)
  .handler(async (ctx) => {
    const collections = asAiJsonRoute(ctx).collections;
    const secret = generateSecret();
    const expiresAt = new Date(Date.now() + ctx.input.ttlSeconds * 1000);

    await collections.ai_workers.create({
      deviceId: `token:${secret.slice(0, 8)}`,
      name: ctx.input.description ?? "Join token",
      status: "offline",
      secretHash: hashSecret(secret),
      metadata: { isJoinToken: true, expiresAt: expiresAt.toISOString() },
    });

    return { token: secret, expiresAt: expiresAt.toISOString() };
  });
