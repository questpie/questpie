/**
 * City Homepage Route
 *
 * Renders the homepage for a specific city with live preview support.
 */

import {
	type BlockContent,
	BlockRenderer,
	PreviewProvider,
	useCollectionPreview,
} from "@questpie/admin/client";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { getHomepage } from "@/lib/cms-functions";
import renderers from "@/questpie/admin/blocks";

export const Route = createFileRoute("/_app/$citySlug/")({
	loader: async ({ params }) => {
		const { citySlug } = params;
		return getHomepage({ citySlug });
	},

	component: CityHomepage,
});

function CityHomepage() {
	const { page } = Route.useLoaderData();

	if (!page) {
		return (
			<div className="container mx-auto px-4 py-24 text-center">
				<h1 className="text-4xl font-bold mb-4">Welcome</h1>
				<p className="text-xl text-muted-foreground mb-8">
					This city portal is being set up. Please check back soon.
				</p>
				<a href="/admin" className="text-primary hover:underline font-medium">
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
						renderers={renderers}
						data={data.content._data}
						selectedBlockId={selectedBlockId}
						onBlockClick={isPreviewMode ? handleBlockClick : undefined}
					/>
				)}

				{!data.content?._tree?.length && !isPreviewMode && (
					<div className="py-32 text-center text-muted-foreground container mx-auto">
						<h1 className="text-4xl font-bold mb-4">Welcome to {data.title}</h1>
						<p className="text-xl mb-8">
							Your city council website is ready to be built.
						</p>
						<a
							href="/admin"
							className="text-primary hover:underline font-medium"
						>
							Add content in the Admin Panel
						</a>
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
