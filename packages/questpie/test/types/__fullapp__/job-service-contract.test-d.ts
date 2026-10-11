import type { Equal, Expect, NoAny } from "../_assert.js";
import type { App } from "./.generated/index.js";
import { countArticles } from "./helpers/article-count.js";
import type articleCount from "./jobs/article-count.js";

type _JobResult = Awaited<ReturnType<typeof articleCount.handler>>;
type _ResultCount = Expect<Equal<_JobResult["count"], number>>;
type _ResultNoAny = Expect<NoAny<_JobResult>>;
declare const app: App;
countArticles(app.collections, "hello");
declare const service: Questpie.ServiceCreateContext;
declare const job: Questpie.JobHandlerContext;
countArticles(job.collections, "hello");
countArticles(service.collections, "hello");

import type { Questpie } from "#questpie/server/config/questpie.js";
import type { QuestpieConfig } from "#questpie/server/config/types.js";

import type { AppCollections } from "./.generated/entities.gen.js";
declare const raw: Questpie<
	Omit<QuestpieConfig, "collections"> & { collections: AppCollections }
>;
countArticles(raw.collections, "hello");
