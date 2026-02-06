/**
 * Homepage Route
 *
 * Renders the page with slug "home" from the CMS.
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

export const Route = createFileRoute("/_app/")({
  loader: async () => {
    return getPage({ data: { slug: "home" } });
  },

  component: HomepageComponent,
});

function HomepageComponent() {
  type HomeLoaderData = Awaited<ReturnType<typeof getPage>>;
  const { page, blockData } = Route.useLoaderData() as HomeLoaderData;
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
        {/* We don't render the default header/title for home,
				    as it usually starts with a Hero block */}

        {data.content && (
          <BlockRenderer
            content={data.content as BlockContent}
            blocks={blocks}
            data={blockData}
            selectedBlockId={selectedBlockId}
            onBlockClick={isPreviewMode ? handleBlockClick : undefined}
          />
        )}

        {!data.content?._tree?.length && (
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
        )}

        {isPreviewMode && (
          <div className="fixed bottom-4 right-4 bg-highlight text-highlight-foreground px-4 py-2 rounded-full shadow-lg text-sm font-medium animate-bounce z-50">
            Preview Mode - Click blocks to edit
          </div>
        )}
      </article>
    </PreviewProvider>
  );
}
