/**
 * Blog Post Detail Route
 *
 * Displays a single blog post with full content, author info, and live preview support.
 */

import { Icon } from "@iconify/react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";

import { getBlogPost } from "@/lib/getBlogPosts.function";
import {
	PreviewField,
	PreviewProvider,
	RichTextRenderer,
	type TipTapDoc,
	useCollectionPreview,
} from "@questpie/admin/client";

export const Route = createFileRoute("/_app/blog/$slug")({
	loader: async (ctx) => {
		return await getBlogPost({
			data: { slug: ctx.params.slug },
		});
	},
	component: BlogPostPage,
});

function formatDate(date: string | Date | null | undefined) {
	if (!date) return null;
	return new Intl.DateTimeFormat("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	}).format(typeof date === "string" ? new Date(date) : date);
}

function BlogPostPage() {
	const loaderData = Route.useLoaderData();
	const post = loaderData?.post;
	const router = useRouter();

	const { data, isPreviewMode, focusedField, handleFieldClick } =
		useCollectionPreview({
			initialData: post,
			onRefresh: () => router.invalidate(),
		});

	const previewPost = data as typeof post;

	return (
		<PreviewProvider
			isPreviewMode={isPreviewMode}
			focusedField={focusedField}
			onFieldClick={handleFieldClick}
		>
			<div className={isPreviewMode ? "preview-mode px-6 py-20" : "px-6 py-20"}>
				<div className="container mx-auto max-w-3xl">
					{/* Back Link */}
					<Link
						to="/blog"
						className="text-muted-foreground hover:text-foreground group mb-12 inline-flex items-center gap-2 transition-colors"
					>
						<Icon
							icon="ph:arrow-left"
							className="size-4 transition-transform group-hover:-translate-x-1"
						/>
						Back to Blog
					</Link>

					{/* Cover Image */}
					{previewPost.coverImage && (
						<PreviewField
							field="coverImage"
							className="bg-muted border-border mb-10 aspect-[16/9] overflow-hidden border"
						>
							<img
								src={previewPost.coverImage as string}
								alt={previewPost.title as string}
								className="h-full w-full object-cover"
							/>
						</PreviewField>
					)}

					{/* Meta */}
					<div className="text-muted-foreground mb-6 flex items-center gap-4 text-sm">
						{previewPost.publishedAt && (
							<time>{formatDate(previewPost.publishedAt)}</time>
						)}
						{previewPost.readingTime && (
							<span className="flex items-center gap-1.5">
								<Icon icon="ph:clock" className="size-4" />
								{previewPost.readingTime} min read
							</span>
						)}
					</div>

					{/* Title */}
					<PreviewField
						field="title"
						as="h1"
						className="mb-6 text-4xl font-bold tracking-tight md:text-5xl"
					>
						{previewPost.title}
					</PreviewField>

					{/* Tags */}
					{previewPost.tags && (
						<PreviewField field="tags" className="mb-8 flex flex-wrap gap-2">
							{String(previewPost.tags)
								.split(",")
								.map((tag: string) => tag.trim())
								.filter(Boolean)
								.map((tag: string) => (
									<span
										key={tag}
										className="bg-highlight/10 text-highlight px-3 py-1 text-sm font-bold tracking-wider uppercase"
									>
										{tag}
									</span>
								))}
						</PreviewField>
					)}

					{/* Author */}
					{previewPost.author && (
						<PreviewField
							field="author"
							fieldType="relation"
							className="bg-muted/30 border-border mb-12 flex items-center gap-4 border p-6"
						>
							<div className="bg-muted border-border flex size-12 shrink-0 items-center justify-center border">
								<Icon
									icon="ph:user"
									className="text-muted-foreground/40 size-6"
								/>
							</div>
							<div>
								<p className="font-bold">
									{previewPost.author?.name || previewPost.author?.email}
								</p>
								<p className="text-muted-foreground text-sm">Author</p>
							</div>
						</PreviewField>
					)}

					{/* Content */}
					<PreviewField
						field="content"
						className="prose prose-stone prose-lg dark:prose-invert max-w-none"
					>
						<RichTextRenderer
							content={previewPost.content as TipTapDoc}
							styles={{
								paragraph:
									"text-muted-foreground leading-relaxed mb-6 last:mb-0",
								heading1: "text-3xl font-bold tracking-tight mt-12 mb-4",
								heading2: "text-2xl font-bold tracking-tight mt-10 mb-4",
								heading3: "text-xl font-bold tracking-tight mt-8 mb-3",
							}}
						/>
						{!previewPost.content && (
							<p className="text-muted-foreground leading-relaxed">
								No content yet.
							</p>
						)}
					</PreviewField>

					{isPreviewMode && (
						<div className="bg-highlight text-highlight-foreground fixed right-4 bottom-4 z-50 rounded-full px-4 py-2 text-sm font-medium shadow-lg">
							Preview Mode - Click fields to edit
						</div>
					)}
				</div>
			</div>
		</PreviewProvider>
	);
}
