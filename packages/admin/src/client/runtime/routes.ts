/**
 * Type-Safe Route Builder
 *
 * Generates type-safe route helpers from admin configuration
 */

import type { Questpie } from "questpie";
import type { ComponentReference } from "#questpie/admin/server";
import type { CollectionNames, GlobalNames, IconComponent } from "../builder";
import type { Admin } from "../builder/admin";
import { isComponentReference } from "../components/component-renderer";
import type { I18nText } from "../i18n/types";
import { formatLabel } from "../lib/utils";

// ============================================================================
// Route Types
// ============================================================================

/**
 * Collection route helpers
 */
export type CollectionRoutes<TName extends string> = {
  list: () => string;
  create: () => string;
  edit: (id: string) => string;
  view: (id: string) => string;
};

/**
 * Global route helpers
 */
export type GlobalRoutes = {
  edit: () => string;
};

/**
 * Page route helpers
 */
export type PageRoutes = {
  view: () => string;
};

/**
 * All routes for an admin instance
 */
export type AdminRoutes<TApp extends Questpie<any>> = {
  dashboard: () => string;
  collections: {
    [K in CollectionNames<TApp> & string]: CollectionRoutes<K>;
  };
  globals: {
    [K in GlobalNames<TApp> & string]: GlobalRoutes;
  };
  pages: Record<string, PageRoutes>;
  auth: {
    login: () => string;
    logout: () => string;
    forgotPassword: () => string;
    resetPassword: (token: string) => string;
  };
};

// ============================================================================
// Route Builder
// ============================================================================

/**
 * Options for building routes
 */
export type BuildRoutesOptions = {
  /**
   * Base path for admin routes (default: "/admin")
   */
  basePath?: string;
};

/**
 * Build type-safe routes from admin configuration
 *
 * @example
 * ```ts
 * import { buildRoutes } from "@questpie/admin/runtime";
 * import { appAdmin } from "./admin";
 *
 * const routes = buildRoutes(appAdmin);
 *
 * // Type-safe route generation
 * routes.dashboard(); // "/admin"
 * routes.collections.posts.list(); // "/admin/collections/posts"
 * routes.collections.posts.edit("123"); // "/admin/collections/posts/123/edit"
 * routes.globals.settings.edit(); // "/admin/globals/settings"
 * ```
 */
export function buildRoutes<TApp extends Questpie<any>>(
  admin: Admin,
  options: BuildRoutesOptions = {},
): AdminRoutes<TApp> {
  const { basePath = "/admin" } = options;

  // Helper to build path
  const path = (...segments: string[]) =>
    [basePath, ...segments].filter(Boolean).join("/");

  // Collection/global routes are now driven by server config.
  // buildRoutes returns empty collections/globals; the sidebar uses server navigation.
  const collections = {} as AdminRoutes<TApp>["collections"];
  const globals = {} as AdminRoutes<TApp>["globals"];

  // Build page routes (pages are still client-side)
  const pageConfigs = admin.getPages();
  const pages: Record<string, PageRoutes> = {};

  for (const [name, config] of Object.entries(pageConfigs)) {
    const pagePath = (config as any).path ?? name;
    pages[name] = {
      view: () =>
        pagePath.startsWith("/") ? pagePath : path("pages", pagePath),
    };
  }

  return {
    dashboard: () => basePath,
    collections,
    globals,
    pages,
    auth: {
      login: () => path("auth", "login"),
      logout: () => path("auth", "logout"),
      forgotPassword: () => path("auth", "forgot-password"),
      resetPassword: (token: string) => path("auth", "reset-password", token),
    },
  };
}

// ============================================================================
// Navigation Builder
// ============================================================================

/**
 * Navigation item (clickable link)
 */
export type NavigationItem = {
  id: string;
  label: I18nText;
  href: string;
  /** Icon - can be a React component or a server-defined ComponentReference */
  icon?: IconComponent | ComponentReference;
  group?: string;
  order?: number;
  type: "collection" | "global" | "page" | "dashboard" | "link";
};

/**
 * Navigation divider (visual separator)
 */
export type NavigationDivider = {
  type: "divider";
};

/**
 * Any navigation element (item or divider)
 */
export type NavigationElement = NavigationItem | NavigationDivider;

/**
 * Navigation group/section
 */
export type NavigationGroup = {
  id?: string;
  label?: I18nText;
  /** Icon - can be a React component or a server-defined ComponentReference */
  icon?: IconComponent | ComponentReference;
  collapsed?: boolean;
  items: NavigationElement[];
};

/**
 * Build navigation structure from admin configuration
 *
 * @example
 * ```ts
 * import { buildNavigation } from "@questpie/admin/runtime";
 * import { appAdmin } from "./admin";
 *
 * const navigation = buildNavigation(appAdmin);
 * // Returns grouped navigation items for sidebar rendering
 * ```
 */
export function buildNavigation<TApp extends Questpie<any>>(
  admin: Admin,
  options: BuildRoutesOptions = {},
): NavigationGroup[] {
  const routes = buildRoutes(admin, options);
  const items: NavigationItem[] = [];

  // Add dashboard
  items.push({
    id: "dashboard",
    label: "Dashboard",
    href: routes.dashboard(),
    icon: undefined,
    type: "dashboard",
    order: -1000,
  });

  // Collection/global navigation is now driven by server config (useServerNavigation).
  // Only pages are added here as they're client-only.

  // Add pages
  for (const [name, config] of Object.entries(admin.getPages())) {
    if ((config as any).showInNav === false) continue;

    items.push({
      id: `page:${name}`,
      label: resolveLabel((config as any).label, name),
      href: routes.pages[name].view(),
      icon: resolveIcon((config as any).icon),
      group: (config as any).group,
      order: (config as any).order ?? 0,
      type: "page",
    });
  }

  // Return ungrouped items (server sidebar handles grouping)
  return items.length > 0 ? [{ items }] : [];
}

/**
 * Resolve label - passes through I18nText for runtime resolution
 */
function resolveLabel(label: unknown, fallback: string): I18nText {
  // Plain string
  if (typeof label === "string") return label;

  // I18nText object (locale map or translation key) - pass through for runtime resolution
  if (typeof label === "object" && label !== null) {
    return label as I18nText;
  }

  // Capitalize and format fallback
  return formatLabel(fallback);
}

/**
 * Resolve icon to IconComponent or ComponentReference.
 * Handles:
 * - React components (IconComponent)
 * - Server-defined component references ({ type: "icon", props: { name: "..." } })
 * - undefined/null
 */
function resolveIcon(
  icon: unknown,
): IconComponent | ComponentReference | undefined {
  if (!icon) {
    return undefined;
  }

  // Handle ComponentReference from server (e.g., { type: "icon", props: { name: "ph:users" } })
  if (isComponentReference(icon)) {
    return icon;
  }

  // Handle React component
  if (typeof icon === "function") {
    return icon as IconComponent;
  }

  // Handle object that might be a React component (e.g., forwardRef result)
  if (typeof icon === "object" && icon !== null && "$$typeof" in icon) {
    return icon as IconComponent;
  }

  return undefined;
}
