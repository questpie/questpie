/**
 * City Page Route
 *
 * Renders a specific page for a city with live preview support.
 */

import { createFileRoute, useRouter } from "@tanstack/react-router";

import { getPageBySlug } from "@/lib/server-functions";
import admin from "@/questpie/admin/.generated/client";
import {
	type BlockContent,
	BlockRenderer,
	PreviewProvider,
	useCollectionPreview,
} from "@questpie/admin/client";

export const Route = createFileRoute("/_app/$citySlug/pages/$slug")({
	loader: async ({ params }) => {
		const { citySlug, slug } = params;
		return getPageBySlug({ data: { citySlug, pageSlug: slug } });
	},

	component: CityPage,
});

function CityPage() {
	const { page } = Route.useLoaderData();

	if (!page) {
		return (
			<div className="container mx-auto px-4 py-24 text-center">
				<h1 className="mb-4 text-4xl font-bold">Page Not Found</h1>
				<p className="text-muted-foreground mb-8 text-xl">
					The page you are looking for does not exist or has been moved.
				</p>
				<a href="./" className="text-primary font-medium hover:underline">
					Go back home
				</a>
			</div>
		);
	}

	return <PageWithPreview page={page} />;
}

function PageWithPreview({ page }: { page: any }) {
	const router = useRouter();

	const {
		data,
		isPreviewMode,
		selectedBlockId,
		focusedField,
		handleFieldClick,
		handleBlockClick,
	} = useCollectionPreview({
		initialData: page,
		onRefresh: () => router.invalidate(),
	});

	return (
		<PreviewProvider
			isPreviewMode={isPreviewMode}
			focusedField={focusedField}
			onFieldClick={handleFieldClick}
		>
			<article className={isPreviewMode ? "preview-mode" : ""}>
				{/* Page Header */}
				<header className="container mx-auto px-6 py-12">
					<h1 className="text-4xl font-bold tracking-tight">{data.title}</h1>
					{data.excerpt && (
						<p className="text-muted-foreground mt-4 max-w-3xl text-xl">
							{data.excerpt}
						</p>
					)}
				</header>

				{/* Block Content */}
				{data.content && (
					<BlockRenderer
						content={data.content as BlockContent}
						renderers={admin.blocks}
						data={data.content._data}
						selectedBlockId={selectedBlockId}
						onBlockClick={isPreviewMode ? handleBlockClick : undefined}
					/>
				)}

				{!data.content?._tree?.length && !isPreviewMode && (
					<div className="text-muted-foreground container mx-auto py-16 text-center">
						<p>This page has no content yet.</p>
					</div>
				)}

				{isPreviewMode && (
					<div className="bg-primary text-primary-foreground fixed right-4 bottom-4 z-50 rounded-full px-4 py-2 text-sm font-medium shadow-lg">
						Preview Mode - Click blocks to edit
					</div>
				)}
			</article>
		</PreviewProvider>
	);
}
