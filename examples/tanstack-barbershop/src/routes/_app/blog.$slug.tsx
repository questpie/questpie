/**
 * Blog Post Detail Route
 *
 * Displays a single blog post with full content, author info, and live preview support.
 */

import { ArrowLeft, Clock, User } from "@phosphor-icons/react";
import {
	PreviewField,
	PreviewProvider,
	RichTextRenderer,
	type TipTapDoc,
	useCollectionPreview,
} from "@questpie/admin/client";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { getBlogPost } from "@/lib/getBlogPosts.function";

export const Route = createFileRoute("/_app/blog/$slug")({
	loader: async (ctx) => {
		return (await getBlogPost({ data: { slug: ctx.params.slug } })) as any;
	},
	component: BlogPostPage,
});

function formatDate(dateStr: string | null | undefined) {
	if (!dateStr) return null;
	return new Intl.DateTimeFormat("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	}).format(new Date(dateStr));
}

function BlogPostPage() {
	const loaderData = Route.useLoaderData() as any;
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
			<div
				className={isPreviewMode ? "preview-mode py-20 px-6" : "py-20 px-6"}
			>
				<div className="container max-w-3xl mx-auto">
					{/* Back Link */}
					<Link
						to="/blog"
						className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-12 transition-colors group"
					>
						<ArrowLeft className="size-4 transition-transform group-hover:-translate-x-1" />
						Back to Blog
					</Link>

					{/* Cover Image */}
					{previewPost.coverImage && (
						<PreviewField
							field="coverImage"
							className="aspect-[16/9] bg-muted mb-10 overflow-hidden border border-border"
						>
							<img
								src={previewPost.coverImage as string}
								alt={previewPost.title as string}
								className="w-full h-full object-cover"
							/>
						</PreviewField>
					)}

					{/* Meta */}
					<div className="flex items-center gap-4 text-sm text-muted-foreground mb-6">
						{previewPost.publishedAt && (
							<time>{formatDate(previewPost.publishedAt as string)}</time>
						)}
						{previewPost.readingTime && (
							<span className="flex items-center gap-1.5">
								<Clock className="size-4" />
								{previewPost.readingTime} min read
							</span>
						)}
					</div>

					{/* Title */}
					<PreviewField
						field="title"
						as="h1"
						className="text-4xl md:text-5xl font-bold tracking-tight mb-6"
					>
						{previewPost.title}
					</PreviewField>

					{/* Tags */}
					{previewPost.tags && (
						<PreviewField field="tags" className="flex flex-wrap gap-2 mb-8">
							{String(previewPost.tags)
								.split(",")
								.map((tag: string) => tag.trim())
								.filter(Boolean)
								.map((tag: string) => (
									<span
										key={tag}
										className="px-3 py-1 bg-highlight/10 text-highlight text-sm font-bold uppercase tracking-wider"
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
							className="flex items-center gap-4 p-6 bg-muted/30 border border-border mb-12"
						>
							<div className="size-12 bg-muted border border-border flex items-center justify-center shrink-0">
								<User className="size-6 text-muted-foreground/40" />
							</div>
							<div>
								<p className="font-bold">
									{(previewPost.author as any).name ||
										(previewPost.author as any).email}
								</p>
								<p className="text-sm text-muted-foreground">Author</p>
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
						<div className="fixed bottom-4 right-4 bg-highlight text-highlight-foreground px-4 py-2 rounded-full shadow-lg text-sm font-medium z-50">
							Preview Mode - Click fields to edit
						</div>
					)}
				</div>
			</div>
		</PreviewProvider>
	);
}
