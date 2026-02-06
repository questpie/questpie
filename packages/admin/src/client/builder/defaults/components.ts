/**
 * Built-in Component Registry
 *
 * Default component implementations used by the admin UI.
 * Registered through AdminBuilder.components() so nothing is hardcoded.
 */

import { Badge, IconifyIcon } from "../../components/component-renderer";

/**
 * Built-in components registry
 */
export const builtInComponents = {
  icon: IconifyIcon,
  badge: Badge,
} as const;
