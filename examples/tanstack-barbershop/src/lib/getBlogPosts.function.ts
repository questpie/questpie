import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { app } from "#questpie";
import { createRequestContext } from "@/lib/server-helpers";
import { isDraftMode } from "@questpie/admin/shared";

export const getBlogPost = createServerFn({ method: "GET" })
	.inputValidator((data: { slug: string; locale?: string }) => data)
	.handler(async ({ data }) => {
		const headers = getRequestHeaders();
		const cookie = headers.get("cookie");
		const cookieHeader = cookie ? String(cookie) : undefined;
		const draftMode = isDraftMode(cookieHeader);

		const ctx = await createRequestContext(data.locale);

		const post = await app.collections.blog_posts.findOne(
			{
				where: draftMode
					? { slug: data.slug }
					: { slug: data.slug, status: "published" },
				with: {
					author: true,
					coverImage: true,
				},
			},
			ctx,
		);

		if (!post) {
			throw notFound();
		}

		return {
			post: {
				id: post.id,
				title: post.title,
				slug: post.slug,
				content: post.content,
				excerpt: post.excerpt,
				readingTime: post.readingTime,
				status: post.status,
				publishedAt: post.publishedAt,
				author: post.author
					? {
							name: post.author.name,
							email: post.author.email,
							image: post.author.image,
						}
					: null,
				coverImage: post.coverImage?.url ?? null,
				tags: post.tags,
			},
		};
	});

export const getAllBlogPosts = createServerFn({ method: "GET" })
	.inputValidator((data: { locale?: string } | undefined) => data)
	.handler(async ({ data }) => {
		const ctx = await createRequestContext(data?.locale);

		const result = await app.collections.blog_posts.find(
			{
				where: { status: "published" },
				sort: { publishedAt: "desc" },
				with: {
					author: true,
					coverImage: true,
				},
			},
			ctx,
		);

		return {
			posts: result.docs.map((p) => ({
				id: p.id,
				title: p.title,
				slug: p.slug,
				excerpt: p.excerpt,
				readingTime: p.readingTime,
				publishedAt: p.publishedAt,
				author: p.author
					? {
							name: p.author.name,
							email: p.author.email,
							image: p.author.image,
						}
					: null,
				coverImage: p.coverImage?.url ?? null,
				tags: p.tags,
			})),
		};
	});
