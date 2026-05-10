import { app } from "#questpie";

await app.queue.listen({ teamSize: 5, batchSize: 3 });
