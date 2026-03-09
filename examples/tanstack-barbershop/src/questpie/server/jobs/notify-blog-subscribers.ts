/**
 * Notify Blog Subscribers Job
 *
 * Triggered when a blog post is published. Emails all registered users
 * about the new post using the typed email template (new-blog-post).
 *
 * @see collections/blog-posts.ts — fires this job in afterChange hook
 * @see emails/new-blog-post.ts — the email template definition
 */
import { job } from "questpie";
import { z } from "zod";

export default job({
	name: "notify-blog-subscribers",
	schema: z.object({
		postId: z.string(),
		title: z.string(),
		excerpt: z.string(),
		slug: z.string(),
	}),
	handler: async ({ payload, email, collections }) => {
		const result = await collections.user.find({
			where: { banned: { ne: true } },
			limit: 500,
		});

		const users = result.docs ?? [];
		if (users.length === 0) return;

		const postUrl = `${process.env.APP_URL ?? ""}/blog/${payload.slug || payload.postId}`;

		await Promise.allSettled(
			users.map((user) =>
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
	},
});
