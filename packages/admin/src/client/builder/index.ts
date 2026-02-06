/**
 * Admin Builder - Main Export
 */

import type { CollectionInfer, Questpie } from "questpie";
import type { QuestpieClient } from "questpie/client";

export {
  Admin,
  type AdminInput,
  type AppAdmin,
  type InferAdminCMS,
} from "./admin";
export { AdminBuilder } from "./admin-builder";
export type { AdminBuilderState } from "./admin-types";
export {
  type ActionRegistryProxy,
  createActionRegistryProxy,
  getDefaultActionsConfig,
  getDefaultBulkActions,
  getDefaultFormActions,
  getDefaultHeaderActions,
} from "./types/action-registry";
// Action types and registry
export type {
  ActionContext,
  ActionDefinition,
  ActionDialogProps,
  ActionFormConfig,
  ActionHandler,
  ActionHelpers,
  ActionsConfig,
  ActionVariant,
  ApiHandler,
  ConfirmationConfig,
  CustomHandler,
  DialogHandler,
  FormHandler,
  HeaderActionsConfig,
  NavigateHandler,
} from "./types/action-types";
export { collection } from "./collection/collection";
export { CollectionBuilder } from "./collection/collection-builder";
export type { AutoSaveConfig, PreviewConfig } from "./types/collection-types";
export type {
  CollectionBuilderState,
  CollectionConfig,
  ColumnConfig,
  ColumnConfigObject,
  ListViewConfig,
} from "./types/collection-types";
export {
  getColumnFieldName,
  normalizeColumnConfig,
} from "./types/collection-types";
export type {
  CreateZodFn,
  FieldBuilderState,
  FieldDefinition,
  FieldHookOptions,
  FieldStateOptions,
  FieldUIOptions,
  ZodBuildContext,
} from "./field/field";
export { FieldBuilder, field } from "./field/field";
export { global } from "./global/global";
export { GlobalBuilder } from "./global/global-builder";
export type { GlobalBuilderState, GlobalConfig } from "./types/global-types";
export type { PageBuilderState, PageDefinition } from "./page/page";
export { PageBuilder, page } from "./page/page";
export { qa } from "./qa";
export type {
  EditViewBuilderState,
  EditViewDefinition,
  ListViewBuilderState,
  ListViewDefinition,
} from "./view/view";
export {
  EditViewBuilder,
  editView,
  ListViewBuilder,
  listView,
} from "./view/view";
export type { WidgetBuilderState, WidgetDefinition } from "./widget/widget";
export { WidgetBuilder, widget } from "./widget/widget";

// ============================================================================
// Common Types
// ============================================================================

export type {
  BaseFieldProps,
  IconComponent,
  MaybeLazyComponent,
} from "./types/common";

// ============================================================================
// Field Types
// ============================================================================

export type {
  ArrayFieldConfig,
  ComponentRegistry,
  EmbeddedCollectionProps,
  EmbeddedFieldConfig,
  FieldComponentProps,
  FieldHookContext,
  FieldLayoutItem,
  FieldUIConfig,
  FieldValidationConfig,
  FormSidebarConfig,
  FormViewConfig,
  LayoutMode,
  RelationFieldConfig,
  RichTextConfig,
  SectionLayout,
  SelectOption,
  TabConfig,
  TabsLayout,
  WrapperMode,
} from "./types/field-types";

// ============================================================================
// Validation
// ============================================================================

export {
  buildValidationSchema,
  buildValidationSchemaWithCustom,
  createFormSchema,
  createRegistryProxy,
} from "./validation";

// ============================================================================
// Widget Types
// ============================================================================

export type {
  AnyWidgetConfig,
  BaseWidgetConfig,
  ChartWidgetConfig,
  CustomWidgetConfig,
  DashboardWidgetConfig,
  GenericWidgetConfig,
  KnownWidgetType,
  ProgressWidgetConfig,
  QuickActionItem,
  QuickActionsWidgetConfig,
  RecentItemsWidgetConfig,
  StatsWidgetConfig,
  TableWidgetColumn,
  TableWidgetColumnConfig,
  TableWidgetConfig,
  TimelineItem,
  TimelineWidgetConfig,
  ValueWidgetClassNames,
  ValueWidgetConfig,
  ValueWidgetResult,
  ValueWidgetTrend,
  WidgetAction,
  WidgetCardVariant,
  WidgetComponentProps,
  WidgetConfig,
  WidgetDataSource,
} from "./types/widget-types";

// ============================================================================
// UI Config Types
// ============================================================================

export type {
  BrandingConfig,
  DashboardAction,
  DashboardConfig,
  DashboardLayoutItem,
  DashboardSection,
  DashboardTabConfig,
  DashboardTabs,
  LocaleConfig,
  SidebarCollectionItem,
  SidebarConfig,
  SidebarDividerItem,
  SidebarGlobalItem,
  SidebarItem,
  SidebarLinkItem,
  SidebarPageItem,
  SidebarSection,
} from "./types/ui-config";

export type { DefaultViewsConfig } from "./types/views";

// ============================================================================
// I18n Types
// ============================================================================

export type { I18nContext, I18nText } from "../i18n/types";

// ============================================================================
// Module Augmentation Registry
// ============================================================================

export type {
  AdminTypeRegistry,
  IsRegistered,
  RegisteredAdmin,
  RegisteredCMS,
  RegisteredCollectionNames,
  RegisteredGlobalNames,
} from "./registry";

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Extract collection names from backend Questpie app
 */
export type CollectionNames<TApp extends Questpie<any>> =
  keyof TApp["config"]["collections"] & string;
/**
 * Extract global names from backend Questpie app
 */
export type GlobalNames<TApp extends Questpie<any>> =
  TApp extends Questpie<infer TConfig>
    ? keyof TConfig["globals"] & string
    : never;

/**
 * Extract collection item type
 */
export type CollectionItem<
  TApp extends Questpie<any>,
  TName extends CollectionNames<TApp>,
> =
  TApp extends Questpie<any>
    ? Awaited<
        ReturnType<QuestpieClient<TApp>["collections"][TName]["find"]>
      > extends { docs: Array<infer TItem> }
      ? TItem
      : never
    : never;

/**
 * Extract field keys from a backend collection
 *
 * @example
 * ```ts
 * type AppointmentFields = CollectionFieldKeys<AppCMS, "appointments">;
 * // = "customerId" | "barberId" | "serviceId" | "status" | ...
 * ```
 */
export type CollectionFieldKeys<
  TApp extends Questpie<any>,
  TCollectionName extends string,
> = TApp["config"]["collections"][TCollectionName] extends infer TCollection
  ? CollectionInfer<TCollection> extends infer TInfer
    ? TInfer extends { select: infer TSelect }
      ? keyof TSelect
      : never
    : never
  : never;
