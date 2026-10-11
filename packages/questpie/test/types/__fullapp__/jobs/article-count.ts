import { z } from "zod";

import { job } from "#questpie/server/modules/core/integrated/queue/job.js";

import { countArticles } from "../helpers/article-count.js";

export default job({
	name: "article-count",
	schema: z.object({ title: z.string() }),
	handler: async ({ collections, payload }) => {
		const title: string = payload.title;
		const result = await countArticles(collections, title);
		const populated = await collections.articles.find({
			with: { category: true },
		});
		const categoryName: string | undefined = populated.docs[0]?.category?.name;
		// @ts-expect-error populated relation retains target fields
		void populated.docs[0]?.category?.missing;
		// @ts-expect-error module collection is accessible and typed
		collections.account.find({ where: { providerId: { eq: 123 } } });
		// @ts-expect-error local override retains text title operators
		collections.articles.find({ where: { title: { eq: 123 } } });
		// @ts-expect-error missing collection stays an error
		collections.unknown.find({});
		// @ts-expect-error literal select is precise
		collections.articles.find({ where: { status: { eq: "unknown" } } });
		// @ts-expect-error title remains required for create
		collections.articles.create({ status: "draft" });
		return { count: result, categoryName };
	},
});
