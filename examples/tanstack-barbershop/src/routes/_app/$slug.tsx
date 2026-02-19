/**
 * Catch-all Route for app Pages
 *
 * Handles dynamic app pages like /about, /gallery, /privacy etc.
 * Explicit routes (services, booking, contact, barbers) take precedence.
 */

import { createFileRoute } from "@tanstack/react-router";
import { PageRenderer } from "@/components/pages/PageRenderer";
import { getPage, type PageLoaderData } from "@/lib/getPages.function";

export const Route = createFileRoute("/_app/$slug")({
	loader: async (ctx) => {
		return getPage({ data: { slug: ctx.params.slug } });
	},

	head: ({ loaderData }) => {
		if (!loaderData) return { meta: [] };
		const page = (loaderData as PageLoaderData).page;
		return {
			meta: [
				{ title: page.metaTitle || page.title },
				...(page.metaDescription
					? [{ name: "description", content: page.metaDescription }]
					: []),
			],
		};
	},

	component: PageComponent,
});

function PageComponent() {
	const { page } = Route.useLoaderData() as PageLoaderData;
	return <PageRenderer page={page} />;
}
