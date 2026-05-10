import { job } from "questpie";
import { z } from "zod";

export default job({
  name: "ai-cleanup",
  schema: z.object({}),
  options: {
    cron: "0 3 * * *",
    retryLimit: 1,
  },
  handler: async (ctx) => {
    const collections = (ctx as any).collections;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const sessions = await collections.ai_sessions.find({
      where: { status: "closed" },
      limit: 100,
    });

    let archived = 0;
    for (const session of sessions.docs as Array<Record<string, unknown>>) {
      const updatedAt = session.updatedAt
        ? new Date(session.updatedAt as string)
        : null;
      if (updatedAt && updatedAt < thirtyDaysAgo) {
        await collections.ai_sessions.updateById({
          id: session.id as string,
          data: { status: "archived" },
        });
        archived++;
      }
    }

    return { archived };
  },
});
