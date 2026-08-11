import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import { DocsRouteContent } from "@/components/docs/DocsRouteContent";
import {
	buildBreadcrumbs,
	generateBreadcrumbJsonLd,
	generateDocsJsonLd,
	generateLinks,
	generateMeta,
	siteConfig,
} from "@/lib/seo";

export const Route = createFileRoute("/docs/$")({
	component: Page,
	loader: async ({ params }) => {
		const slugs = params._splat?.split("/") ?? [];
		return serverLoader({ data: slugs });
	},
	head: ({ loaderData }) => {
		if (!loaderData) return {};

		const { title, description, url, dateModified, slugs } = loaderData;
		const breadcrumbs = buildBreadcrumbs(slugs, title);

		return {
			links: generateLinks({
				url,
				includeIcons: false,
				includePreconnect: false,
			}),
			meta: generateMeta({
				title,
				description,
				url,
				type: "article",
				section: slugs[0] === "v4" ? "QUESTPIE v4" : undefined,
			}),
			scripts: [
				{
					type: "application/ld+json",
					children: JSON.stringify(
						generateDocsJsonLd({
							title,
							description,
							url,
							dateModified,
						}),
					),
				},
				{
					type: "application/ld+json",
					children: JSON.stringify(generateBreadcrumbJsonLd(breadcrumbs)),
				},
			],
		};
	},
	headers: () => ({
		"Cache-Control":
			"public, max-age=3600, s-maxage=3600, stale-while-revalidate=604800",
	}),
	staleTime: 5 * 60_000,
	gcTime: 10 * 60_000,
});

const serverLoader = createServerFn({ method: "GET" })
	.validator((slugs: string[]) => slugs)
	.handler(async ({ data: slugs }) => {
		const { source } = await import("@/lib/source");
		const page = source.getPage(slugs);
		if (!page) throw notFound();

		const title = page.data.title ?? "Documentation";
		const description = page.data.description ?? siteConfig.description;
		const lastModified =
			"lastModified" in page.data ? page.data.lastModified : undefined;
		const dateModified =
			typeof lastModified === "string" ? lastModified : undefined;

		return {
			path: page.path,
			url: page.url,
			title,
			description,
			dateModified,
			slugs,
			pageTree: await source.serializePageTree(source.getPageTree()),
		};
	});

function Page() {
	const data = Route.useLoaderData();
	return <DocsRouteContent data={data} />;
}
