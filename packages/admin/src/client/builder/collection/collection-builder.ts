/**
 * Collection Builder
 *
 * For configuring UI for a backend collection.
 * Single generic TState pattern with ~adminApp for type safety.
 */

import type { SetProperty } from "questpie/shared";
import type { ComponentReference } from "#questpie/admin/server";
import type { I18nText } from "../../i18n/types.js";
import type { AdminBuilder } from "../admin-builder";
import type { IconComponent } from "../types/common";
import type {
  AutoSaveConfig,
  CollectionBuilderState,
  PreviewConfig,
} from "../types/collection-types";

export class CollectionBuilder<TState extends CollectionBuilderState> {
  constructor(public readonly state: TState) {}

  /**
   * Merge admin module into state for type-safe field/view access
   */
  use<TAdminApp extends AdminBuilder<any>>(
    adminApp: TAdminApp,
  ): CollectionBuilder<SetProperty<TState, "~adminApp", TAdminApp>> {
    return new CollectionBuilder({
      ...this.state,
      "~adminApp": adminApp,
    } as any);
  }

  /**
   * Set collection metadata
   */
  meta(meta: {
    label?: I18nText;
    icon?: IconComponent | ComponentReference;
    description?: I18nText;
  }): CollectionBuilder<TState> {
    return new CollectionBuilder({
      ...this.state,
      ...meta,
    } as any);
  }

  /**
   * Configure live preview for this collection
   *
   * @param config - Preview configuration with URL builder and options
   * @returns CollectionBuilder with preview config
   *
   * @example
   * ```ts
   * .preview({
   *   url: (values, locale) => `/${locale}/pages/${values.slug}?preview=true`,
   *   enabled: true,
   *   position: "right",
   *   defaultWidth: 50,
   * })
   * ```
   */
  preview(
    config: PreviewConfig,
  ): CollectionBuilder<SetProperty<TState, "preview", PreviewConfig>> {
    return new CollectionBuilder({
      ...this.state,
      preview: config,
    } as any);
  }

  /**
   * Configure autosave behavior for this collection
   *
   * Enables automatic saving of form changes after a debounce delay.
   *
   * @param config - Autosave configuration with debounce, indicator, and navigation prevention options
   * @returns CollectionBuilder with autosave config
   *
   * @example
   * ```ts
   * .autoSave({
   *   enabled: true,
   *   debounce: 500,          // 0.5s delay before save
   *   indicator: true,        // Show "Saving..." badge
   *   preventNavigation: true // Warn before navigating away
   * })
   * ```
   */
  autoSave(
    config: AutoSaveConfig,
  ): CollectionBuilder<SetProperty<TState, "autoSave", AutoSaveConfig>> {
    return new CollectionBuilder({
      ...this.state,
      autoSave: config,
    } as any);
  }
}
