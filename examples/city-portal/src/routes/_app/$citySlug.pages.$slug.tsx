/**
 * City Page Route
 *
 * Renders a specific page for a city with live preview support.
 */

import {
	type BlockContent,
	BlockRenderer,
	PreviewProvider,
	useCollectionPreview,
} from "@questpie/admin/client";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { getPageBySlug } from "@/lib/cms-functions";
import renderers from "@/questpie/admin/blocks";

export const Route = createFileRoute("/_app/$citySlug/pages/$slug")({
	loader: async ({ params }) => {
		const { citySlug, slug } = params;
		return getPageBySlug({ citySlug, pageSlug: slug });
	},

	component: CityPage,
});

function CityPage() {
	const { page } = Route.useLoaderData();

	if (!page) {
		return (
			<div className="container mx-auto px-4 py-24 text-center">
				<h1 className="text-4xl font-bold mb-4">Page Not Found</h1>
				<p className="text-xl text-muted-foreground mb-8">
					The page you are looking for does not exist or has been moved.
				</p>
				<a href="./" className="text-primary hover:underline font-medium">
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
						<p className="mt-4 text-xl text-muted-foreground max-w-3xl">
							{data.excerpt}
						</p>
					)}
				</header>

				{/* Block Content */}
				{data.content && (
					<BlockRenderer
						content={data.content as BlockContent}
						renderers={renderers}
						data={data.content._data}
						selectedBlockId={selectedBlockId}
						onBlockClick={isPreviewMode ? handleBlockClick : undefined}
					/>
				)}

				{!data.content?._tree?.length && !isPreviewMode && (
					<div className="py-16 text-center text-muted-foreground container mx-auto">
						<p>This page has no content yet.</p>
					</div>
				)}

				{isPreviewMode && (
					<div className="fixed bottom-4 right-4 bg-blue-700 text-white px-4 py-2 rounded-full shadow-lg text-sm font-medium z-50">
						Preview Mode - Click blocks to edit
					</div>
				)}
			</article>
		</PreviewProvider>
	);
}
