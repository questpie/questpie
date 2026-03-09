import { isDraftMode } from "@questpie/admin/shared";
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { app, createServerContext } from "@/lib/server-helpers";

export const getBlogPost = createServerFn({ method: "GET" })
	.inputValidator((data: { slug: string; locale?: string }) => data)
	.handler(async ({ data }) => {
		const headers = getRequestHeaders();
		const cookie = headers.get("cookie");
		const cookieHeader = cookie ? String(cookie) : undefined;
		const draftMode = isDraftMode(cookieHeader);

		const ctx = await createServerContext(data.locale);

		const post = await app.api.collections.blogPosts.findOne(
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
				content: post.content as any,
				excerpt: post.excerpt,
				readingTime: post.readingTime,
				status: post.status,
				publishedAt: post.publishedAt,
				author: post.author as any,
				coverImage: (post.coverImage as any)?.url ?? null,
				tags: post.tags,
			},
		};
	});

export const getAllBlogPosts = createServerFn({ method: "GET" })
	.inputValidator((data: { locale?: string } | undefined) => data)
	.handler(async ({ data }) => {
		const ctx = await createServerContext(data?.locale);

		const result = await app.api.collections.blogPosts.find(
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
				author: p.author as any,
				coverImage: (p.coverImage as any)?.url ?? null,
				tags: p.tags,
			})),
		};
	});
