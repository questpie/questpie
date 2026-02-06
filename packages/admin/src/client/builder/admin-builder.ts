/**
 * Admin Builder
 *
 * Main builder class - same pattern as QuestpieBuilder.
 * Single generic TState pattern.
 */

import {
  DEFAULT_LOCALE_CONFIG,
  type Prettify,
  type SetProperty,
  type TypeMerge,
  type UnsetProperty,
} from "questpie/shared";
import type { SimpleMessages } from "../i18n/simple";
import type {
  AdminBuilderState,
  FilterEditViews,
  FilterListViews,
  TranslationsMap,
} from "./admin-types";
import type { BlockBuilder } from "./block/block-builder";
import { block } from "./block/block-builder";
import { collection } from "./collection/collection";
import type { CollectionBuilder } from "./collection/collection-builder";
import { global } from "./global/global";
import type { GlobalBuilder } from "./global/global-builder";
import { type PageBuilder, page } from "./page/page";
import type { MaybeLazyComponent } from "./types/common";
import type { DefaultViewsConfig } from "./types/views";
import { type WidgetBuilder, widget } from "./widget/widget";

// ============================================================================
// Translations Helpers
// ============================================================================

/**
 * Merge two translations maps
 */
function mergeTranslations(
  base: TranslationsMap | undefined,
  override: TranslationsMap | undefined,
): TranslationsMap {
  if (!base && !override) return {};
  if (!base) return override ?? {};
  if (!override) return base;

  const result: TranslationsMap = { ...base };

  for (const [locale, messages] of Object.entries(override)) {
    result[locale] = {
      ...(result[locale] ?? {}),
      ...messages,
    };
  }

  return result;
}

export class AdminBuilder<TState extends AdminBuilderState> {
  constructor(public readonly state: TState) {}

  static empty<TApp = any>(): AdminBuilder<{
    "~app": TApp;
    fields: {};
    components: {};
    listViews: {};
    editViews: {};
    pages: {};
    widgets: {};
    blocks: {};
    locale: { default: string; supported: string[] };
    defaultViews: {};
    translations: {};
  }> {
    return new AdminBuilder({
      "~app": undefined as TApp,
      fields: {},
      components: {},
      listViews: {},
      editViews: {},
      pages: {},
      widgets: {},
      blocks: {},
      locale: DEFAULT_LOCALE_CONFIG,
      defaultViews: {},
      translations: {},
    });
  }

  /**
   * Register field definitions
   */
  fields<TNewFields extends Record<string, any>>(
    fields: TNewFields,
  ): AdminBuilder<
    SetProperty<
      TState,
      "fields",
      Prettify<TypeMerge<TState["fields"], TNewFields>>
    >
  > {
    return new AdminBuilder({
      ...this.state,
      fields: {
        ...this.state.fields,
        ...fields,
      },
    } as any);
  }

  /**
   * Register component implementations
   */
  components<TNewComponents extends Record<string, any>>(
    components: TNewComponents,
  ): AdminBuilder<
    SetProperty<
      TState,
      "components",
      Prettify<TypeMerge<TState["components"], TNewComponents>>
    >
  > {
    return new AdminBuilder({
      ...this.state,
      components: {
        ...this.state.components,
        ...components,
      },
    } as any);
  }

  /**
   * Register view definitions (auto-sorted by kind)
   */
  views<TNewViews extends Record<string, any>>(
    views: TNewViews,
  ): AdminBuilder<
    Prettify<
      TypeMerge<
        UnsetProperty<TState, "listViews" | "editViews">,
        {
          listViews: Prettify<
            TypeMerge<TState["listViews"], FilterListViews<TNewViews>>
          >;
          editViews: Prettify<
            TypeMerge<TState["editViews"], FilterEditViews<TNewViews>>
          >;
        }
      >
    >
  > {
    const listViews: Record<string, any> = {};
    const editViews: Record<string, any> = {};

    for (const [name, def] of Object.entries(views)) {
      // ViewBuilders now implement Definition interface, so kind is directly accessible
      const kind = (def as any).kind;
      if (kind === "list") {
        listViews[name] = def;
      } else if (kind === "edit") {
        editViews[name] = def;
      }
    }

    return new AdminBuilder({
      ...this.state,
      listViews: { ...this.state.listViews, ...listViews },
      editViews: { ...this.state.editViews, ...editViews },
    } as any);
  }

  /**
   * Register widget definitions
   */
  widgets<TNewWidgets extends Record<string, any>>(
    widgets: TNewWidgets,
  ): AdminBuilder<
    SetProperty<
      TState,
      "widgets",
      Prettify<TypeMerge<TState["widgets"], TNewWidgets>>
    >
  > {
    return new AdminBuilder({
      ...this.state,
      widgets: {
        ...this.state.widgets,
        ...widgets,
      },
    } as any);
  }

  /**
   * Register page definitions
   */
  pages<TNewPages extends Record<string, any>>(
    pages: TNewPages,
  ): AdminBuilder<
    SetProperty<
      TState,
      "pages",
      Prettify<TypeMerge<TState["pages"], TNewPages>>
    >
  > {
    return new AdminBuilder({
      ...this.state,
      pages: {
        ...this.state.pages,
        ...pages,
      },
    } as any);
  }

  /**
   * Register block definitions for the visual page builder.
   *
   * Blocks are UI-only concepts - the server stores them as JSONB with $i18n markers.
   * Each block has a name, fields, and a renderer component.
   *
   * @example
   * ```ts
   * const builder = qa<AppCMS>().use(adminModule);
   * const heroBlock = builder.block("hero")
   *   .label({ en: "Hero Section" })
   *   .icon("Image")
   *   .category("sections")
   *   .fields(({ r }) => ({
   *     title: r.text({ label: "Title", localized: true }),
   *   }))
   *   .renderer(HeroRenderer)
   *   .build();
   *
   * const admin = builder
   *   .blocks({ hero: heroBlock })
   *   .sidebar({ ... });
   * ```
   */
  blocks<TNewBlocks extends Record<string, any>>(
    blocks: TNewBlocks,
  ): AdminBuilder<
    SetProperty<
      TState,
      "blocks",
      Prettify<TypeMerge<TState["blocks"], TNewBlocks>>
    >
  > {
    return new AdminBuilder({
      ...this.state,
      blocks: {
        ...this.state.blocks,
        ...blocks,
      },
    } as any);
  }

  /**
   * Register translations for i18n
   *
   * Merges new translations with existing translations from modules.
   *
   * @example
   * ```ts
   * // Add translations for multiple locales
   * .translations({
   *   en: { "myModule.label": "My Label" },
   *   sk: { "myModule.label": "Moj Label" },
   * })
   * ```
   */
  translations<TNewTranslations extends TranslationsMap>(
    translations: TNewTranslations,
  ): AdminBuilder<
    SetProperty<
      TState,
      "translations",
      Prettify<TypeMerge<TState["translations"], TNewTranslations>>
    >
  > {
    return new AdminBuilder({
      ...this.state,
      translations: mergeTranslations(
        this.state.translations as TranslationsMap,
        translations,
      ),
    } as any);
  }

  /**
   * Add translated messages for admin UI (simple API)
   *
   * Messages are merged with default admin messages.
   * Custom messages override defaults with same key.
   * This is an alias for .translations() with simpler naming.
   *
   * @example
   * ```ts
   * const customMessages = {
   *   en: {
   *     "myApp.welcome": "Welcome to Barbershop Admin",
   *     "myApp.bookNow": "Book Now",
   *   },
   *   sk: {
   *     "myApp.welcome": "Vitajte v Barbershop Admin",
   *     "myApp.bookNow": "Rezervovať",
   *     // Override default admin message
   *     "common.save": "Uložiť",
   *   },
   * } as const;
   *
   * const admin = qa<AppCMS>()
   *   .use(coreAdminModule)
   *   .messages(customMessages)
   *   .sidebar({ ... });
   *
   * // In components, t() has full autocomplete
   * ```
   */
  messages<TNewMessages extends TranslationsMap>(
    messages: TNewMessages,
  ): AdminBuilder<
    SetProperty<
      TState,
      "translations",
      Prettify<TypeMerge<TState["translations"], TNewMessages>>
    >
  > {
    return this.translations(messages);
  }

  /**
   * Compose another builder (merge modules)
   */
  use<TOther extends AdminBuilder<any>>(
    other: TOther,
  ): AdminBuilder<
    Prettify<
      TypeMerge<
        UnsetProperty<
          TState,
          | "fields"
          | "listViews"
          | "editViews"
          | "widgets"
          | "pages"
          | "blocks"
          | "translations"
        >,
        {
          fields: Prettify<
            TypeMerge<TState["fields"], TOther["state"]["fields"]>
          >;
          listViews: Prettify<
            TypeMerge<TState["listViews"], TOther["state"]["listViews"]>
          >;
          editViews: Prettify<
            TypeMerge<TState["editViews"], TOther["state"]["editViews"]>
          >;
          widgets: Prettify<
            TypeMerge<TState["widgets"], TOther["state"]["widgets"]>
          >;
          pages: Prettify<TypeMerge<TState["pages"], TOther["state"]["pages"]>>;
          blocks: Prettify<
            TypeMerge<TState["blocks"], TOther["state"]["blocks"]>
          >;
          translations: Prettify<
            TypeMerge<TState["translations"], TOther["state"]["translations"]>
          >;
        }
      >
    >
  > {
    const otherState = (other as any).state;

    return new AdminBuilder({
      ...this.state,
      fields: { ...this.state.fields, ...otherState.fields },
      listViews: { ...this.state.listViews, ...otherState.listViews },
      editViews: { ...this.state.editViews, ...otherState.editViews },
      widgets: { ...this.state.widgets, ...otherState.widgets },
      pages: { ...this.state.pages, ...otherState.pages },
      blocks: { ...this.state.blocks, ...otherState.blocks },
      translations: mergeTranslations(
        this.state.translations as TranslationsMap,
        otherState.translations,
      ),
    } as any);
  }

  /**
   * Set locale config
   */
  locale(config: any): AdminBuilder<TState> {
    return new AdminBuilder({
      ...this.state,
      locale: { ...this.state.locale, ...config },
    } as any);
  }

  /**
   * Set default views config
   */
  defaultViews<TDefaultViews extends DefaultViewsConfig>(
    config: TDefaultViews,
  ): AdminBuilder<
    SetProperty<
      TState,
      "defaultViews",
      Prettify<TypeMerge<TState["defaultViews"], TDefaultViews>>
    >
  > {
    return new AdminBuilder({
      ...this.state,
      defaultViews: {
        ...(this.state.defaultViews || {}),
        ...config,
      },
    } as any);
  }

  // ============================================================================
  // Entity Creation Methods
  // ============================================================================

  /**
   * Create a collection builder bound to this admin
   *
   * Creates a CollectionBuilder with full access to registered fields,
   * views, and backend type inference.
   *
   * @example
   * ```ts
   * const builder = qa<AppCMS>().use(adminModule);
   *
   * const barbers = builder.collection("barbers")
   *   .fields(({ r }) => ({
   *     name: r.text(),  // ✅ autocomplete from module fields
   *   }))
   * ```
   */
  collection<TName extends string, TSelf extends AdminBuilder<TState>>(
    this: TSelf,
    name: TName,
  ): CollectionBuilder<{
    name: TName;
    "~adminApp": TSelf;
  }> {
    return collection(name).use(this) as any;
  }

  /**
   * Create a block builder bound to this admin
   *
   * This gives block field definitions access to the admin field registry
   * defined by the builder chain.
   *
   * @example
   * ```ts
   * const builder = qa<AppCMS>().use(adminModule);
   *
   * const heroBlock = builder.block("hero")
   *   .fields(({ r }) => ({
   *     title: r.text({ label: "Title" }),
   *   }))
   *   .renderer(HeroRenderer)
   *   .build();
   * ```
   */
  block<TName extends string, TSelf extends AdminBuilder<TState>>(
    this: TSelf,
    name: TName,
  ): BlockBuilder<{
    name: TName;
    "~adminApp": TSelf;
  }> {
    return block(name).use(this) as any;
  }

  /**
   * Create a global builder bound to this admin
   *
   * Creates a GlobalBuilder with full access to registered fields,
   * views, and backend type inference.
   *
   * @example
   * ```ts
   * const builder = qa<AppCMS>().use(adminModule);
   *
   * const settings = builder.global("settings")
   *   .fields(({ r }) => ({
   *     siteName: r.text(),  // ✅ autocomplete from module fields
   *   }))
   * ```
   */
  global<TName extends string, TSelf extends AdminBuilder<TState>>(
    this: TSelf,
    name: TName,
  ): GlobalBuilder<{
    name: TName;
    "~adminApp": TSelf;
  }> {
    return global(name).use(this) as any;
  }

  /**
   * Create a page definition
   *
   * Creates a custom admin page outside of collections/globals.
   *
   * @example
   * ```ts
   * const builder = qa<AppCMS>().use(adminModule);
   *
   * const analyticsPage = builder.page("analytics", {
   *   component: AnalyticsPage,
   * })
   * ```
   */
  page<TName extends string, TComponent extends MaybeLazyComponent>(
    name: TName,
    config: { component: TComponent },
  ): PageBuilder<{
    name: TName;
    component: TComponent;
    path: undefined;
  }> {
    return page(name, config);
  }

  /**
   * Create a widget definition
   *
   * Creates a dashboard widget.
   *
   * @example
   * ```ts
   * const builder = qa<AppCMS>().use(adminModule);
   *
   * const statsWidget = builder.widget("stats", {
   *   component: StatsWidget,
   * })
   * ```
   */
  widget<TName extends string, TComponent extends MaybeLazyComponent>(
    name: TName,
    config: { component: TComponent },
  ): WidgetBuilder<{
    name: TName;
    "~config": any;
    component: TComponent;
  }> {
    return widget(name, config);
  }
}
