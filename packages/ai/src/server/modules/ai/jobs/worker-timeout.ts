import { job } from "questpie";
import { z } from "zod";

import type { AiRunStatus } from "../lib/execution-contract.js";
import { asAiJobArgs } from "../lib/handler-context.js";

export default job({
  name: "ai-worker-timeout",
  schema: z.object({}),
  options: {
    cron: "*/5 * * * *",
    retryLimit: 1,
  },
  handler: async (ctx) => {
    const collections = asAiJobArgs(ctx).collections;
    const now = new Date();
    const staleThreshold = new Date(now.getTime() - 5 * 60 * 1000);

    const workers = await collections.ai_workers.find({
      where: { status: { in: ["online", "busy"] } },
      limit: 500,
    });

    let markedOffline = 0;
    for (const worker of workers.docs as Array<Record<string, unknown>>) {
      const lastHeartbeat = worker.lastHeartbeat
        ? new Date(worker.lastHeartbeat as string)
        : null;
      if (!lastHeartbeat || lastHeartbeat < staleThreshold) {
        await collections.ai_workers.updateById({
          id: String(worker.id),
          data: { status: "offline" },
        });
        markedOffline++;
      }
    }

    const leases = await collections.ai_worker_leases.find({
      where: { status: "active" },
      limit: 1000,
    });

    let expiredLeases = 0;
    for (const lease of leases.docs as Array<Record<string, unknown>>) {
      if (lease.expiresAt && new Date(lease.expiresAt as string) < now) {
        await collections.ai_worker_leases.updateById({
          id: lease.id as string,
          data: { status: "expired" },
        });
        const runId =
          typeof lease.run === "string"
            ? lease.run
            : (lease.run as any)?.id;
        if (runId) {
          const run = await collections.ai_runs.findOne({
            where: { id: runId },
          });
          if (
            run &&
            (run.status === "claimed" || run.status === "running")
          ) {
            await collections.ai_runs.updateById({
              id: runId,
              data: { status: "pending", worker: null },
            });
          }
        }
        expiredLeases++;
      }
    }

    return { markedOffline, expiredLeases };
  },
});
