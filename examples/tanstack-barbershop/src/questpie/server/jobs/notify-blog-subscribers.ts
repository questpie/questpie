/**
 * Notify Blog Subscribers Job
 *
 * Triggered when a blog post is published. Emails all registered users
 * about the new post using the typed email template (new-blog-post).
 *
 * @see collections/blog-posts.ts — fires this job in afterChange hook
 * @see emails/new-blog-post.ts — the email template definition
 */
import { job } from "questpie/services";
import { z } from "zod";

import env from "../env";

export default job({
	name: "notify-blog-subscribers",
	schema: z.object({
		postId: z.string(),
		title: z.string(),
		excerpt: z.string(),
		slug: z.string(),
	}),
	handler: async ({ payload, email, collections }) => {
		const postUrl = `${env.APP_URL}/blog/${payload.slug || payload.postId}`;
		const pageSize = 200;
		let offset = 0;

		// Paginate through all non-banned users. Previous version had a
		// silent 500-user cap that dropped everyone past it with no signal.
		while (true) {
			const { docs } = await collections.user.find({
				where: { banned: { ne: true } },
				limit: pageSize,
				offset,
			});

			if (docs.length === 0) break;

			await Promise.allSettled(
				docs.map((user) =>
					email.sendTemplate({
						template: "newBlogPost",
						input: {
							recipientName: (user.name as string) ?? "there",
							postTitle: payload.title,
							postExcerpt: payload.excerpt,
							postUrl,
						},
						to: user.email as string,
					}),
				),
			);

			if (docs.length < pageSize) break;
			offset += pageSize;
		}
	},
});
