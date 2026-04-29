/**
 * Admin State Types
 *
 * Follows the same pattern as questpie/src/server/config/builder-types.ts
 * Everything is flat and extensible — no nested "module" wrapper.
 */

import type { SimpleMessages } from "../i18n/simple";
import type { FieldDefinition } from "./field/field";
import type { PageDefinition } from "./page/page";
import type { MaybeLazyComponent } from "./types/common";
import type { LocaleConfig } from "./types/ui-config";
import type { ViewDefinition } from "./view/view";
import type { WidgetDefinition } from "./widget/widget";

// ============================================================================
// Translations Types
// ============================================================================

/**
 * Translations map: locale -> key -> message
 */
export type TranslationsMap = Record<string, SimpleMessages>;

// ============================================================================
// Map Types
// ============================================================================

export type FieldDefinitionMap = Record<string, FieldDefinition>;
export type ViewDefinitionMap = Record<string, ViewDefinition>;
export type PageDefinitionMap = Record<string, PageDefinition>;
export type WidgetDefinitionMap = Record<string, WidgetDefinition>;
export type ComponentDefinitionMap = Record<string, MaybeLazyComponent<any>>;
export type BlockDefinitionMap = Record<string, never>;

// ============================================================================
// Admin State
// ============================================================================

/**
 * Admin state — flat map of all admin registrations.
 *
 * Pure data: maps names to components. All config flows from server introspection.
 *
 * TApp: Backend Questpie app type — provides collection/global names for autocomplete
 */
export interface AdminState<
	TApp = any,
	TFields extends FieldDefinitionMap = FieldDefinitionMap,
	TComponents extends ComponentDefinitionMap = ComponentDefinitionMap,
	TViews extends ViewDefinitionMap = ViewDefinitionMap,
	TPages extends PageDefinitionMap = PageDefinitionMap,
	TWidgets extends WidgetDefinitionMap = WidgetDefinitionMap,
	TBlocks extends BlockDefinitionMap = BlockDefinitionMap,
	TTranslations extends TranslationsMap = TranslationsMap,
> {
	"~app": TApp;
	fields: TFields;
	components: TComponents;
	views: TViews;
	pages: TPages;
	widgets: TWidgets;
	blocks: TBlocks;
	translations: TTranslations;
	locale: LocaleConfig;
}

// ============================================================================
// Type Utils — View Kind Detection
// ============================================================================

type GetViewKind<T> = T extends { kind: infer K } ? K : never;

export type IsListView<T> = GetViewKind<T> extends "list" ? true : false;
export type IsFormView<T> = GetViewKind<T> extends "form" ? true : false;

export type FilterListViews<T extends Record<string, any>> = {
	[K in keyof T as IsListView<T[K]> extends true ? K : never]: T[K];
};

export type FilterFormViews<T extends Record<string, any>> = {
	[K in keyof T as IsFormView<T[K]> extends true ? K : never]: T[K];
};
