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

const docsCompatRedirects = new Map<string, string>([
	[
		"getting-started/your-first-app",
		"/docs/getting-started/first-platform-walkthrough",
	],
]);

export const Route = createFileRoute("/docs/$")({
	component: Page,
	loader: async ({ params }) => {
		const slugs = params._splat?.split("/") ?? [];
		const redirectTarget = docsCompatRedirects.get(slugs.join("/"));

		if (redirectTarget) {
			throw redirect({ href: redirectTarget });
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
		const pageData = page.data as Record<string, unknown>;
		const dateModified =
			typeof pageData.lastModified === "string"
				? pageData.lastModified
				: undefined;

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
