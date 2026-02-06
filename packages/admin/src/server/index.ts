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

// Apply runtime patches to builder prototypes
// This adds admin methods to QuestpieBuilder, CollectionBuilder, GlobalBuilder
import { applyAdminPatches } from "./patch.js";

applyAdminPatches();

// Framework adapters
export * from "./adapters/index.js";
// Export augmentation types for external use
export type {
	ActionReference,
	// Actions system types
	ActionsConfigContext,
	AdminCollectionConfig,
	AdminGlobalConfig,
	BuiltinActionType,
	ComponentDefinition,
	ComponentReference,
	DashboardConfigContext,
	EditViewDefinition,
	FieldReference,
	FormSection,
	FormTab,
	FormViewConfig,
	ListViewConfig,
	ListViewDefinition,
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
	ServerChartWidget,
	ServerCustomWidget,
	ServerDashboardConfig,
	ServerDashboardItem,
	ServerDashboardSection,
	ServerDashboardTab,
	ServerDashboardTabs,
	ServerDashboardWidget,
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
	ServerValueWidget,
	ServerTableWidget,
	ServerTimelineWidget,
	ServerProgressWidget,
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
	type BlocksPrefetchContext,
	block,
	createBlocksPrefetchHook,
	getBlocksByCategory,
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
	type RichTextOutputFormat,
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
	getActionsConfig,
	getActionsConfigFn,
	isSetupRequired,
	type PreviewTokenPayload,
	type SortConfig,
	// Saved views
	savedViewsCollection,
	// Setup functions
	setupFunctions,
	type ViewConfiguration,
	verifyPreviewTokenDirect,
	widgetDataFunctions,
	fetchWidgetData,
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
