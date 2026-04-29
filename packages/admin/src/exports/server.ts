/**
 * @questpie/admin/server — Public Server API
 *
 * This is the ONLY barrel for server exports. It exists solely as the
 * package entry point for external consumers (`@questpie/admin/server`).
 *
 * Internal code within this package MUST NOT import from this file.
 * Use direct module paths instead (e.g. `#questpie/admin/server/registry-helpers.js`).
 *
 * @example
 * ```ts
 * import { adminModule, view, block } from "@questpie/admin/server";
 * ```
 */

// Framework adapters
export * from "../server/adapters/index.js";
// Export augmentation types for external use
export type {
	ActionReference,
	// Actions system types
	ActionsConfigContext,
	AdminBlockConfig,
	AdminCollectionConfig,
	AdminConfigContext,
	AdminConfigInput,
	AdminGlobalConfig,
	AdminLocaleConfig,
	BlockCategoryConfig,
	BuiltinActionType,
	ComponentDefinition,
	ComponentFactory,
	ComponentReference,
	ComponentType,
	ComponentTypeRegistry,
	DashboardActionFactory,
	// Composable sidebar/dashboard contribution types
	DashboardActionProxy,
	DashboardCallback,
	DashboardCallbackContext,
	DashboardConfigContext,
	DashboardContribution,
	DashboardItemDef,
	DashboardProxy,
	DashboardSectionDef,
	EditViewDefinition,
	EditViewFactory,
	FieldLayoutItem,
	FilterViewsByKind,
	FormFieldLayoutItem,
	FormReactiveConfig,
	FormReactiveContext,
	FormSectionLayout,
	FormSidebarConfig,
	FormTabConfig,
	FormTabsLayout,
	FormViewConfig,
	FormViewConfigContext,
	ListViewConfig,
	ListViewConfigContext,
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
	SidebarCallback,
	SidebarCallbackContext,
	SidebarConfigContext,
	SidebarContribution,
	SidebarItemDef,
	SidebarProxy,
	SidebarSectionDef,
	ViewDefinition,
	ViewKind,
	ViewKindRegistry,
	WidgetAccessRule,
	WidgetFetchContext,
} from "../server/augmentation.js";
// Auth helpers for SSR
export {
	type AuthSession,
	type GetAdminSessionOptions,
	getAdminSession,
	isAdminUser,
	type RequireAdminAuthOptions,
	requireAdminAuth,
} from "../server/auth-helpers.js";
// Block builder for visual block editor
export {
	type AnyBlockBuilder,
	type AnyBlockDefinition,
	BlockBuilder,
	type BlockBuilderState,
	type BlockDefinition,
	type BlockPrefetchContext,
	type BlockPrefetchFn,
	type BlockPrefetchWith,
	type BlockPrefetchWithOptions,
	type BlockSchema,
	type BlocksPrefetchContext,
	block,
	createBlocksPrefetchHook,
	type ExpandedRecord,
	type ExpandWithResult,
	getBlocksByCategory,
	type InferBlockData,
	type InferBlockValues,
	introspectBlock,
	introspectBlocks,
	processBlocksDocument,
	processDocumentBlocksPrefetch,
} from "../server/block/index.js";
// Admin field types (richText, blocks)
export {
	adminFields,
	type BlockNode,
	type BlocksDocument,
	type BlocksFieldMeta,
	type BlockValues,
	type RichTextFeature,
	type RichTextFieldMeta,
	type TipTapDocument,
	type TipTapNode,
} from "../server/fields/index.js";
// Main admin module - the complete backend for admin panel
export {
	type AdminModule,
	// Action functions
	actionFunctions,
	// Static module
	adminModule,
	adminRoutes,
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
} from "../server/modules/admin/index.js";
// Audit module - automatic audit logging for all mutations
export {
	type AuditModule,
	auditLogCollection,
	// Static module
	auditModule,
} from "../server/modules/audit/index.js";
// Codegen plugin — register in questpie.config.ts
export { adminPlugin } from "../server/plugin.js";
// Admin config factory (runtime identity function for typed admin config)
export { adminConfig } from "../server/augmentation.js";
// Proxy factories (runtime helpers for admin config callbacks)
export {
	createActionCallbackProxy,
	createActionProxy,
	createComponentCallbackProxy,
	createComponentProxy,
	createDashboardCallbackContext,
	createDashboardContributionProxy,
	createFieldProxy,
	createSidebarCallbackContext,
	createSidebarContributionProxy,
	createViewCallbackProxy,
	createViewProxy,
	resolveDashboardCallback,
	resolveSidebarCallback,
} from "../server/proxy-factories.js";
// Registry definition helpers
export {
	component,
	editView,
	filterViewsByKind,
	listView,
	view,
} from "../server/registry-helpers.js";
