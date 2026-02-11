/**
 * @questpie/admin/client - Client-Side Admin UI
 *
 * The admin package provides React component registries for rendering
 * server-defined schemas. The server is the single source of truth for
 * all configuration - the client only provides React implementations.
 *
 * ## Architecture
 *
 * ```
 * SERVER (questpie + adminModule)     CLIENT (@questpie/admin)
 * ─────────────────────────────────   ───────────────────────────
 * - Field schemas                     - Field components
 * - Validation rules                  - View components
 * - Admin metadata (labels, icons)    - Page components
 * - List/form layouts                 - Block renderers
 * - Actions                           - Preview components
 *           │
 *           │ Introspection API
 *           ▼
 *     Client renders based on
 *     server configuration
 * ```
 *
 * ## Quick Start
 *
 * ```tsx
 * import { qa, adminModule, AdminRouter } from "@questpie/admin/client";
 *
 * // 1. Create admin instance with component registries
 * const admin = qa().use(adminModule);
 *
 * // 2. Render in your app
 * function App() {
 *   return <AdminRouter admin={admin} />;
 * }
 * ```
 *
 * @packageDocumentation
 */

// ============================================================================
// CORE API
// The essential exports for setting up admin
// ============================================================================

export {
	Admin,
	type AppAdmin,
	type InferAdminCMS,
} from "#questpie/admin/client/builder/admin.js";
// Pre-built modules with component registries
export {
	type CoreAdminModule,
	coreAdminModule,
} from "#questpie/admin/client/builder/defaults/core.js";
export {
	type AdminModule,
	adminModule,
} from "#questpie/admin/client/builder/defaults/starter.js";
// Entry point
export { qa } from "#questpie/admin/client/builder/qa.js";
// Registry types for module augmentation
export type {
	AdminTypeRegistry,
	IsRegistered,
	RegisteredAdmin,
	RegisteredCMS,
	RegisteredCollectionNames,
	RegisteredGlobalNames,
} from "#questpie/admin/client/builder/registry.js";
// Typed hooks factory
export {
	createTypedHooks,
	type TypedHooks,
} from "#questpie/admin/client/hooks/typed-hooks.js";
// Auth client
export {
	createAdminAuthClient,
	useAuthClient,
} from "#questpie/admin/client/hooks/use-auth.js";
// Runtime provider
export type {
	AdminProviderProps,
	AdminState,
	AdminStore,
} from "#questpie/admin/client/runtime/index.js";
export {
	AdminProvider,
	selectAdmin,
	selectBasePath,
	selectClient,
	selectNavigate,
	useAdminStore,
	useShallow,
} from "#questpie/admin/client/runtime/index.js";
export { AdminLayout } from "#questpie/admin/client/views/layout/admin-layout.js";
export { AdminLayoutProvider } from "#questpie/admin/client/views/layout/admin-layout-provider.js";
// Router and layout
export {
	AdminRouter,
	type AdminRouterProps,
} from "#questpie/admin/client/views/layout/admin-router.js";

// ============================================================================
// RENDERERS
// Components for rendering server-defined content on the frontend
// ============================================================================

export type {
	BlockCategory,
	BlockContent,
	BlockNode,
	BlockRendererProps,
} from "#questpie/admin/client/blocks/index.js";
// Block renderer (for displaying block content)
// Block prefetch (deprecated - server handles data fetching now)
export {
	type BlockPrefetchContext,
	type BlockPrefetchData,
	BlockPrefetchError,
	type BlockPrefetchParams,
	type BlockPrefetchResult,
	type BlockRegistry,
	BlockRenderer,
	type BlockRendererComponent,
	type BlockRendererComponentProps,
	type BlockRendererDefinition,
	createBlockRegistry,
	EMPTY_BLOCK_CONTENT,
	isBlockContent,
	prefetchBlockData,
	type TypedBlockPrefetch,
} from "#questpie/admin/client/blocks/index.js";
// Rich text renderer (for displaying TipTap content)
export {
	RichTextRenderer,
	type RichTextStyles,
	type TipTapDoc,
	type TipTapNode,
} from "#questpie/admin/components/rich-text/index.js";

// ============================================================================
// PREVIEW
// Live preview system for headless frontend integration
// ============================================================================

// Preview message types
export type {
	AdminToPreviewMessage,
	BlockClickedMessage,
	FieldClickedMessage,
	FocusFieldMessage,
	PreviewConfig,
	PreviewReadyMessage,
	PreviewRefreshMessage,
	PreviewToAdminMessage,
	RefreshCompleteMessage,
	SelectBlockMessage,
} from "#questpie/admin/client/preview/index.js";
// Frontend preview components
export {
	type BlockScopeContextValue,
	// Block scope for field resolution
	BlockScopeProvider,
	type BlockScopeProviderProps,
	// Message type guards
	isAdminToPreviewMessage,
	isPreviewToAdminMessage,
	PreviewBanner,
	type PreviewBannerProps,
	PreviewField,
	type PreviewFieldProps,
	PreviewProvider,
	StandalonePreviewField,
	type UseCollectionPreviewOptions,
	type UseCollectionPreviewResult,
	useBlockScope,
	useCollectionPreview,
	usePreviewContext,
	useResolveFieldPath,
} from "#questpie/admin/client/preview/index.js";

// ============================================================================
// AUTH PAGES
// Pre-built authentication pages
// ============================================================================

export { AuthGuard } from "#questpie/admin/client/components/auth/auth-guard.js";
export { AuthLoading } from "#questpie/admin/client/components/auth/auth-loading.js";

// Component renderer (for server-defined component references)
export {
	Badge,
	type BadgeProps,
	ComponentRenderer,
	type ComponentRendererProps,
	type ComponentRendererRegistry,
	createIconRenderer,
	IconifyIcon,
	type IconifyIconProps,
	isComponentReference,
	resolveIconElement,
} from "#questpie/admin/client/components/component-renderer.js";
export { AcceptInviteForm } from "#questpie/admin/client/views/auth/accept-invite-form.js";
export { AuthLayout } from "#questpie/admin/client/views/auth/auth-layout.js";
export { ForgotPasswordForm } from "#questpie/admin/client/views/auth/forgot-password-form.js";
// Auth forms (for custom layouts)
export { LoginForm } from "#questpie/admin/client/views/auth/login-form.js";
export { ResetPasswordForm } from "#questpie/admin/client/views/auth/reset-password-form.js";
export {
	SetupForm,
	type SetupFormValues,
} from "#questpie/admin/client/views/auth/setup-form.js";
export { AcceptInvitePage } from "#questpie/admin/client/views/pages/accept-invite-page.js";
export { DashboardPage } from "#questpie/admin/client/views/pages/dashboard-page.js";
export { ForgotPasswordPage } from "#questpie/admin/client/views/pages/forgot-password-page.js";
export { InvitePage } from "#questpie/admin/client/views/pages/invite-page.js";
export { LoginPage } from "#questpie/admin/client/views/pages/login-page.js";
export { ResetPasswordPage } from "#questpie/admin/client/views/pages/reset-password-page.js";
export {
	SetupPage,
	type SetupPageProps,
} from "#questpie/admin/client/views/pages/setup-page.js";

// ============================================================================
// HOOKS
// Essential hooks for data fetching and state
// ============================================================================

// Collection hooks
export {
	useCollectionCreate,
	useCollectionDelete,
	useCollectionItem,
	useCollectionList,
	useCollectionUpdate,
} from "#questpie/admin/client/hooks/use-collection.js";
// User hooks
export { useCurrentUser } from "#questpie/admin/client/hooks/use-current-user.js";
// Field options hook
export {
	type OptionItem,
	type UseFieldOptionsOptions,
	type UseFieldOptionsResult,
	useFieldOptions,
} from "#questpie/admin/client/hooks/use-field-options.js";
// Global hooks
export {
	useGlobal,
	useGlobalUpdate,
} from "#questpie/admin/client/hooks/use-global.js";
// Media query hooks
export {
	useIsDesktop,
	useIsMobile,
	useMediaQuery,
} from "#questpie/admin/client/hooks/use-media-query.js";
// Reactive fields hooks
export {
	type ReactiveFieldResult,
	type ReactiveFieldState,
	type UseReactiveFieldsOptions,
	type UseReactiveFieldsResult,
	useReactiveFields,
} from "#questpie/admin/client/hooks/use-reactive-fields.js";
// Server widget data hook
export { useServerWidgetData } from "#questpie/admin/client/hooks/use-server-widget-data.js";
// Setup hooks
export {
	type SetupStatus,
	useSetupStatus,
} from "#questpie/admin/client/hooks/use-setup-status.js";

// ============================================================================
// UTILITIES
// Helper functions and components
// ============================================================================

// Admin link
export { AdminLink } from "#questpie/admin/client/components/admin-link.js";
// Locale flags
export {
	type FlagConfig,
	getCountryCode,
	getFlagConfig,
	getFlagUrl,
} from "#questpie/admin/client/utils/locale-to-flag.js";

// ============================================================================
// TYPE HELPERS
// Type utilities for working with the CMS
// ============================================================================

import type { CollectionInfer, Questpie } from "questpie";
import type { QuestpieClient } from "questpie/client";

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
> = TApp extends Questpie<any>
	? Awaited<
			ReturnType<QuestpieClient<TApp>["collections"][TName]["find"]>
		> extends { docs: Array<infer TItem> }
		? TItem
		: never
	: never;

/**
 * Extract field keys from a backend collection
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

// ============================================================================
// ADVANCED / INTERNAL
// For custom field/view implementations and extensions
// These may change between versions
// ============================================================================

// Widget augmentation types
export type {
	BaseWidgetAdminMeta,
	WidgetTypeRegistry,
} from "#questpie/admin/augmentation.js";
// Block types (for implementing custom block renderers)
export type {
	AllBlockData,
	AllBlockValues,
	BlockComponentProps,
	BlockValues,
	ExtractBlockFieldValues,
	ExtractBlockPrefetchData,
	ExtractServerBlocks,
	ServerBlockNames,
	TypedBlockRendererProps,
} from "#questpie/admin/client/blocks/index.js";
// Field definition factory (for custom field components)
export {
	FieldBuilder,
	type FieldBuilderState,
	type FieldDefinition,
	field,
} from "#questpie/admin/client/builder/field/field.js";
// Component types (for implementing custom fields)
export type {
	BaseFieldProps,
	IconComponent,
	MaybeLazyComponent,
} from "#questpie/admin/client/builder/types/common.js";
export type {
	ComponentRegistry,
	FieldComponentProps,
	FormViewConfig,
} from "#questpie/admin/client/builder/types/field-types.js";
// Widget types (for implementing custom widgets)
export type {
	AnyWidgetConfig,
	BaseWidgetConfig,
	ChartWidgetConfig,
	CustomWidgetConfig,
	ProgressWidgetConfig,
	QuickActionsWidgetConfig,
	RecentItemsWidgetConfig,
	StatsWidgetConfig,
	TableWidgetConfig,
	TimelineWidgetConfig,
	ValueWidgetConfig,
	WidgetComponentProps,
	WidgetConfig,
} from "#questpie/admin/client/builder/types/widget-types.js";
// View definition factories (for custom views)
export {
	EditViewBuilder,
	type EditViewBuilderState,
	type EditViewDefinition,
	editView,
	ListViewBuilder,
	type ListViewBuilderState,
	type ListViewDefinition,
	listView,
} from "#questpie/admin/client/builder/view/view.js";
// Widget builder (for defining custom widgets)
export {
	WidgetBuilder,
	type WidgetBuilderState,
	type WidgetDefinition,
	widget,
} from "#questpie/admin/client/builder/widget/widget.js";
// Focus system (for preview click-to-focus)
export {
	type FocusContextValue,
	FocusProvider,
	type FocusProviderProps,
	type FocusState,
	parsePreviewFieldPath,
	scrollFieldIntoView,
	useFocus,
	useFocusOptional,
	useIsBlockFocused,
	useIsFieldFocused,
} from "#questpie/admin/client/context/focus-context.js";
// I18n types
export type {
	I18nContext,
	I18nText,
} from "#questpie/admin/client/i18n/types.js";

// ============================================================================
// SCOPE PRIMITIVES
// Multi-tenant / scope selection system
// ============================================================================

// Scope types
export type {
	ScopeContextValue,
	ScopeOption,
	ScopePickerProps,
	ScopeProviderProps,
} from "#questpie/admin/client/scope/index.js";
// Scope provider and hooks
export {
	createScopedFetch,
	ScopePicker,
	ScopeProvider,
	useScope,
	useScopedFetch,
	useScopeSafe,
} from "#questpie/admin/client/scope/index.js";
