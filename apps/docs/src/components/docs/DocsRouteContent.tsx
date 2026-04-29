import { useFumadocsLoader } from "fumadocs-core/source/client";
import browserCollections from "fumadocs-mdx:collections/browser";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import {
	DocsBody,
	DocsDescription,
	DocsPage,
	DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import { createContext, useContext } from "react";

import { LLMCopyButton } from "@/components/llm-actions";
import { components } from "@/components/mdx";
import { baseOptions } from "@/lib/layout.shared";

type DocsLoaderData = {
	path: string;
	url: string;
	pageTree: object;
};

const PageUrlContext = createContext<string>("");

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
					<MDX components={components} />
				</DocsBody>
			</DocsPage>
		);
	},
});

export function DocsRouteContent({ data }: { data: DocsLoaderData }) {
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
