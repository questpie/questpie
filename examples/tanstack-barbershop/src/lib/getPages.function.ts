import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { app } from "#questpie";
import { createRequestContext } from "@/lib/server-helpers";
import { isDraftMode } from "@questpie/admin/shared";

export type PageLoaderData = Awaited<ReturnType<typeof getPage>>;

export const getPage = createServerFn({ method: "GET" })
	.inputValidator((data: { slug: string }) => data)
	.handler(async ({ data }) => {
		const headers = getRequestHeaders();
		const cookie = headers.get("cookie");
		const cookieHeader = cookie ? String(cookie) : undefined;
		const isDraft = isDraftMode(cookieHeader);
		const ctx = await createRequestContext();

		const page = await app.collections.pages.findOne(
			{
				where: isDraft
					? { slug: data.slug }
					: { slug: data.slug, isPublished: true },
			},
			ctx,
		);

		if (!page) {
			throw notFound();
		}

		return {
			page: {
				id: page.id,
				title: page.title,
				slug: page.slug,
				description: page.description,
				content: page.content,
				metaTitle: page.metaTitle,
				metaDescription: page.metaDescription,
				isPublished: page.isPublished,
			},
		};
	});
