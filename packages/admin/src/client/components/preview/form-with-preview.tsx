/**
 * FormWithPreview Component
 *
 * Wrapper that renders a form alongside a live preview panel.
 * Used by FormView when a collection has preview configured.
 */

"use client";

import { Icon } from "@iconify/react";
import * as React from "react";
import type { PreviewConfig } from "../../builder/types/collection-types.js";
import {
  FocusProvider,
  type FocusState,
  parsePreviewFieldPath,
  scrollFieldIntoView,
} from "../../context/focus-context.js";
import { useIsMobile } from "../../hooks/use-media-query.js";
import { cn } from "../../lib/utils.js";
import { Button } from "../ui/button.js";
import { PreviewPane } from "./preview-pane.js";

// ============================================================================
// Types
// ============================================================================

export type FormWithPreviewProps = {
  /** Form content to render */
  children: React.ReactNode;
  /** Preview configuration from collection */
  previewConfig: PreviewConfig;
  /** Current form values (for preview URL and data) */
  values: Record<string, unknown>;
  /** Current content locale */
  locale: string;
  /** Callback when a field is clicked in preview */
  onFieldClick?: (fieldPath: string) => void;
  /** Callback when a block is clicked in preview */
  onBlockClick?: (blockId: string) => void;
  /** Callback when a relation field is clicked in preview */
  onRelationClick?: (fieldPath: string, targetCollection?: string) => void;
  /** Custom class name */
  className?: string;
};

// ============================================================================
// Component
// ============================================================================

export function FormWithPreview({
  children,
  previewConfig,
  values,
  locale,
  onFieldClick,
  onBlockClick,
  onRelationClick,
  className,
}: FormWithPreviewProps) {
  const isMobile = useIsMobile();
  const [isPreviewVisible, setIsPreviewVisible] = React.useState(!isMobile);
  const [isPreviewFullscreen, setIsPreviewFullscreen] = React.useState(false);

  // Generate preview URL
  const previewUrl = React.useMemo(() => {
    try {
      return previewConfig.url(values, locale);
    } catch {
      return null;
    }
  }, [previewConfig, values, locale]);

  // Handle focus changes from preview
  const handleFocusChange = React.useCallback(
    (state: FocusState) => {
      switch (state.type) {
        case "field":
          scrollFieldIntoView(state.fieldPath);
          onFieldClick?.(state.fieldPath);
          break;

        case "block":
          onBlockClick?.(state.blockId);
          if (state.fieldPath) {
            const fullPath = `content._values.${state.blockId}.${state.fieldPath}`;
            setTimeout(() => scrollFieldIntoView(fullPath), 100);
          }
          break;

        case "relation":
          onRelationClick?.(state.fieldPath, state.targetCollection);
          break;
      }
    },
    [onFieldClick, onBlockClick, onRelationClick],
  );

  // Handle field click from preview iframe
  const handlePreviewFieldClick = React.useCallback(
    (
      fieldPath: string,
      context?: {
        blockId?: string;
        fieldType?: "regular" | "block" | "relation";
      },
    ) => {
      const focusState = parsePreviewFieldPath(fieldPath, context);
      handleFocusChange(focusState);
    },
    [handleFocusChange],
  );

  // Handle block click from preview iframe
  const handlePreviewBlockClick = React.useCallback(
    (blockId: string) => {
      onBlockClick?.(blockId);
    },
    [onBlockClick],
  );

  // Width calculation
  const previewWidth = previewConfig.defaultWidth ?? 50;

  // Mobile: Show toggle button and fullscreen preview
  if (isMobile) {
    return (
      <FocusProvider onFocusChange={handleFocusChange}>
        <div className={cn("relative", className)} data-preview-form-scope>
          {/* Form content */}
          {children}

          {/* Preview toggle button (fixed) */}
          <Button
            variant="default"
            size="sm"
            className="fixed bottom-4 right-4 z-50 shadow-lg"
            onClick={() => setIsPreviewVisible(true)}
          >
            <Icon icon="ph:arrows-out-simple" className="mr-2 h-4 w-4" />
            Preview
          </Button>

          {/* Fullscreen preview overlay */}
          {isPreviewVisible && previewUrl && (
            <div className="fixed inset-0 z-50 bg-background">
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between border-b px-4 py-2">
                  <span className="font-medium">Preview</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsPreviewVisible(false)}
                  >
                    <Icon icon="ph:x" className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex-1">
                  <PreviewPane
                    url={previewUrl}
                    onFieldClick={handlePreviewFieldClick}
                    onBlockClick={handlePreviewBlockClick}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </FocusProvider>
    );
  }

  // Desktop: Side-by-side split
  return (
    <FocusProvider onFocusChange={handleFocusChange}>
      <div
        className={cn(
          "flex h-full",
          previewConfig.position === "bottom" ? "flex-col" : "flex-row",
          className,
        )}
      >
        {/* Form panel */}
        <div
          data-preview-form-scope
          className={cn(
            "overflow-auto",
            previewConfig.position === "bottom"
              ? "flex-1"
              : isPreviewVisible
                ? `w-[${100 - previewWidth}%]`
                : "w-full",
          )}
          style={
            isPreviewVisible && previewConfig.position !== "bottom"
              ? { width: `${100 - previewWidth}%` }
              : undefined
          }
        >
          {children}
        </div>

        {/* Preview panel */}
        {isPreviewVisible && previewUrl && !isPreviewFullscreen && (
          <>
            {/* Divider */}
            <div
              className={cn(
                "bg-border flex-shrink-0",
                previewConfig.position === "bottom" ? "h-px" : "w-px",
              )}
            />

            {/* Preview */}
            <div
              className={cn(
                "relative overflow-hidden bg-muted/30",
                previewConfig.position === "bottom" ? "h-[400px]" : "",
              )}
              style={
                previewConfig.position !== "bottom"
                  ? { width: `${previewWidth}%` }
                  : undefined
              }
            >
              {/* Preview header */}
              <div className="absolute top-0 right-0 left-0 z-10 flex items-center justify-between border-b bg-background/95 px-3 py-1.5 backdrop-blur">
                <span className="text-xs font-medium text-muted-foreground">
                  Live Preview
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setIsPreviewFullscreen(true)}
                    title="Fullscreen"
                  >
                    <Icon icon="ph:arrows-out-simple" className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setIsPreviewVisible(false)}
                    title="Close preview"
                  >
                    <Icon icon="ph:x" className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              {/* Preview content */}
              <div className="h-full pt-8">
                <PreviewPane
                  url={previewUrl}
                  onFieldClick={handlePreviewFieldClick}
                  onBlockClick={handlePreviewBlockClick}
                />
              </div>
            </div>
          </>
        )}

        {/* Preview toggle when hidden */}
        {!isPreviewVisible && (
          <Button
            variant="outline"
            size="sm"
            className="absolute top-2 right-2"
            onClick={() => setIsPreviewVisible(true)}
          >
            Show Preview
          </Button>
        )}

        {/* Fullscreen preview overlay */}
        {isPreviewFullscreen && previewUrl && (
          <div className="fixed inset-0 z-50 bg-background">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b px-4 py-2">
                <span className="font-medium">Preview</span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsPreviewFullscreen(false)}
                >
                  <Icon icon="ph:x" className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex-1">
                <PreviewPane
                  url={previewUrl}
                  onFieldClick={handlePreviewFieldClick}
                  onBlockClick={handlePreviewBlockClick}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </FocusProvider>
  );
}

// ============================================================================
// Preview Toggle for Form Header
// ============================================================================

export type PreviewToggleProps = {
  isVisible: boolean;
  onToggle: () => void;
  className?: string;
};

export function PreviewToggle({
  isVisible,
  onToggle,
  className,
}: PreviewToggleProps) {
  return (
    <Button
      variant={isVisible ? "default" : "outline"}
      size="sm"
      onClick={onToggle}
      className={className}
    >
      <Icon icon="ph:arrows-out-simple" className="mr-2 h-4 w-4" />
      {isVisible ? "Hide Preview" : "Show Preview"}
    </Button>
  );
}
