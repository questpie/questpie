/**
 * LivePreviewMode Component
 *
 * Fullscreen overlay for live preview editing.
 * Left side: Form panel (inline, not portal)
 * Right side: Preview iframe
 * Mobile: Tabs to switch between form and preview
 */

"use client";

import { Icon } from "@iconify/react";
import * as React from "react";
import type { CollectionBuilderState } from "../../builder/types/collection-types.js";
import type { ComponentRegistry } from "../../builder/types/field-types.js";
import {
  FocusProvider,
  type FocusState,
  parsePreviewFieldPath,
  scrollFieldIntoView,
  useFocus,
} from "../../context/focus-context.js";
import { useIsMobile } from "../../hooks/use-media-query.js";
import { useTranslation } from "../../i18n/hooks.js";
import { cn } from "../../lib/utils.js";
import {
  LocaleScopeProvider,
  selectBasePath,
  selectNavigate,
  useAdminStore,
} from "../../runtime/index.js";
import FormView from "../../views/collection/form-view.js";
import { Button } from "../ui/button.js";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs.js";
import { PreviewPane, type PreviewPaneRef } from "./preview-pane.js";

// ============================================================================
// Context
// ============================================================================

type LivePreviewContextValue = {
  triggerPreviewRefresh: () => void;
};

const LivePreviewContext = React.createContext<LivePreviewContextValue | null>(
  null,
);

export function useLivePreviewContext() {
  return React.useContext(LivePreviewContext);
}

// ============================================================================
// Types
// ============================================================================

export interface LivePreviewModeProps {
  /** Whether preview mode is open */
  open: boolean;
  /** Callback to close preview mode */
  onClose: () => void;
  /** Collection name */
  collection: string;
  /** Item ID (for edit mode) */
  itemId?: string;
  /** Collection config */
  config?: any;
  /** All collections config (for embedded) */
  allCollectionsConfig?: Record<string, any>;
  /** Component registry */
  registry?: ComponentRegistry;
  /** Preview URL */
  previewUrl: string;
  /** Callback after successful save */
  onSuccess?: (data: any) => void;
}

// ============================================================================
// Inner Component (with FocusContext access)
// ============================================================================

type LivePreviewContentProps = LivePreviewModeProps & {
  previewRef: React.RefObject<PreviewPaneRef | null>;
};

function LivePreviewContent({
  onClose,
  collection,
  itemId,
  config,
  allCollectionsConfig,
  registry,
  previewUrl,
  onSuccess,
  previewRef,
}: LivePreviewContentProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const navigate = useAdminStore(selectNavigate);
  const basePath = useAdminStore(selectBasePath);
  const [activeTab, setActiveTab] = React.useState<"form" | "preview">("form");

  // Access FocusContext
  const focusContext = useFocus();
  const focusState = focusContext.state; // Extract for effect dependency

  // Handle exit preview (clear draft mode cookie)
  const handleExitPreview = React.useCallback(() => {
    // Redirect to exit preview endpoint
    window.location.href = "/api/preview?disable=true";
  }, []);

  // Sync focus changes to preview iframe
  React.useEffect(() => {
    if (!previewRef.current) return;

    if (focusState.type === "field") {
      previewRef.current.sendFocusToPreview(focusState.fieldPath);
    } else if (focusState.type === "block") {
      // Send full block field path
      if (focusState.fieldPath) {
        const fullPath = `content._values.${focusState.blockId}.${focusState.fieldPath}`;
        previewRef.current.sendFocusToPreview(fullPath);
      } else {
        // Just the block itself
        const fullPath = `content._values.${focusState.blockId}`;
        previewRef.current.sendFocusToPreview(fullPath);
      }
    }
  }, [focusState, previewRef]);

  // Preview click handlers - update FocusContext state
  const handlePreviewFieldClick = React.useCallback(
    (fieldPath: string, context?: any) => {
      const state = parsePreviewFieldPath(fieldPath, context);

      if (state.type === "field") {
        focusContext.focusField(state.fieldPath);
      } else if (state.type === "block") {
        focusContext.focusBlock(state.blockId, state.fieldPath);
      } else if (state.type === "relation") {
        focusContext.focusRelation(state.fieldPath, state.targetCollection);
      }
    },
    [focusContext],
  );

  const handlePreviewBlockClick = React.useCallback(
    (blockId: string) => {
      focusContext.focusBlock(blockId);
    },
    [focusContext],
  );

  // Use provided config or undefined (schema-driven)
  const resolvedConfig = config;
  const resolvedAllCollections = allCollectionsConfig;

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2 shrink-0">
        <div className="flex items-center gap-2">
          <Icon icon="ph:eye" className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{t("preview.livePreview")}</span>
        </div>

        {/* Mobile tabs in header */}
        {isMobile && (
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "form" | "preview")}
            className="mx-4"
          >
            <TabsList className="h-8">
              <TabsTrigger value="form" className="text-xs px-3">
                {t("common.form")}
              </TabsTrigger>
              <TabsTrigger value="preview" className="text-xs px-3">
                {t("preview.title")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleExitPreview}
            className="gap-1.5"
            title="Exit preview mode and clear draft cookie"
          >
            <Icon icon="ph:sign-out" className="h-4 w-4" />
            <span className="hidden sm:inline">Exit Preview</span>
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <Icon icon="ph:x" className="h-4 w-4" />
            <span className="sr-only">{t("common.close")}</span>
          </Button>
        </div>
      </div>

      {/* Content */}
      {isMobile ? (
        /* Mobile: Tabs content */
        <div className="flex-1 min-h-0">
          {activeTab === "form" ? (
            <div className="h-full overflow-y-auto p-6" data-preview-form-scope>
              <LocaleScopeProvider>
                <FormView
                  collection={collection}
                  id={itemId}
                  config={resolvedConfig}
                  allCollectionsConfig={resolvedAllCollections}
                  registry={registry}
                  navigate={navigate}
                  basePath={basePath}
                  onSuccess={onSuccess}
                  showMeta={false}
                />
              </LocaleScopeProvider>
            </div>
          ) : (
            <div className="h-full">
              <PreviewPane
                ref={previewRef}
                url={previewUrl}
                onFieldClick={handlePreviewFieldClick}
                onBlockClick={handlePreviewBlockClick}
              />
            </div>
          )}
        </div>
      ) : (
        /* Desktop: Side by side */
        <div className="flex-1 flex min-h-0">
          {/* Form panel - fixed width like sheet */}
          <div
            data-preview-form-scope
            className={cn(
              "h-full border-r bg-background shrink-0",
              "w-full sm:max-w-2xl",
              "overflow-y-auto p-6",
            )}
          >
            <LocaleScopeProvider>
              <FormView
                collection={collection}
                id={itemId}
                config={resolvedConfig}
                allCollectionsConfig={resolvedAllCollections}
                registry={registry}
                navigate={navigate}
                basePath={basePath}
                onSuccess={onSuccess}
                showMeta={false}
              />
            </LocaleScopeProvider>
          </div>

          {/* Preview panel - fills remaining space */}
          <div className="flex-1 min-w-0 bg-muted/30">
            <PreviewPane
              ref={previewRef}
              url={previewUrl}
              onFieldClick={handlePreviewFieldClick}
              onBlockClick={handlePreviewBlockClick}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function LivePreviewMode({
  open,
  onClose,
  collection,
  itemId,
  config,
  allCollectionsConfig,
  registry,
  previewUrl,
  onSuccess,
}: LivePreviewModeProps) {
  // Create ref for PreviewPane
  const previewRef = React.useRef<PreviewPaneRef>(null);

  // Create context value with refresh callback
  const contextValue = React.useMemo(
    () => ({
      triggerPreviewRefresh: () => {
        previewRef.current?.triggerRefresh();
      },
    }),
    [],
  );

  // Handle focus changes from FocusContext - scroll to and focus the field
  const handleFocusChange = React.useCallback((state: FocusState) => {
    if (state.type === "field") {
      scrollFieldIntoView(state.fieldPath);
    } else if (state.type === "block") {
      // Wait for block form to render before scrolling
      setTimeout(() => {
        const fullPath = state.fieldPath
          ? `content._values.${state.blockId}.${state.fieldPath}`
          : `content._values.${state.blockId}`;
        scrollFieldIntoView(fullPath);
      }, 150);
    }
  }, []);

  if (!open) return null;

  return (
    <LivePreviewContext.Provider value={contextValue}>
      <FocusProvider onFocusChange={handleFocusChange}>
        <LivePreviewContent
          open={open}
          onClose={onClose}
          collection={collection}
          itemId={itemId}
          config={config}
          allCollectionsConfig={allCollectionsConfig}
          registry={registry}
          previewUrl={previewUrl}
          onSuccess={onSuccess}
          previewRef={previewRef}
        />
      </FocusProvider>
    </LivePreviewContext.Provider>
  );
}

// ============================================================================
// Trigger Button Component
// ============================================================================

export interface LivePreviewButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

export function LivePreviewButton({
  onClick,
  disabled,
}: LivePreviewButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="size-9"
      onClick={onClick}
      disabled={disabled}
      title="Live Preview"
    >
      <Icon icon="ph:eye" className="size-4" />
      <span className="sr-only">Live Preview</span>
    </Button>
  );
}
