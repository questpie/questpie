/**
 * News Detail Route
 *
 * Displays a single news article with rich text content.
 */

import { RichTextRenderer } from "@questpie/admin/client";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { getNewsBySlug } from "@/lib/server-functions";

export const Route = createFileRoute("/_app/$citySlug/news/$slug")({
	loader: async ({ params }) => {
		return getNewsBySlug({
			data: { citySlug: params.citySlug, newsSlug: params.slug },
		});
	},

	head: ({ loaderData }) => {
		const article = loaderData?.article;
		return {
			title: article ? `${article.title} - News` : "Article Not Found",
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
				to={`/${citySlug}/news`}
				className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors mb-8"
			>
				<svg
					className="w-4 h-4"
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
			<header className="max-w-3xl mb-8">
				<div className="flex items-center gap-3 mb-4">
					{article.category && (
						<span className="text-xs font-medium bg-primary/10 text-primary px-3 py-1 rounded-full uppercase tracking-wide">
							{article.category}
						</span>
					)}
					{article.isFeatured && (
						<span className="text-xs font-medium bg-amber-100 text-amber-800 px-3 py-1 rounded-full">
							Featured
						</span>
					)}
				</div>

				<h1 className="text-4xl font-bold tracking-tight mb-4">
					{article.title}
				</h1>

				{article.excerpt && (
					<p className="text-xl text-muted-foreground mb-4">
						{article.excerpt}
					</p>
				)}

				<div className="flex items-center gap-4 text-sm text-muted-foreground">
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
						className="w-full rounded-lg object-cover max-h-[500px]"
					/>
				</div>
			)}

			{/* Article Content */}
			{article.content && (
				<div className="prose max-w-3xl">
					<RichTextRenderer content={article.content} />
				</div>
			)}
		</article>
	);
}
