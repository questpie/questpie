/**
 * Filter Builder Types
 *
 * Client-side types for the filter builder UI.
 * Imports shared types that are safe for both server and client.
 */

import type { ViewConfiguration } from "../../../shared/types/saved-views.types.js";

// Re-export shared types for client usage
export type {
  FilterOperator,
  FilterRule,
  FilterValue,
  SortConfig,
  ViewConfiguration,
} from "../../../shared/types/saved-views.types.js";

/**
 * Saved view entity from the database
 */
export interface SavedView {
  id: string;
  userId: string;
  collectionName: string;
  name: string;
  configuration: ViewConfiguration;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Available field information for the filter builder
 */
export interface AvailableField {
  name: string;
  label: string;
  type: string;
  isSystem?: boolean;
  options?: Record<string, any>;
}

/**
 * Filter builder sheet props
 */
export interface FilterBuilderProps {
  /** Collection name */
  collection: string;

  /** Available fields for filtering/column selection */
  availableFields: AvailableField[];

  /** Current view configuration */
  currentConfig: ViewConfiguration;

  /** Callback when configuration changes */
  onConfigChange: (config: ViewConfiguration) => void;

  /** Whether the sheet is open */
  isOpen: boolean;

  /** Callback when open state changes */
  onOpenChange: (open: boolean) => void;
}
