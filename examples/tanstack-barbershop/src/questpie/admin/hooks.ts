/**
 * Typed Admin Hooks
 *
 * Type-safe hooks for collections and globals using the factory pattern.
 * This approach provides autocomplete for collection/global names without
 * requiring module augmentation.
 *
 * @example
 * ```tsx
 * import { useCollectionList, useGlobal } from './hooks';
 *
 * // Collection names are autocompleted!
 * const { data } = useCollectionList("barbers");
 * const { data: settings } = useGlobal("siteSettings");
 * ```
 */

import { createTypedHooks } from "@questpie/admin/client";
import type { AppCMS } from "../server/cms";

// Create typed hooks for this app's CMS
export const {
  useCollectionList,
  useCollectionCount,
  useCollectionItem,
  useCollectionCreate,
  useCollectionUpdate,
  useCollectionDelete,
  useGlobal,
  useGlobalUpdate,
} = createTypedHooks<AppCMS>();
