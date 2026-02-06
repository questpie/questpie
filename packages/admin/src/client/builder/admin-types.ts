/**
 * Admin Builder Types
 *
 * Follows the same pattern as questpie/src/server/config/builder-types.ts
 * Everything is flat and extensible - no nested "module" wrapper.
 */

import type { SimpleMessages } from "../i18n/simple";
import type { BlockDefinition } from "./block/types";
import type { FieldDefinition } from "./field/field";
import type { PageDefinition } from "./page/page";
import type { MaybeLazyComponent } from "./types/common";
import type { LocaleConfig } from "./types/ui-config";
import type { DefaultViewsConfig } from "./types/views";
import type { EditViewDefinition, ListViewDefinition } from "./view/view";
import type { WidgetDefinition } from "./widget/widget";

// ============================================================================
// Translations Types
// ============================================================================

/**
 * Translations map - messages keyed by locale
 */
export type TranslationsMap = Record<string, SimpleMessages>;

// ============================================================================
// Map Types (like BuilderCollectionsMap in questpie)
// ============================================================================

export type FieldDefinitionMap = Record<string, FieldDefinition<string, any>>;
export type ListViewDefinitionMap = Record<
  string,
  ListViewDefinition<string, any>
>;
export type EditViewDefinitionMap = Record<
  string,
  EditViewDefinition<string, any>
>;
export type PageDefinitionMap = Record<string, PageDefinition<string>>;
export type WidgetDefinitionMap = Record<string, WidgetDefinition<string, any>>;
export type BlockDefinitionMap = Record<string, BlockDefinition>;
export type ComponentDefinitionMap = Record<string, MaybeLazyComponent<any>>;

export type EmptyMap = Record<never, never>;

// ============================================================================
// Admin Builder State
// ============================================================================

/**
 * Admin builder state - definition-time configuration (type-inferrable)
 *
 * FLAT structure - everything is top-level and mergeable, just like QuestpieBuilderState.
 * No "module" wrapper!
 *
 * TApp: Backend Questpie app type - provides collection/global names for autocomplete
 */
export interface AdminBuilderState<
  TApp = any,
  TFields extends FieldDefinitionMap = FieldDefinitionMap,
  TComponents extends ComponentDefinitionMap = ComponentDefinitionMap,
  TListViews extends ListViewDefinitionMap = ListViewDefinitionMap,
  TEditViews extends EditViewDefinitionMap = EditViewDefinitionMap,
  TPages extends PageDefinitionMap = PageDefinitionMap,
  TWidgets extends WidgetDefinitionMap = WidgetDefinitionMap,
  TBlocks extends BlockDefinitionMap = BlockDefinitionMap,
> {
  // Context for deep inference
  "~app": TApp;

  // Extensible definitions (like collections/globals/jobs in questpie)
  fields: TFields;
  components: TComponents;
  listViews: TListViews;
  editViews: TEditViews;
  pages: TPages;
  widgets: TWidgets;
  blocks: TBlocks;

  // App-level UI configs (last wins)
  locale: LocaleConfig;
  defaultViews: DefaultViewsConfig;

  // I18n translations
  translations: TranslationsMap;
}

/**
 * Empty builder state - starting point
 */
export interface EmptyBuilderState extends AdminBuilderState<any> {
  "~app": any;
  fields: EmptyMap;
  components: EmptyMap;
  listViews: EmptyMap;
  editViews: EmptyMap;
  pages: EmptyMap;
  widgets: EmptyMap;
  blocks: EmptyMap;
  defaultViews: DefaultViewsConfig;
  translations: Record<never, never>;
}

// ============================================================================
// Type Utils - State Extraction
// ============================================================================

/**
 * Extract backend app type from AdminBuilder
 */
export type ExtractBackendApp<TAdminBuilder> = TAdminBuilder extends {
  state: { "~app": infer TApp };
}
  ? TApp
  : never;

/**
 * Extract fields from AdminBuilder state
 */
export type ExtractFields<TAdminBuilder> = TAdminBuilder extends {
  state: { fields: infer TFields };
}
  ? TFields
  : {};

/**
 * Extract list views from AdminBuilder state
 */
export type ExtractListViews<TAdminBuilder> = TAdminBuilder extends {
  state: { listViews: infer TViews };
}
  ? TViews
  : {};

/**
 * Extract edit views from AdminBuilder state
 */
export type ExtractEditViews<TAdminBuilder> = TAdminBuilder extends {
  state: { editViews: infer TViews };
}
  ? TViews
  : {};

/**
 * Extract blocks from AdminBuilder state
 */
export type ExtractBlocks<TAdminBuilder> = TAdminBuilder extends {
  state: { blocks: infer TBlocks };
}
  ? TBlocks
  : {};

// ============================================================================
// Type Utils - View Kind Detection
// ============================================================================

/**
 * Get view kind from either Builder (state.kind) or Definition (kind)
 * Normalizes the two patterns into one
 */
export type GetViewKind<T> = T extends { state: { kind: infer K } }
  ? K
  : T extends { kind: infer K }
    ? K
    : never;

/**
 * Check if a view is a list view (works with both Builder and Definition)
 */
export type IsListView<T> = GetViewKind<T> extends "list" ? true : false;

/**
 * Check if a view is an edit view (works with both Builder and Definition)
 */
export type IsEditView<T> = GetViewKind<T> extends "edit" ? true : false;

/**
 * Filter record to only list views
 */
export type FilterListViews<T extends Record<string, any>> = {
  [K in keyof T as IsListView<T[K]> extends true ? K : never]: T[K];
};

/**
 * Filter record to only edit views
 */
export type FilterEditViews<T extends Record<string, any>> = {
  [K in keyof T as IsEditView<T[K]> extends true ? K : never]: T[K];
};
