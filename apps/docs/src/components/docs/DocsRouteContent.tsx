import { useFumadocsLoader } from "fumadocs-core/source/client";
import browserCollections from "fumadocs-mdx:collections/browser";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import {
	DocsBody,
	DocsDescription,
	DocsPage,
	DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import { createContext, createElement, useContext, useMemo } from "react";

import { LLMCopyButton } from "@/components/llm-actions";
import { getMDXComponents } from "@/components/mdx";
import { baseOptions } from "@/lib/layout.shared";

type DocsLoaderData = {
	path: string;
	url: string;
	pageTree: object;
};

const PageUrlContext = createContext<string>("");
const mdxComponents = getMDXComponents();

function LLMActions() {
	const url = useContext(PageUrlContext);
	return (
		<div className="border-fd-border mb-6 flex items-center gap-2 border-b pb-4">
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
				<DocsBody>
					<MDX components={mdxComponents} />
				</DocsBody>
			</DocsPage>
		);
	},
});

export function DocsRouteContent({ data }: { data: DocsLoaderData }) {
	const { pageTree } = useFumadocsLoader(data);
	const Content = useMemo(
		() => clientLoader.getComponent(data.path),
		[data.path],
	);

	return (
		<PageUrlContext.Provider value={data.url}>
			<DocsLayout {...baseOptions()} tree={pageTree}>
				{createElement(Content)}
			</DocsLayout>
		</PageUrlContext.Provider>
	);
}
