/**
 * Blog Index Page
 *
 * Displays all published blog posts with cover images, excerpts, and metadata.
 */

import { ArrowRight, Clock, Article } from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import { getAllBlogPosts } from "@/lib/getBlogPosts.function";
import { useTranslation } from "@/lib/providers/locale-provider";

export const Route = createFileRoute("/_app/blog/")({
	loader: async () => {
		const result = await getAllBlogPosts({ data: undefined });
		return { posts: result.posts };
	},
	component: BlogIndexPage,
});

function formatDate(dateStr: string | null | undefined) {
	if (!dateStr) return null;
	return new Intl.DateTimeFormat("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	}).format(new Date(dateStr));
}

function BlogIndexPage() {
	const { posts } = Route.useLoaderData();
	const { t } = useTranslation();

	return (
		<div className="py-20 px-6">
			<div className="container max-w-6xl mx-auto">
				<header className="mb-16 text-center max-w-2xl mx-auto">
					<h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
						Blog
					</h1>
					<p className="text-xl text-muted-foreground">
						News, tips, and stories from our barbershop
					</p>
				</header>

				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
					{posts.map((post, i) => (
						<a
							key={post.id}
							href={`/blog/${post.slug}`}
							className="group block animate-fade-in-up"
							style={{ animationDelay: `${i * 100}ms` }}
						>
							<div className="aspect-[16/10] bg-muted mb-6 overflow-hidden relative border border-border">
								{post.coverImage ? (
									<img
										src={post.coverImage as string}
										alt={post.title as string}
										className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
									/>
								) : (
									<div className="w-full h-full flex items-center justify-center bg-muted">
										<Article className="size-20 text-muted-foreground/20" />
									</div>
								)}
								<div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-500" />
							</div>

							<div className="flex items-center gap-3 text-sm text-muted-foreground mb-3">
								{post.publishedAt && (
									<time>{formatDate(post.publishedAt as unknown as string)}</time>
								)}
								{post.readingTime && (
									<span className="flex items-center gap-1">
										<Clock className="size-3.5" />
										{post.readingTime} min read
									</span>
								)}
							</div>

							<h3 className="text-2xl font-bold mb-2 group-hover:text-highlight transition-colors">
								{post.title}
							</h3>

							{post.excerpt && (
								<p className="text-muted-foreground leading-relaxed line-clamp-3 mb-4">
									{post.excerpt}
								</p>
							)}

							{post.tags && (
								<div className="flex flex-wrap gap-2">
									{String(post.tags)
										.split(",")
										.map((tag) => tag.trim())
										.filter(Boolean)
										.map((tag) => (
											<span
												key={tag}
												className="px-2 py-0.5 bg-muted text-muted-foreground text-xs font-medium"
											>
												{tag}
											</span>
										))}
								</div>
							)}
						</a>
					))}
				</div>

				{posts.length === 0 && (
					<div className="text-center py-20 bg-muted/30 border border-dashed border-border">
						<p className="text-xl text-muted-foreground">
							No blog posts yet. Check back soon!
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
