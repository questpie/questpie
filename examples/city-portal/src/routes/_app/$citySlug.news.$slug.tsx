/**
 * News Detail Route
 *
 * Displays a single news article with rich text content.
 */

import { createFileRoute, Link, useParams } from "@tanstack/react-router";

import { getNewsBySlug } from "@/lib/server-functions";
import { RichTextRenderer } from "@questpie/admin/client";

export const Route = createFileRoute("/_app/$citySlug/news/$slug")({
	loader: async ({ params }) => {
		return getNewsBySlug({
			data: { citySlug: params.citySlug, newsSlug: params.slug },
		});
	},

	head: ({ loaderData }) => {
		if (!loaderData) return { meta: [] };
		const data = loaderData as { article: any };
		const article = data.article;
		return {
			meta: [
				{ title: article ? `${article.title} - News` : "Article Not Found" },
			],
		};
	},

	component: NewsDetail,
});

function NewsDetail() {
	const { article } = Route.useLoaderData();
	const { citySlug } = useParams({ from: "/_app/$citySlug" });

	return (
		<article className="container mx-auto px-4 py-12">
			{/* Back Link */}
			<Link
				to="/$citySlug/news"
				params={{ citySlug }}
				search={{ category: "all" }}
				className="text-muted-foreground hover:text-primary mb-8 inline-flex items-center gap-1 text-sm transition-colors"
			>
				<svg
					className="h-4 w-4"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					aria-hidden="true"
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={2}
						d="M15 19l-7-7 7-7"
					/>
				</svg>
				Back to News
			</Link>

			{/* Article Header */}
			<header className="mb-8 max-w-3xl">
				<div className="mb-4 flex items-center gap-3">
					{article.category && (
						<span className="bg-primary/10 text-primary rounded-full px-3 py-1 text-xs font-medium tracking-wide uppercase">
							{article.category}
						</span>
					)}
					{article.isFeatured && (
						<span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
							Featured
						</span>
					)}
				</div>

				<h1 className="mb-4 text-4xl font-bold tracking-tight">
					{article.title}
				</h1>

				{article.excerpt && (
					<p className="text-muted-foreground mb-4 text-xl">
						{article.excerpt}
					</p>
				)}

				<div className="text-muted-foreground flex items-center gap-4 text-sm">
					{article.publishedAt && (
						<time>
							{new Date(article.publishedAt).toLocaleDateString("en-GB", {
								day: "numeric",
								month: "long",
								year: "numeric",
							})}
						</time>
					)}
					{article.author && (
						<span>
							by <span className="font-medium">{article.author}</span>
						</span>
					)}
				</div>
			</header>

			{/* Featured Image */}
			{article.image?.url && (
				<div className="mb-8 max-w-4xl">
					<img
						src={article.image.url}
						alt={article.title}
						className="max-h-[500px] w-full rounded-lg object-cover"
					/>
				</div>
			)}

			{/* Article Content */}
			{article.content && (
				<div className="prose max-w-3xl">
					<RichTextRenderer content={article.content as any} />
				</div>
			)}
		</article>
	);
}
