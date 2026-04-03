/**
 * Admin Builder - Main Export
 */

import type { CollectionInfer } from "questpie";
import type { QuestpieApp, QuestpieClient } from "questpie/client";

export { Admin, type AppAdmin, type InferAdminCMS } from "./admin";
export type { AdminState } from "./admin-types";
// Action types and registry
export type { PageDefinition } from "./page/page";
// ============================================================================
// Common Types
// ============================================================================

export type { IconComponent } from "./types/common";

// ============================================================================
// Field Types
// ============================================================================

export type {
	ComponentRegistry,
	FieldComponentProps,
	FieldLayoutItem,
	FormSidebarConfig,
	FormViewConfig,
	SectionLayout,
	TabConfig,
	TabsLayout,
} from "./types/field-types";

// ============================================================================
// Validation
// ============================================================================

// ============================================================================
// Widget Types
// ============================================================================

export type {
	AnyWidgetConfig,
	WidgetAction,
	WidgetCardVariant,
	WidgetComponentProps,
	WidgetConfig,
} from "./types/widget-types";

// ============================================================================
// UI Config Types
// ============================================================================

export type {
	DashboardAction,
	DashboardConfig,
	DashboardLayoutItem,
	DashboardSection,
	DashboardTabConfig,
	DashboardTabs,
} from "./types/ui-config";

// ============================================================================
// I18n Types
// ============================================================================

// ============================================================================
// Module Augmentation Registry
// ============================================================================

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Unparameterised client type used throughout the admin library.
 *
 * The admin package is app-agnostic — it cannot know the concrete `TApp` at
 * build time. This alias replaces the raw `QuestpieClient<any>` escape hatch
 * with a single, intentional definition that documents the trade-off and
 * provides a future narrowing point.
 */
export type AnyQuestpieClient = QuestpieClient<any>;

/**
 * Extract collection names from a QuestpieApp config
 */
export type CollectionNames<TApp extends QuestpieApp> =
	keyof TApp["collections"] & string;
/**
 * Extract global names from a QuestpieApp config
 */
export type GlobalNames<TApp extends QuestpieApp> = keyof NonNullable<
	TApp["globals"]
> &
	string;

/**
 * Extract collection item type
 */
export type CollectionItem<
	TApp extends QuestpieApp,
	TName extends CollectionNames<TApp>,
> =
	Awaited<
		ReturnType<AnyQuestpieClient["collections"][TName]["find"]>
	> extends { docs: Array<infer TItem> }
		? TItem
		: never;

/**
 * Extract field keys from a backend collection
 *
 * @example
 * ```ts
 * type AppointmentFields = CollectionFieldKeys<AppConfig, "appointments">;
 * // = "customerId" | "barberId" | "serviceId" | "status" | ...
 * ```
 */
export type CollectionFieldKeys<
	TApp extends QuestpieApp,
	TCollectionName extends string,
> = TApp["collections"][TCollectionName] extends infer TCollection
	? CollectionInfer<TCollection> extends infer TInfer
		? TInfer extends { select: infer TSelect }
			? keyof TSelect
			: never
		: never
	: never;
