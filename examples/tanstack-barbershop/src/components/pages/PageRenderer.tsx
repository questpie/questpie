/**
 * PageRenderer Component
 *
 * Renders page content with blocks and preview support.
 * Used by homepage and dynamic page routes.
 */

import {
	type BlockContent,
	BlockRenderer,
	PreviewProvider,
	useCollectionPreview,
} from "@questpie/admin/client";
import { useRouter } from "@tanstack/react-router";
import type { PageLoaderData } from "@/lib/getPages.function";
import renderers from "@/questpie/admin/blocks";

interface PageRendererProps {
	page: PageLoaderData["page"];
	/** Show empty state messaging for homepage */
	isHomepage?: boolean;
}

export function PageRenderer({ page, isHomepage = false }: PageRendererProps) {
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
		onRefresh: () => {
			router.invalidate();
		},
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

				{!data.content?._tree?.length && (
					<EmptyState isPreviewMode={isPreviewMode} isHomepage={isHomepage} />
				)}

				{isPreviewMode && <PreviewModeIndicator />}
			</article>
		</PreviewProvider>
	);
}

function EmptyState({
	isPreviewMode,
	isHomepage,
}: {
	isPreviewMode: boolean;
	isHomepage: boolean;
}) {
	if (isHomepage) {
		return (
			<div className="py-32 text-center text-muted-foreground container">
				<h1 className="text-4xl font-bold mb-4">Welcome to Sharp Cuts</h1>
				<p className="text-xl mb-8">Your modern barbershop experience.</p>
				{isPreviewMode ? (
					<p className="text-sm">
						Add a Hero block in the admin to get started.
					</p>
				) : (
					<a
						href="/admin"
						className="text-highlight hover:underline font-medium"
					>
						Configure Homepage in Admin
					</a>
				)}
			</div>
		);
	}

	return (
		<div className="py-16 text-center text-muted-foreground">
			<p>This page has no content yet.</p>
			{isPreviewMode && (
				<p className="mt-2 text-sm">
					Add blocks in the admin panel to build this page.
				</p>
			)}
		</div>
	);
}

function PreviewModeIndicator() {
	return (
		<div className="fixed bottom-4 right-4 bg-highlight text-highlight-foreground px-4 py-2 rounded-full shadow-lg text-sm font-medium animate-bounce z-50">
			Preview Mode - Click blocks to edit
		</div>
	);
}
