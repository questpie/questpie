import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { lazy, Suspense } from "react";
import {
	generateDocsJsonLd,
	generateLinks,
	generateMeta,
	siteConfig,
} from "@/lib/seo";

const LazyDocsRouteContent = lazy(() =>
	import("@/components/docs/DocsRouteContent").then((module) => ({
		default: module.DocsRouteContent,
	})),
);

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

		const { title, description, url, dateModified } = loaderData;

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
			pageTree: await source.serializePageTree(source.getPageTree()),
		};
	});

function Page() {
	const data = Route.useLoaderData();

	return (
		<Suspense
			fallback={
				<div className="mx-auto w-full max-w-7xl px-4 py-10 text-sm text-muted-foreground">
					Loading documentation...
				</div>
			}
		>
			<LazyDocsRouteContent data={data} />
		</Suspense>
	);
}
