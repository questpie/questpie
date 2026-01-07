import { createFileRoute, notFound } from "@tanstack/react-router";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { createServerFn } from "@tanstack/react-start";
import { source } from "@/lib/source";
import browserCollections from "fumadocs-mdx:collections/browser";
import {
	DocsBody,
	DocsDescription,
	DocsPage,
	DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import { components } from "@/components/mdx";
import { baseOptions } from "@/lib/layout.shared";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { LLMCopyButton } from "@/components/llm-actions";
import { createContext, useContext } from "react";

const PageUrlContext = createContext<string>("");

export const Route = createFileRoute("/docs/$")({
	component: Page,
	loader: async ({ params }) => {
		const slugs = params._splat?.split("/") ?? [];
		const data = await serverLoader({ data: slugs });
		await clientLoader.preload(data.path);
		return data;
	},
	// ISR: Cache docs pages for 1 hour, allow stale content for 7 days
	headers: () => ({
		"Cache-Control":
			"public, max-age=3600, s-maxage=3600, stale-while-revalidate=604800",
	}),
	// Client-side: Consider data fresh for 5 minutes
	staleTime: 5 * 60_000,
	gcTime: 10 * 60_000,
});

const serverLoader = createServerFn({
	method: "GET",
})
	.inputValidator((slugs: string[]) => slugs)
	.handler(async ({ data: slugs }) => {
		const page = source.getPage(slugs);
		if (!page) throw notFound();

		return {
			path: page.path,
			url: page.url,
			pageTree: await source.serializePageTree(source.getPageTree()),
		};
	});

function LLMActions() {
	const url = useContext(PageUrlContext);
	return (
		<div className="flex items-center gap-2 border-b border-fd-border pb-4 mb-6">
			<LLMCopyButton markdownUrl={`${url}.mdx`} />
		</div>
	);
}

const clientLoader = browserCollections.docs.createClientLoader({
	component({ toc, frontmatter, default: MDX }) {
		return (
			<DocsPage toc={toc}>
				<DocsTitle>{frontmatter.title}</DocsTitle>
				<DocsDescription>{frontmatter.description}</DocsDescription>
				<LLMActions />
				<DocsBody className="animate-in fade-in slide-in-from-bottom-8 duration-700">
					<MDX components={components} />
				</DocsBody>
			</DocsPage>
		);
	},
});

function Page() {
	const data = Route.useLoaderData();
	const { pageTree } = useFumadocsLoader(data);
	const Content = clientLoader.getComponent(data.path);

	return (
		<PageUrlContext.Provider value={data.url}>
			<DocsLayout {...baseOptions()} tree={pageTree}>
				<Content />
			</DocsLayout>
		</PageUrlContext.Provider>
	);
}
