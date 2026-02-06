/**
 * useCollectionPreview Hook
 *
 * Hook for frontend pages to receive live preview data from admin.
 * Handles postMessage communication with the admin iframe parent.
 */

"use client";

import * as React from "react";
import type { AdminToPreviewMessage } from "./types.js";

// ============================================================================
// Types
// ============================================================================

export type UseCollectionPreviewOptions<TData> = {
  /** Server-loaded data (from loader/SSR) */
  initialData: TData;
  /**
   * Callback to refresh data (e.g., router.invalidate()).
   * Required for preview functionality.
   */
  onRefresh: () => void | Promise<void>;
};

export type UseCollectionPreviewResult<TData> = {
  /** Current data (from initialData, refreshed via onRefresh) */
  data: TData;
  /** Whether we're in preview mode (inside admin iframe) */
  isPreviewMode: boolean;
  /** Currently selected block ID */
  selectedBlockId: string | null;
  /** Focused field path */
  focusedField: string | null;
  /** Call when a field is clicked in preview */
  handleFieldClick: (
    fieldPath: string,
    context?: {
      blockId?: string;
      fieldType?: "regular" | "block" | "relation";
    },
  ) => void;
  /** Call when a block is clicked in preview */
  handleBlockClick: (blockId: string) => void;
};

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook for receiving live preview data from admin.
 *
 * Use this in your frontend page components to enable live preview.
 *
 * @example
 * ```tsx
 * function PageRoute() {
 *   const loaderData = Route.useLoaderData();
 *   const router = useRouter();
 *
 *   const { data, isPreviewMode, selectedBlockId, handleBlockClick } =
 *     useCollectionPreview({
 *       initialData: loaderData.page,
 *       onRefresh: () => router.invalidate(),
 *     });
 *
 *   return (
 *     <article>
 *       <PreviewField field="title" as="h1">{data.title}</PreviewField>
 *       <BlockRenderer
 *         content={data.content}
 *         blocks={blocks}
 *         selectedBlockId={selectedBlockId}
 *         onBlockClick={handleBlockClick}
 *       />
 *     </article>
 *   );
 * }
 * ```
 */
export function useCollectionPreview<TData extends Record<string, unknown>>({
  initialData,
  onRefresh,
}: UseCollectionPreviewOptions<TData>): UseCollectionPreviewResult<TData> {
  const [selectedBlockId, setSelectedBlockId] = React.useState<string | null>(
    null,
  );
  const [focusedField, setFocusedField] = React.useState<string | null>(null);

  // Check if we're in an iframe (preview mode)
  const isPreviewMode = React.useMemo(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.self !== window.top;
    } catch {
      // Cross-origin iframe - assume we're in preview mode
      return true;
    }
  }, []);

  // Keep onRefresh in a ref to avoid stale closures while maintaining stable reference
  const onRefreshRef = React.useRef(onRefresh);
  React.useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  // Set up postMessage listener
  React.useEffect(() => {
    if (!isPreviewMode) return;

    // Signal that preview is ready
    window.parent.postMessage({ type: "PREVIEW_READY" }, "*");

    const handleMessage = async (
      event: MessageEvent<AdminToPreviewMessage>,
    ) => {
      // In production, validate origin here
      const message = event.data;

      if (!message || typeof message !== "object" || !message.type) {
        return;
      }

      switch (message.type) {
        case "PREVIEW_REFRESH": {
          await onRefreshRef.current();
          window.parent.postMessage(
            {
              type: "REFRESH_COMPLETE",
              timestamp: Date.now(),
            },
            "*",
          );
          break;
        }

        case "SELECT_BLOCK":
          setSelectedBlockId(message.blockId);
          break;

        case "FOCUS_FIELD": {
          setFocusedField(message.fieldPath);
          // Scroll field into view (with delay to ensure React render)
          setTimeout(() => {
            const element = document.querySelector(
              `[data-preview-field="${message.fieldPath}"]`,
            );
            if (element) {
              element.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          }, 150);
          break;
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [isPreviewMode]);

  // Field click handler
  const handleFieldClick = React.useCallback(
    (
      fieldPath: string,
      context?: {
        blockId?: string;
        fieldType?: "regular" | "block" | "relation";
      },
    ) => {
      if (isPreviewMode) {
        window.parent.postMessage(
          {
            type: "FIELD_CLICKED",
            fieldPath,
            blockId: context?.blockId,
            fieldType: context?.fieldType,
          },
          "*",
        );
      }
    },
    [isPreviewMode],
  );

  // Block click handler
  const handleBlockClick = React.useCallback(
    (blockId: string) => {
      if (isPreviewMode) {
        window.parent.postMessage({ type: "BLOCK_CLICKED", blockId }, "*");
      }
    },
    [isPreviewMode],
  );

  return {
    data: initialData,
    isPreviewMode,
    selectedBlockId,
    focusedField,
    handleFieldClick,
    handleBlockClick,
  };
}
