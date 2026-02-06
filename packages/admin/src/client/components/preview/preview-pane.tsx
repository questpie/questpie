/**
 * Preview Pane
 *
 * Admin-side component that renders the preview iframe
 * and handles postMessage communication with the preview page.
 */

"use client";

import { Icon } from "@iconify/react";
import * as React from "react";
import { cn } from "../../lib/utils.js";
import type {
  AdminToPreviewMessage,
  PreviewToAdminMessage,
} from "../../preview/types.js";
import { isPreviewToAdminMessage } from "../../preview/types.js";
import { selectClient, useAdminStore } from "../../runtime/index.js";

// ============================================================================
// Types
// ============================================================================

export type PreviewPaneRef = {
  triggerRefresh: () => void;
  sendFocusToPreview: (fieldPath: string) => void;
};

export type PreviewPaneProps = {
  /** Preview URL */
  url: string;
  /** Selected block ID (for block editor integration) */
  selectedBlockId?: string | null;
  /** Field click handler */
  onFieldClick?: (
    fieldPath: string,
    context?: {
      blockId?: string;
      fieldType?: "regular" | "block" | "relation";
    },
  ) => void;
  /** Block click handler */
  onBlockClick?: (blockId: string) => void;
  /** Custom class name */
  className?: string;
  /** Allowed preview origins (for security) */
  allowedOrigins?: string[];
};

// ============================================================================
// Component
// ============================================================================

/**
 * Preview pane component for admin.
 *
 * Renders an iframe with the preview page and handles
 * bidirectional communication via postMessage.
 */
export const PreviewPane = React.forwardRef<PreviewPaneRef, PreviewPaneProps>(
  (
    {
      url,
      selectedBlockId,
      onFieldClick,
      onBlockClick,
      className,
      allowedOrigins,
    },
    ref,
  ) => {
    const client = useAdminStore(selectClient);
    const iframeRef = React.useRef<HTMLIFrameElement>(null);
    const [isReady, setIsReady] = React.useState(false);
    const [isLoading, setIsLoading] = React.useState(true);
    const [isRefreshing, setIsRefreshing] = React.useState(false);
    const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
    const [tokenError, setTokenError] = React.useState<string | null>(null);

    // Mint preview token when URL changes
    React.useEffect(() => {
      const mintToken = async () => {
        if (!url) {
          setPreviewUrl(null);
          return;
        }

        setIsLoading(true);
        setTokenError(null);

        try {
          // Use type assertion since the client type may not include mintPreviewToken
          // depending on which modules are used
          const result = await (client as any).rpc.mintPreviewToken({
            path: url,
            ttlMs: 60 * 60 * 1000, // 1 hour
          });
          setPreviewUrl(`/api/preview?token=${result.token}`);
        } catch (error) {
          console.error("Failed to mint preview token:", error);
          setTokenError(
            error instanceof Error
              ? error.message
              : "Failed to generate preview token",
          );
          setPreviewUrl(null);
          setIsLoading(false);
        }
      };

      mintToken();
    }, [url, client]);

    // Validate origin for security
    const isValidOrigin = React.useCallback(
      (origin: string): boolean => {
        if (!allowedOrigins || allowedOrigins.length === 0) {
          // If no origins specified, allow same origin and preview URL origin
          try {
            const previewOrigin = new URL(url).origin;
            return (
              origin === window.location.origin || origin === previewOrigin
            );
          } catch {
            return origin === window.location.origin;
          }
        }
        return allowedOrigins.includes(origin);
      },
      [url, allowedOrigins],
    );

    // Send message to preview iframe
    const sendToPreview = React.useCallback(
      (message: AdminToPreviewMessage) => {
        const iframe = iframeRef.current;
        if (!iframe?.contentWindow) return;

        try {
          const targetOrigin = new URL(url).origin;
          iframe.contentWindow.postMessage(message, targetOrigin);
        } catch {
          // If URL parsing fails, use wildcard (less secure)
          iframe.contentWindow.postMessage(message, "*");
        }
      },
      [url],
    );

    // Expose refresh and focus methods via imperative handle
    React.useImperativeHandle(
      ref,
      () => ({
        triggerRefresh: () => {
          if (isReady) {
            setIsRefreshing(true);
            sendToPreview({ type: "PREVIEW_REFRESH" });
          }
        },
        sendFocusToPreview: (fieldPath: string) => {
          if (isReady) {
            sendToPreview({ type: "FOCUS_FIELD", fieldPath });
          }
        },
      }),
      [isReady, sendToPreview],
    );

    // Listen for messages from preview
    React.useEffect(() => {
      const handleMessage = (event: MessageEvent<PreviewToAdminMessage>) => {
        // Validate origin
        if (!isValidOrigin(event.origin)) {
          return;
        }

        // Validate message structure
        if (!isPreviewToAdminMessage(event.data)) {
          return;
        }

        switch (event.data.type) {
          case "PREVIEW_READY":
            setIsReady(true);
            setIsLoading(false);
            break;

          case "REFRESH_COMPLETE":
            setIsRefreshing(false);
            break;

          case "FIELD_CLICKED":
            onFieldClick?.(event.data.fieldPath, {
              blockId: event.data.blockId,
              fieldType: event.data.fieldType,
            });
            break;

          case "BLOCK_CLICKED":
            onBlockClick?.(event.data.blockId);
            break;
        }
      };

      window.addEventListener("message", handleMessage);
      return () => window.removeEventListener("message", handleMessage);
    }, [isValidOrigin, onFieldClick, onBlockClick]);

    // Send selected block updates
    React.useEffect(() => {
      if (isReady && selectedBlockId) {
        sendToPreview({ type: "SELECT_BLOCK", blockId: selectedBlockId });
      }
    }, [isReady, selectedBlockId, sendToPreview]);

    // Handle iframe load
    const handleLoad = () => {
      // Preview should signal PREVIEW_READY, but set a fallback timeout
      setTimeout(() => {
        if (!isReady) {
          setIsLoading(false);
        }
      }, 3000);
    };

    return (
      <div className={cn("relative h-full w-full", className)}>
        {/* Loading overlay */}
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-muted/80">
            <Icon
              icon="ph:spinner"
              className="h-6 w-6 animate-spin text-muted-foreground"
            />
            <span className="ml-2 text-sm text-muted-foreground">
              Loading preview...
            </span>
          </div>
        )}

        {/* Error overlay */}
        {tokenError && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-muted/80">
            <div className="rounded-md bg-destructive/10 border border-destructive px-4 py-3 text-sm text-destructive">
              <p className="font-medium">Preview Error</p>
              <p>{tokenError}</p>
            </div>
          </div>
        )}

        {/* Refreshing indicator */}
        {isRefreshing && !isLoading && (
          <div className="absolute top-4 right-4 z-10 flex items-center gap-2 rounded-md bg-background px-3 py-2 shadow-md border">
            <Icon
              icon="ph:spinner"
              className="h-4 w-4 animate-spin text-muted-foreground"
            />
            <span className="text-sm text-muted-foreground">Refreshing...</span>
          </div>
        )}

        {/* Preview iframe */}
        {previewUrl && (
          <iframe
            ref={iframeRef}
            src={previewUrl}
            className="h-full w-full border-0"
            title="Preview"
            onLoad={handleLoad}
            sandbox="allow-scripts allow-same-origin allow-forms"
          />
        )}
      </div>
    );
  },
);

PreviewPane.displayName = "PreviewPane";

// ============================================================================
// Preview Toggle Button
// ============================================================================

export type PreviewToggleButtonProps = {
  /** Whether preview is currently visible */
  isPreviewVisible: boolean;
  /** Toggle handler */
  onToggle: () => void;
  /** Custom class name */
  className?: string;
};

/**
 * Button to toggle preview pane visibility.
 */
export function PreviewToggleButton({
  isPreviewVisible,
  onToggle,
  className,
}: PreviewToggleButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm",
        "border transition-colors",
        isPreviewVisible
          ? "border-primary bg-primary/10 text-primary"
          : "border-border hover:bg-muted",
        className,
      )}
    >
      {isPreviewVisible ? "Hide Preview" : "Show Preview"}
    </button>
  );
}
