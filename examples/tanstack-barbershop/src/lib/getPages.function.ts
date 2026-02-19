import { isDraftMode } from "@questpie/admin/shared";
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { app, getRequestLocale } from "@/lib/server-helpers";

export type PageLoaderData = Awaited<ReturnType<typeof getPage>>;

export const getPage = createServerFn({ method: "GET" })
	.inputValidator((data: { slug: string }) => data)
	.handler(async ({ data }) => {
		const headers = getRequestHeaders();
		const cookie = headers.get("cookie");
		const cookieHeader = cookie ? String(cookie) : undefined;
		const isDraft = isDraftMode(cookieHeader);
		const locale = getRequestLocale();

		// Use direct app API for proper afterRead hooks (including blocks prefetch)
		const ctx = await app.createContext({
			accessMode: "system",
			locale,
		});

		const page = await app.api.collections.pages.findOne(
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
