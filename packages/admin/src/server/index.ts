/**
 * @questpie/admin server exports
 *
 * Server-side modules for the admin panel.
 * These have no React dependencies and can be used in Node.js environments.
 *
 * @example
 * ```ts
 * import { adminModule } from "@questpie/admin/server";
 *
 * const cms = q({ name: "my-app" })
 *   .use(adminModule)
 *   .build({ ... });
 * ```
 */

// Server-side type augmentation for builder states
// This import activates the module augmentation for questpie types
import "./augmentation.js";

// Apply runtime patches to builder prototypes (auto-applies on import)
// This adds admin methods to QuestpieBuilder, CollectionBuilder, GlobalBuilder
import "./patch.js";

// Framework adapters
export * from "./adapters/index.js";
// Export augmentation types for external use
export type {
	ActionReference,
	// Actions system types
	ActionsConfigContext,
	AdminBlockConfig,
	AdminCollectionConfig,
	AdminConfigContext,
	AdminGlobalConfig,
	BlockCategoryConfig,
	BuiltinActionType,
	ComponentDefinition,
	ComponentFactory,
	ComponentReference,
	DashboardActionFactory,
	DashboardConfigContext,
	EditViewDefinition,
	EditViewFactory,
	FieldLayoutItem,
	FormFieldLayoutItem,
	FormReactiveConfig,
	FormReactiveContext,
	FormSectionLayout,
	FormSidebarConfig,
	FormTabConfig,
	FormTabsLayout,
	FormViewConfig,
	ListViewConfig,
	ListViewDefinition,
	ListViewFactory,
	PreviewConfig,
	// Action types
	ServerActionContext,
	ServerActionDefinition,
	ServerActionDownload,
	ServerActionEffects,
	ServerActionError,
	ServerActionForm,
	ServerActionFormField,
	ServerActionHandler,
	ServerActionRedirect,
	ServerActionResult,
	ServerActionSuccess,
	ServerActionsConfig,
	ServerBrandingConfig,
	ServerChartWidget,
	ServerCustomWidget,
	ServerDashboardAction,
	ServerDashboardConfig,
	ServerDashboardItem,
	ServerDashboardSection,
	ServerDashboardTab,
	ServerDashboardTabs,
	ServerDashboardWidget,
	ServerProgressWidget,
	ServerQuickAction,
	ServerQuickActionsWidget,
	ServerRecentItemsWidget,
	ServerSidebarCollectionItem,
	ServerSidebarConfig,
	ServerSidebarDividerItem,
	ServerSidebarGlobalItem,
	ServerSidebarItem,
	ServerSidebarLinkItem,
	ServerSidebarPageItem,
	ServerSidebarSection,
	ServerStatsWidget,
	ServerTableWidget,
	ServerTimelineWidget,
	ServerValueWidget,
	SidebarConfigContext,
	WidgetAccessRule,
	WidgetFetchContext,
	WithAdminMethods,
	WithCollectionAdminMethods,
	WithGlobalAdminMethods,
} from "./augmentation.js";
// Auth helpers for SSR
export {
	type AuthSession,
	type GetAdminSessionOptions,
	getAdminSession,
	isAdminUser,
	type RequireAdminAuthOptions,
	requireAdminAuth,
} from "./auth-helpers.js";
// Block builder for visual block editor
export {
	type AnyBlockBuilder,
	type AnyBlockDefinition,
	BlockBuilder,
	type BlockBuilderState,
	type BlockDefinition,
	type BlockPrefetchContext,
	type BlockPrefetchFn,
	type BlockSchema,
	type BlockPrefetchWith,
	type BlockPrefetchWithOptions,
	type BlocksPrefetchContext,
	type ExpandWithResult,
	type ExpandedRecord,
	block,
	createBlocksPrefetchHook,
	getBlocksByCategory,
	type InferBlockData,
	type InferBlockValues,
	introspectBlock,
	introspectBlocks,
	processBlocksDocument,
	processDocumentBlocksPrefetch,
} from "./block/index.js";
// Admin field types (richText, blocks)
export {
	adminFields,
	type BlockNode,
	type BlocksDocument,
	type BlocksFieldConfig,
	type BlocksFieldMeta,
	type BlockValues,
	blocksField,
	type RichTextFeature,
	type RichTextFieldConfig,
	type RichTextFieldMeta,
	richTextField,
	type TipTapDocument,
	type TipTapNode,
} from "./fields/index.js";
// Main admin module - the complete backend for admin panel
export {
	// Action functions
	actionFunctions,
	adminModule,
	adminRpc,
	// Reactive field functions
	batchReactive,
	createFirstAdmin,
	// Preview helpers (server-only, crypto-based)
	// For browser-safe preview utilities, use @questpie/admin/shared
	createPreviewFunctions,
	createPreviewTokenVerifier,
	type ExecuteActionRequest,
	type ExecuteActionResponse,
	executeAction,
	executeActionFn,
	type FilterOperator,
	type FilterRule,
	fetchWidgetData,
	fieldOptions,
	getActionsConfig,
	getActionsConfigFn,
	isSetupRequired,
	type PreviewTokenPayload,
	reactiveFunctions,
	type SortConfig,
	// Saved views
	savedViewsCollection,
	// Setup functions
	setupFunctions,
	type ViewConfiguration,
	verifyPreviewTokenDirect,
	widgetDataFunctions,
} from "./modules/admin/index.js";
// Runtime patching (applied automatically when this module is imported)
export {
	applyAdminPatches,
	arePatchesApplied,
	createActionProxy,
	createComponentProxy,
	createFieldProxy,
	createViewProxy,
} from "./patch.js";
