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

// Exact slug path → new full /docs/... URL
const docsCompatRedirects: Record<string, string> = {
	"getting-started/your-first-app": "/docs/getting-started/quickstart",
	// start-here → getting-started
	"start-here": "/docs/getting-started",
	"start-here/installation": "/docs/getting-started/installation",
	"start-here/first-app": "/docs/getting-started/quickstart",
	"start-here/project-structure": "/docs/getting-started/project-structure",
	// backend → collections / concepts / reference / server
	backend: "/docs/collections",
	"backend/architecture/file-convention": "/docs/concepts/file-convention",
	"backend/architecture/codegen": "/docs/concepts/codegen",
	"backend/architecture/modules": "/docs/concepts/modules-and-plugins",
	"backend/architecture/plugins": "/docs/concepts/modules-and-plugins",
	"backend/architecture/single-source-of-truth": "/docs/concepts/how-it-works",
	"backend/architecture/cli": "/docs/reference/cli",
	"backend/data-modeling/collections": "/docs/collections",
	"backend/data-modeling/fields": "/docs/collections/fields",
	"backend/data-modeling/globals": "/docs/collections/globals",
	"backend/data-modeling/relations": "/docs/collections/relations",
	"backend/data-modeling/localization": "/docs/collections/localization",
	"backend/data-modeling/versioning-workflow": "/docs/collections/versioning",
	"backend/rules/hooks": "/docs/collections/hooks",
	"backend/rules/access-control": "/docs/collections/access-control",
	"backend/rules/validation": "/docs/collections/validation",
	"backend/business-logic/routes": "/docs/server/routes",
	"backend/business-logic/raw-routes": "/docs/server/raw-routes",
	"backend/business-logic/jobs": "/docs/server/jobs",
	"backend/business-logic/services": "/docs/server/services",
	"backend/business-logic/emails": "/docs/server/emails",
	"backend/business-logic/seeds": "/docs/server/seeds",
	"backend/business-logic/workflows": "/docs/server/workflows",
	"backend/business-logic/workflows/steps": "/docs/server/workflows/steps",
	"backend/business-logic/workflows/client": "/docs/server/workflows/client",
	"backend/business-logic/workflows/cron": "/docs/server/workflows/cron",
	"backend/business-logic/workflows/events": "/docs/server/workflows/events",
	"backend/business-logic/workflows/admin-ui":
		"/docs/server/workflows/admin-ui",
	// workspace → admin
	workspace: "/docs/admin",
	"workspace/setup": "/docs/admin/setup",
	"workspace/branding": "/docs/admin/branding",
	"workspace/filters": "/docs/admin/filters",
	"workspace/history": "/docs/admin/history",
	"workspace/bulk-actions": "/docs/admin/bulk-actions",
	"workspace/media": "/docs/admin/media",
	"workspace/localization": "/docs/admin/localization",
	"workspace/ui-language-and-messages": "/docs/admin/ui-messages",
	"workspace/visibility": "/docs/admin/visibility",
	"workspace/views": "/docs/admin/views",
	"workspace/views/list-views": "/docs/admin/views/list-views",
	"workspace/views/form-views": "/docs/admin/views/form-views",
	"workspace/views/dashboard": "/docs/admin/views/dashboard",
	"workspace/views/sidebar": "/docs/admin/views/sidebar",
	"workspace/blocks": "/docs/admin/blocks",
	"workspace/blocks/defining-blocks": "/docs/admin/blocks/defining-blocks",
	"workspace/blocks/renderers": "/docs/admin/blocks/renderers",
	"workspace/blocks/prefetch": "/docs/admin/blocks/prefetch",
	"workspace/live-preview": "/docs/admin/live-preview",
	"workspace/live-preview/architecture": "/docs/admin/live-preview/architecture",
	"workspace/live-preview/protocol": "/docs/admin/live-preview/protocol",
	"workspace/live-preview/prepare-page": "/docs/admin/live-preview/prepare-page",
	"workspace/live-preview/same-tab-recipe":
		"/docs/admin/live-preview/same-tab-recipe",
	"workspace/live-preview/shared-preview":
		"/docs/admin/live-preview/shared-preview",
	"workspace/actions": "/docs/admin/actions",
	"workspace/actions/builtin": "/docs/admin/actions/builtin",
	"workspace/actions/custom": "/docs/admin/actions/custom",
	// frontend → client
	frontend: "/docs/client",
	"frontend/querying": "/docs/client/querying",
	"frontend/tanstack-query": "/docs/client/tanstack-query",
	"frontend/realtime": "/docs/client/realtime",
	"frontend/type-inference": "/docs/client/type-inference",
	"frontend/adapters/elysia": "/docs/client/adapters/elysia",
	"frontend/adapters/hono": "/docs/client/adapters/hono",
	"frontend/adapters/nextjs": "/docs/client/adapters/nextjs",
	// production → infrastructure
	production: "/docs/infrastructure",
	"production/authentication": "/docs/infrastructure/authentication",
	"production/database": "/docs/infrastructure/database",
	"production/deployment": "/docs/infrastructure/deployment",
	"production/email": "/docs/infrastructure/email",
	"production/kv": "/docs/infrastructure/kv",
	"production/logger": "/docs/infrastructure/logger",
	"production/mcp": "/docs/infrastructure/mcp",
	"production/migrations": "/docs/infrastructure/migrations",
	"production/multi-tenancy": "/docs/infrastructure/multi-tenancy",
	"production/openapi": "/docs/infrastructure/openapi",
	"production/queue": "/docs/infrastructure/queue",
	"production/realtime": "/docs/infrastructure/realtime",
	"production/search": "/docs/infrastructure/search",
	"production/storage": "/docs/infrastructure/storage",
};

// Prefix-based redirects: if an unknown path starts with an old prefix,
// rewrite the prefix portion to the new one (preserves trailing subpath).
const docsCompatPrefixRedirects: Array<[string, string]> = [
	["start-here/", "/docs/getting-started/"],
	["backend/", "/docs/collections/"],
	["workspace/", "/docs/admin/"],
	["frontend/", "/docs/client/"],
	["production/", "/docs/infrastructure/"],
];

function resolveRedirect(slugPath: string): string | undefined {
	// Exact match first
	const exact = docsCompatRedirects[slugPath];
	if (exact) return exact;

	// Prefix match: rewrite the old prefix to the new one
	for (const [oldPrefix, newPrefix] of docsCompatPrefixRedirects) {
		if (slugPath.startsWith(oldPrefix)) {
			return newPrefix + slugPath.slice(oldPrefix.length);
		}
	}

	return undefined;
}

export const Route = createFileRoute("/docs/$")({
	component: Page,
	loader: async ({ params }) => {
		const slugs = params._splat?.split("/") ?? [];
		const redirectTarget = resolveRedirect(slugs.join("/"));

		if (redirectTarget) {
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
