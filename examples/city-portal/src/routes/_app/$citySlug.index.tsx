/**
 * City Homepage Route
 *
 * Renders the homepage for a specific city with live preview support.
 */

import { createFileRoute, useRouter } from "@tanstack/react-router";

import { getHomepage } from "@/lib/server-functions";
import admin from "@/questpie/admin/.generated/client";
import {
	type BlockContent,
	BlockRenderer,
	PreviewProvider,
	useCollectionPreview,
} from "@questpie/admin/client";

export const Route = createFileRoute("/_app/$citySlug/")({
	loader: async ({ params }) => {
		const { citySlug } = params;
		return getHomepage({ data: { citySlug } });
	},

	component: CityHomepage,
});

function CityHomepage() {
	const { page } = Route.useLoaderData();

	if (!page) {
		return (
			<div className="container mx-auto px-4 py-24 text-center">
				<h1 className="mb-4 text-4xl font-bold">Welcome</h1>
				<p className="text-muted-foreground mb-8 text-xl">
					This city portal is being set up. Please check back soon.
				</p>
				<a href="/admin" className="text-primary font-medium hover:underline">
					Configure in Admin
				</a>
			</div>
		);
	}

	return <HomepageWithPreview page={page} />;
}

function HomepageWithPreview({ page }: { page: any }) {
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
					<div className="text-muted-foreground container mx-auto py-32 text-center">
						<h1 className="mb-4 text-4xl font-bold">Welcome to {data.title}</h1>
						<p className="mb-8 text-xl">
							Your city council website is ready to be built.
						</p>
						<a
							href="/admin"
							className="text-primary font-medium hover:underline"
						>
							Add content in the Admin Panel
						</a>
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
