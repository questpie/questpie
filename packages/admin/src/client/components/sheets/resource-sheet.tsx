/**
 * ResourceSheet Component
 *
 * Universal sheet component for viewing/editing collections and globals.
 * Uses FormView/GlobalFormView internally for consistent UI and behavior.
 * Container queries provide automatic responsive layout.
 *
 * @example
 * ```tsx
 * // Collection usage
 * <ResourceSheet
 *   type="collection"
 *   collection="posts"
 *   itemId="123"
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   onSave={(data) => console.log('Saved:', data)}
 * />
 *
 * // Global usage
 * <ResourceSheet
 *   type="global"
 *   global="siteSettings"
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   onSave={(data) => console.log('Saved:', data)}
 * />
 * ```
 */

import * as React from "react";
import {
  LocaleScopeProvider,
  selectBasePath,
  selectNavigate,
  useAdminStore,
} from "../../runtime";
import FormView from "../../views/collection/form-view";
import GlobalFormView from "../../views/globals/global-form-view";
import { Sheet, SheetContent } from "../ui/sheet";

// ============================================================================
// Types
// ============================================================================

/**
 * Base props shared between collection and global sheets
 */
interface ResourceSheetBaseProps {
  /**
   * Is sheet open
   */
  open: boolean;

  /**
   * Callback when sheet open state changes
   */
  onOpenChange: (open: boolean) => void;

  /**
   * Callback after successful save
   * Receives the saved data
   */
  onSave?: (data: any) => void;

  /**
   * Side of the screen where sheet appears
   * @default "right"
   */
  side?: "top" | "right" | "bottom" | "left";
}

/**
 * Props for collection resource type
 */
interface CollectionSheetProps extends ResourceSheetBaseProps {
  type: "collection";

  /**
   * Collection name
   */
  collection: string;

  /**
   * Item ID (undefined for create, string for edit)
   */
  itemId?: string;

  /**
   * Default values for create mode (prefill)
   * Useful for pre-populating relation fields when creating from a parent context
   */
  defaultValues?: Record<string, any>;
}

/**
 * Props for global resource type
 */
interface GlobalSheetProps extends ResourceSheetBaseProps {
  type: "global";

  /**
   * Global name
   */
  global: string;
}

/**
 * Discriminated union of all resource sheet props
 */
export type ResourceSheetProps = CollectionSheetProps | GlobalSheetProps;

// ============================================================================
// Component
// ============================================================================

export function ResourceSheet(props: ResourceSheetProps) {
  const { open, onOpenChange, onSave, side = "right" } = props;
  const navigate = useAdminStore(selectNavigate);
  const basePath = useAdminStore(selectBasePath);

  const handleSuccess = React.useCallback(
    (data: any) => {
      onSave?.(data);
      onOpenChange(false);
    },
    [onSave, onOpenChange],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={side} className="overflow-y-auto p-6 pt-12">
        {/* LocaleScopeProvider isolates locale changes in nested forms */}
        <LocaleScopeProvider>
          {props.type === "collection" ? (
            <FormView
              collection={props.collection}
              id={props.itemId}
              defaultValues={props.defaultValues}
              config={undefined}
              allCollectionsConfig={undefined}
              navigate={navigate}
              basePath={basePath}
              onSuccess={handleSuccess}
              showMeta={false}
            />
          ) : (
            <GlobalFormView
              global={props.global}
              config={undefined}
              allGlobalsConfig={undefined}
              navigate={navigate}
              basePath={basePath}
              onSuccess={handleSuccess}
              showMeta={false}
            />
          )}
        </LocaleScopeProvider>
      </SheetContent>
    </Sheet>
  );
}
