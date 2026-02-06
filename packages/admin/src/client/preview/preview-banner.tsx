/**
 * Preview Banner Component
 *
 * Displayed at the top of preview pages when in draft mode.
 * Allows users to exit preview mode (clear __draft_mode cookie).
 */

"use client";

import * as React from "react";

// ============================================================================
// Types
// ============================================================================

export type PreviewBannerProps = {
  /** Whether we're in preview mode */
  isPreviewMode: boolean;
  /** Custom class name */
  className?: string;
  /** Custom exit preview URL (default: /api/preview?disable=true) */
  exitPreviewUrl?: string;
};

// ============================================================================
// Component
// ============================================================================

/**
 * Preview mode banner with exit button.
 *
 * Shows a sticky banner at the top of the page when in draft/preview mode.
 * Clicking "Exit Preview" clears the draft mode cookie.
 *
 * @example
 * ```tsx
 * export default function RootLayout({ children }) {
 *   const { isPreviewMode } = useCollectionPreview({ ... });
 *
 *   return (
 *     <>
 *       <PreviewBanner isPreviewMode={isPreviewMode} />
 *       {children}
 *     </>
 *   );
 * }
 * ```
 */
export function PreviewBanner({
  isPreviewMode,
  className,
  exitPreviewUrl = "/api/preview?disable=true",
}: PreviewBannerProps) {
  if (!isPreviewMode) return null;

  return (
    <div
      className={className}
      style={{
        position: "sticky",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        backgroundColor: "hsl(var(--primary))",
        color: "hsl(var(--primary-foreground))",
        padding: "0.5rem 1rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "1rem",
        fontSize: "0.875rem",
        fontWeight: 500,
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 256 256"
          fill="currentColor"
        >
          <title>Eye icon</title>
          <path d="M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.47,133.47,0,0,1,25,128,133.33,133.33,0,0,1,48.07,97.25C70.33,75.19,97.22,64,128,64s57.67,11.19,79.93,33.25A133.46,133.46,0,0,1,231.05,128C223.84,141.46,192.43,192,128,192Zm0-112a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Z" />
        </svg>
        <span>Preview Mode</span>
      </div>

      <a
        href={exitPreviewUrl}
        style={{
          padding: "0.25rem 0.75rem",
          backgroundColor: "rgba(255, 255, 255, 0.2)",
          border: "1px solid rgba(255, 255, 255, 0.3)",
          borderRadius: "4px",
          color: "inherit",
          textDecoration: "none",
          fontWeight: 600,
          fontSize: "0.875rem",
          cursor: "pointer",
          transition: "background-color 0.2s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.3)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.2)";
        }}
      >
        Exit Preview
      </a>
    </div>
  );
}
