/**
 * Pages Route
 *
 * Demonstrates:
 * - BlockRenderer for rendering block content
 * - prefetchBlockData for SSR data fetching
 * - useCollectionPreview for live preview in admin
 * - Block click-to-focus (hover highlight + click to focus block in form)
 */

import {
  type BlockContent,
  BlockRenderer,
  PreviewProvider,
  useCollectionPreview,
} from "@questpie/admin/client";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { getPage } from "@/lib/getPages.function";
import blocks from "@/questpie/admin/blocks";

export const Route = createFileRoute("/_app/pages/$slug")({
  // Server-side loader - fetches page and prefetches block data
  loader: async (ctx) => {
    return getPage({ data: { slug: ctx.params.slug } });
  },

  // Head tags for SEO
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [] };
    const page = (
      loaderData as {
        page: {
          title: string;
          metaTitle?: string | null;
          metaDescription?: string | null;
        };
      }
    ).page;
    return {
      meta: [
        { title: page.metaTitle || page.title },
        ...(page.metaDescription
          ? [{ name: "description", content: page.metaDescription }]
          : []),
      ],
    };
  },

  component: PageComponent,
});

function PageComponent() {
  type PageLoaderData = Awaited<ReturnType<typeof getPage>>;
  const { page, blockData } = Route.useLoaderData() as PageLoaderData;
  const router = useRouter();

  // Preview hook - enables live updates from admin via refresh
  const {
    data,
    isPreviewMode,
    selectedBlockId,
    focusedField,
    handleFieldClick,
    handleBlockClick,
  } = useCollectionPreview({
    initialData: page,
    // Use refresh-based preview: invalidate and re-run loader
    onRefresh: () => {
      console.log("Preview: refreshing page data...");
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
        {/* Block content */}
        {data.content && (
          <BlockRenderer
            content={data.content as BlockContent}
            blocks={blocks}
            data={blockData}
            selectedBlockId={selectedBlockId}
            onBlockClick={isPreviewMode ? handleBlockClick : undefined}
          />
        )}

        {/* Empty state */}
        {!data.content?._tree?.length && (
          <div className="py-16 text-center text-muted-foreground">
            <p>This page has no content yet.</p>
            {isPreviewMode && (
              <p className="mt-2 text-sm">
                Add blocks in the admin panel to build this page.
              </p>
            )}
          </div>
        )}

        {/* Preview mode indicator */}
        {isPreviewMode && (
          <div className="fixed bottom-4 right-4 bg-highlight text-highlight-foreground px-4 py-2 rounded-full shadow-lg text-sm font-medium animate-bounce">
            Preview Mode - Click blocks to edit
          </div>
        )}
      </article>
    </PreviewProvider>
  );
}
