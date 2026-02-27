import { email } from "questpie";
import { z } from "zod";

export default email({
	name: "new-blog-post",
	schema: z.object({
		recipientName: z.string(),
		postTitle: z.string(),
		postExcerpt: z.string(),
		postUrl: z.string().url(),
	}),
	handler: ({ input }) => ({
		subject: `New post: ${input.postTitle}`,
		html: `
			<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
				<h1 style="font-size: 24px; margin-bottom: 8px;">&#128214; New on the Blog</h1>
				<p style="color: #666; margin-bottom: 24px;">
					Hi ${input.recipientName}, we just published a new post!
				</p>

				<div style="border-left: 4px solid #d97706; padding-left: 16px; margin-bottom: 24px;">
					<h2 style="font-size: 20px; margin: 0 0 8px;">${input.postTitle}</h2>
					<p style="color: #444; margin: 0;">${input.postExcerpt}</p>
				</div>

				<a href="${input.postUrl}" style="display: inline-block; background: #d97706; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">
					Read the full post &rarr;
				</a>

				<hr style="margin: 32px 0; border-color: #eee;" />
				<p style="font-size: 12px; color: #999;">
					You're receiving this because you're registered on the Barbershop
					platform. Visit your profile to manage notification preferences.
				</p>
			</div>
		`,
	}),
});
