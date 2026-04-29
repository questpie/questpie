/**
 * News Listing Route
 *
 * Displays published news articles for a city with category filtering.
 */

import { createFileRoute, Link, useParams } from "@tanstack/react-router";

import { getNewsList } from "@/lib/server-functions";

const CATEGORIES = [
	{ value: "all", label: "All" },
	{ value: "general", label: "General" },
	{ value: "council", label: "Council" },
	{ value: "events", label: "Events" },
	{ value: "planning", label: "Planning" },
	{ value: "community", label: "Community" },
	{ value: "transport", label: "Transport" },
];

export const Route = createFileRoute("/_app/$citySlug/news/")({
	validateSearch: (search: Record<string, unknown>) => ({
		category: (search.category as string) || "all",
	}),

	loaderDeps: ({ search }) => ({ category: search.category }),

	loader: async ({ params, deps }) => {
		return getNewsList({
			data: {
				citySlug: params.citySlug,
				category: deps.category,
			},
		});
	},

	component: NewsListing,
});

function NewsListing() {
	const { news } = Route.useLoaderData();
	const { category } = Route.useSearch();
	const { citySlug } = useParams({ from: "/_app/$citySlug" });

	return (
		<div className="container mx-auto px-4 py-12">
			<div className="mb-8">
				<h1 className="mb-2 text-4xl font-bold tracking-tight">News</h1>
				<p className="text-muted-foreground">
					Latest news and updates from your council.
				</p>
			</div>

			{/* Category Filter */}
			<div className="mb-8 flex flex-wrap gap-2">
				{CATEGORIES.map((cat) => (
					<Link
						key={cat.value}
						to="/$citySlug/news"
						params={{ citySlug }}
						search={{ category: cat.value }}
						className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
							(category || "all") === cat.value
								? "bg-primary text-primary-foreground"
								: "bg-muted text-muted-foreground hover:bg-muted/80"
						}`}
					>
						{cat.label}
					</Link>
				))}
			</div>

			{/* News Grid */}
			{news.length === 0 ? (
				<div className="py-16 text-center">
					<p className="text-muted-foreground text-lg">
						No news articles found.
					</p>
				</div>
			) : (
				<div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
					{news.map((article: any) => (
						<Link
							key={article.id}
							to="/$citySlug/news/$slug"
							params={{ citySlug, slug: article.slug }}
							className="group overflow-hidden rounded-lg border transition-shadow hover:shadow-md"
						>
							{article.image?.url && (
								<img
									src={article.image.url}
									alt={article.title}
									className="h-48 w-full object-cover"
								/>
							)}
							<div className="p-6">
								<div className="mb-2 flex items-center gap-2">
									{article.category && (
										<span className="text-primary text-xs font-medium tracking-wide uppercase">
											{article.category}
										</span>
									)}
									{article.isFeatured && (
										<span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium">
											Featured
										</span>
									)}
								</div>
								<h3 className="group-hover:text-primary mb-2 text-lg font-semibold transition-colors">
									{article.title}
								</h3>
								{article.excerpt && (
									<p className="text-muted-foreground mb-3 line-clamp-2 text-sm">
										{article.excerpt}
									</p>
								)}
								<div className="text-muted-foreground flex items-center gap-3 text-xs">
									{article.publishedAt && (
										<time>
											{new Date(article.publishedAt).toLocaleDateString(
												"en-GB",
												{
													day: "numeric",
													month: "long",
													year: "numeric",
												},
											)}
										</time>
									)}
									{article.author && <span>by {article.author}</span>}
								</div>
							</div>
						</Link>
					))}
				</div>
			)}
		</div>
	);
}
