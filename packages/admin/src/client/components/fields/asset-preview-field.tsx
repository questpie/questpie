/**
 * AssetPreviewField Component
 *
 * Read-only field that displays the current asset's preview (image/video/file).
 * Used in the assets collection form to show a preview of the uploaded file.
 *
 * @example
 * ```tsx
 * <AssetPreviewField
 *   name="url"
 *   label="Preview"
 * />
 * ```
 */

import * as React from "react";
import { useFormContext, useWatch } from "react-hook-form";
import type { I18nText } from "../../i18n/types";
import { cn } from "../../lib/utils";
import { AssetThumbnail } from "../../views/collection/cells";
import { FieldWrapper } from "./field-wrapper";

// ============================================================================
// Types
// ============================================================================

export interface AssetPreviewFieldProps {
  /**
   * Field name (not used for value, just for form integration)
   */
  name?: string;

  /**
   * Label for the field (supports I18nText)
   */
  label?: I18nText;

  /**
   * Description text (supports I18nText)
   */
  description?: I18nText;

  /**
   * Additional className
   */
  className?: string;

  /**
   * URL field name to watch (defaults to "url")
   */
  urlField?: string;

  /**
   * MIME type field name to watch (defaults to "mimeType")
   */
  mimeTypeField?: string;

  /**
   * Filename field name to watch (defaults to "filename")
   */
  filenameField?: string;

  /**
   * Alt text field name to watch (defaults to "alt")
   */
  altField?: string;
}

// ============================================================================
// Component
// ============================================================================

export function AssetPreviewField({
  name = "preview",
  label = "Preview",
  description,
  className,
  urlField = "url",
  mimeTypeField = "mimeType",
  filenameField = "filename",
  altField = "alt",
}: AssetPreviewFieldProps) {
  const form = useFormContext();

  // Watch the relevant fields
  const url = useWatch({ control: form?.control, name: urlField }) as
    | string
    | undefined;
  const mimeType = useWatch({ control: form?.control, name: mimeTypeField }) as
    | string
    | undefined;
  const filename = useWatch({ control: form?.control, name: filenameField }) as
    | string
    | undefined;
  const alt = useWatch({ control: form?.control, name: altField }) as
    | string
    | undefined;

  // Build asset object for AssetThumbnail
  const asset = url
    ? {
        url,
        mimeType,
        filename,
        alt,
      }
    : null;

  // No URL means no preview available
  if (!asset) {
    return (
      <FieldWrapper name={name} label={label} description={description}>
        <div
          className={cn(
            "flex items-center justify-center rounded-lg border border-dashed p-8",
            "bg-muted/30 text-muted-foreground",
            className,
          )}
        >
          <p className="text-sm">No preview available</p>
        </div>
      </FieldWrapper>
    );
  }

  return (
    <FieldWrapper name={name} label={label} description={description}>
      <AssetThumbnail
        asset={asset}
        size="lg"
        showControls
        className={className}
      />
    </FieldWrapper>
  );
}
