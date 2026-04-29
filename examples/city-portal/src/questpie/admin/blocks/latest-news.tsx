/**
 * Latest News Block Renderer
 */

import type { BlockProps } from "../.generated/client";

export function LatestNewsRenderer({
	values,
	data,
}: BlockProps<"latest-news">) {
	const news = (data as any)?.news || [];

	return (
		<section className="px-6 py-16">
			<div className="container mx-auto">
				{values.title && (
					<h2 className="mb-8 text-3xl font-bold tracking-tight">
						{values.title}
					</h2>
				)}

				{news.length === 0 && (
					<p className="text-muted-foreground py-8 text-center">
						No news articles available.
					</p>
				)}

				<div
					className={
						values.layout === "list"
							? "space-y-4"
							: "grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3"
					}
				>
					{news.map((article: any) => (
						<article
							key={article.id}
							className="overflow-hidden rounded-lg border transition-shadow hover:shadow-md"
						>
							<div className="p-6">
								{article.category && (
									<span className="text-primary text-xs font-medium tracking-wide uppercase">
										{article.category}
									</span>
								)}
								<h3 className="mt-1 mb-2 font-semibold">{article.title}</h3>
								{article.excerpt && (
									<p className="text-muted-foreground line-clamp-2 text-sm">
										{article.excerpt}
									</p>
								)}
								{article.publishedAt && (
									<time className="text-muted-foreground mt-3 block text-xs">
										{new Date(article.publishedAt).toLocaleDateString("en-GB", {
											day: "numeric",
											month: "long",
											year: "numeric",
										})}
									</time>
								)}
							</div>
						</article>
					))}
				</div>
			</div>
		</section>
	);
}
