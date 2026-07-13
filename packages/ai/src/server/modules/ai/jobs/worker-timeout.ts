import { job } from "questpie";
import { z } from "zod";

import { asAiJobArgs } from "../lib/handler-context.js";
import { createQuestpieResumableStreamStore } from "../lib/questpie-resumable-streams.js";
import type { FinalizeRunDeps } from "../../../worker/finalize-run.js";
import { reapExpiredRunLinks } from "../../../worker/reap-run-links.js";

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

    // Orphan reaper over run_links (§3.8 mech.2): claimed/running rows whose
    // producerLease expired are requeued (retryPolicy 'auto') or failed via the
    // one finalizeRun ('none', incl. every task).
    const { reapedFailed, reapedRequeued } = await reapExpiredRunLinks(
      {
        collections: collections as never,
        streamStore: createQuestpieResumableStreamStore({
          kv: (ctx as { kv?: unknown }).kv as Parameters<
            typeof createQuestpieResumableStreamStore
          >[0]["kv"],
        }),
        workflows: (ctx as { workflows?: FinalizeRunDeps["workflows"] })
          .workflows,
        knowledgeResource: (
          ctx as {
            services?: {
              knowledgeResource?: FinalizeRunDeps["knowledgeResource"];
            };
          }
        ).services?.knowledgeResource,
      },
      now,
    );

    return { markedOffline, reapedFailed, reapedRequeued };
  },
});
