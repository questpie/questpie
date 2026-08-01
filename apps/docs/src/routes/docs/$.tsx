import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import { DocsRouteContent } from "@/components/docs/DocsRouteContent";
import {
	buildBreadcrumbs,
	generateBreadcrumbJsonLd,
	generateDocsJsonLd,
	generateLinks,
	generateMeta,
	sectionLabels,
	siteConfig,
} from "@/lib/seo";

/* Every field type kept its own page through the move, so the old and new paths
   differ only in the group. Listing them is what the exact-match map needs. */
const FIELD_TYPE_PAGES = [
	"text",
	"textarea",
	"email",
	"url",
	"number",
	"boolean",
	"date",
	"datetime",
	"time",
	"select",
	"object",
	"array",
	"json",
	"rich-text",
	"upload",
];

/* Docs URLs are indexed, so a page that moves keeps its old path working. Exact
   match on the slug, oldest entries first. */
const docsCompatRedirects = new Map<string, string>([
	["getting-started/your-first-app", "/docs/learn/first-app"],
	// concepts/ split into Schema, Code, Infrastructure and Ship
	["concepts/collections", "/docs/schema/collections"],
	["concepts/globals", "/docs/schema/globals"],
	["concepts/relations", "/docs/schema/relations"],
	["concepts/blocks", "/docs/schema/blocks"],
	["concepts/access-control", "/docs/schema/access-control"],
	["concepts/hooks", "/docs/schema/hooks"],
	["concepts/validation", "/docs/schema/validation"],
	["concepts/seeds", "/docs/schema/seeds"],
	["concepts/collaborative-documents", "/docs/schema/collaborative-documents"],
	["concepts/soft-delete-retention", "/docs/schema/soft-delete"],
	["concepts/fields", "/docs/schema/fields"],
	// temporal-values was a sibling of fields and is now nested under it
	["concepts/temporal-values", "/docs/schema/fields/temporal-values"],
	...FIELD_TYPE_PAGES.map(
		(page) =>
			[`concepts/fields/${page}`, `/docs/schema/fields/${page}`] as const,
	),
]);

export const Route = createFileRoute("/docs/$")({
	component: Page,
	loader: async ({ params }) => {
		const slugs = params._splat?.split("/") ?? [];
		const redirectTarget = docsCompatRedirects.get(slugs.join("/"));

		if (redirectTarget) {
			/* 301, not the 307 default. These pages moved for good, and a permanent
			   redirect is what passes the old URL's ranking to the new one. */
			throw redirect({ href: redirectTarget, statusCode: 301 });
		}

		return serverLoader({ data: slugs });
	},
	head: ({ loaderData }) => {
		if (!loaderData) return {};

		const { title, description, url, dateModified, slugs } = loaderData;
		const breadcrumbs = buildBreadcrumbs(slugs, title);
		const section =
			slugs.length > 0 ? (sectionLabels[slugs[0]] ?? slugs[0]) : undefined;

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
				section,
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
	.inputValidator((slugs: string[]) => slugs)
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
