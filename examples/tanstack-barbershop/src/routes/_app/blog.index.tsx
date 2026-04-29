/**
 * Blog Index Page
 *
 * Displays all published blog posts with cover images, excerpts, and metadata.
 */

import { Icon } from "@iconify/react";
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
		<div className="px-6 py-20">
			<div className="container mx-auto max-w-6xl">
				<header className="mx-auto mb-16 max-w-2xl text-center">
					<h1 className="mb-4 text-4xl font-bold tracking-tight md:text-5xl">
						Blog
					</h1>
					<p className="text-muted-foreground text-xl">
						News, tips, and stories from our barbershop
					</p>
				</header>

				<div className="grid grid-cols-1 gap-10 md:grid-cols-2 lg:grid-cols-3">
					{posts.map((post, i) => (
						<a
							key={post.id}
							href={`/blog/${post.slug}`}
							className="group animate-fade-in-up block"
							style={{ animationDelay: `${i * 100}ms` }}
						>
							<div className="bg-muted border-border relative mb-6 aspect-[16/10] overflow-hidden border">
								{post.coverImage ? (
									<img
										src={post.coverImage as string}
										alt={post.title as string}
										className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
									/>
								) : (
									<div className="bg-muted flex h-full w-full items-center justify-center">
										<Icon
											icon="ph:article"
											className="text-muted-foreground/20 size-20"
										/>
									</div>
								)}
								<div className="absolute inset-0 bg-black/0 transition-colors duration-500 group-hover:bg-black/20" />
							</div>

							<div className="text-muted-foreground mb-3 flex items-center gap-3 text-sm">
								{post.publishedAt && (
									<time>
										{formatDate(post.publishedAt as unknown as string)}
									</time>
								)}
								{post.readingTime && (
									<span className="flex items-center gap-1">
										<Icon icon="ph:clock" className="size-3.5" />
										{post.readingTime} min read
									</span>
								)}
							</div>

							<h3 className="group-hover:text-highlight mb-2 text-2xl font-bold transition-colors">
								{post.title}
							</h3>

							{post.excerpt && (
								<p className="text-muted-foreground mb-4 line-clamp-3 leading-relaxed">
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
												className="bg-muted text-muted-foreground px-2 py-0.5 text-xs font-medium"
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
					<div className="bg-muted/30 border-border border border-dashed py-20 text-center">
						<p className="text-muted-foreground text-xl">
							No blog posts yet. Check back soon!
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
