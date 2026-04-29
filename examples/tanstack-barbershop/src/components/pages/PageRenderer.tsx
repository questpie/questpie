/**
 * PageRenderer Component
 *
 * Renders page content with blocks and preview support.
 * Used by homepage and dynamic page routes.
 */

import { useRouter } from "@tanstack/react-router";

import type { PageLoaderData } from "@/lib/getPages.function";
import admin from "@/questpie/admin/.generated/client";
import {
	type BlockContent,
	BlockRenderer,
	PreviewProvider,
	useCollectionPreview,
} from "@questpie/admin/client";

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
						renderers={admin.blocks}
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
			<div className="text-muted-foreground container py-32 text-center">
				<h1 className="mb-4 text-4xl font-bold">Welcome to Sharp Cuts</h1>
				<p className="mb-8 text-xl">Your modern barbershop experience.</p>
				{isPreviewMode ? (
					<p className="text-sm">
						Add a Hero block in the admin to get started.
					</p>
				) : (
					<a
						href="/admin"
						className="text-highlight font-medium hover:underline"
					>
						Configure Homepage in Admin
					</a>
				)}
			</div>
		);
	}

	return (
		<div className="text-muted-foreground py-16 text-center">
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
		<div className="bg-highlight text-highlight-foreground fixed right-4 bottom-4 z-50 animate-bounce rounded-full px-4 py-2 text-sm font-medium shadow-lg">
			Preview Mode - Click blocks to edit
		</div>
	);
}
