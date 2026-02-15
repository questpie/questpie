/**
 * Form View - Default edit view component
 *
 * Renders collection item edit/create form with sections, tabs, validation.
 * This is the default edit view registered in the admin view registry.
 */

import { Icon } from "@iconify/react";
import { createQuestpieQueryOptions } from "@questpie/tanstack-query";
import { useQueryClient } from "@tanstack/react-query";
import type { CollectionSchema, FieldReactiveSchema } from "questpie/client";
import { QuestpieClientError } from "questpie/client";
import * as React from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { getDefaultFormActions } from "../../builder/types/action-registry";
import type {
	ActionContext,
	ActionDefinition,
	ActionHelpers,
	ActionQueryClient,
} from "../../builder/types/action-types";
import type {
	CollectionBuilderState,
	PreviewConfig,
} from "../../builder/types/collection-types";
import type {
	ComponentRegistry,
	FormViewActionsConfig,
	FormViewConfig,
} from "../../builder/types/field-types";
import { ActionButton } from "../../components/actions/action-button";
import { ActionDialog } from "../../components/actions/action-dialog";
import { ConfirmationDialog } from "../../components/actions/confirmation-dialog";
import { resolveIconElement } from "../../components/component-renderer";
import { LocaleSwitcher } from "../../components/locale-switcher";
import {
	LivePreviewMode,
	useLivePreviewContext,
} from "../../components/preview/live-preview-mode";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../../components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import {
	useAdminConfig,
	useCollectionValidation,
	usePreferServerValidation,
} from "../../hooks";
import {
	useCollectionCreate,
	useCollectionDelete,
	useCollectionItem,
	useCollectionUpdate,
} from "../../hooks/use-collection";
import { useCollectionFields } from "../../hooks/use-collection-fields";
import { getLockUser, LOCK_DURATION_MS, useLock } from "../../hooks/use-locks";
import { useReactiveFields } from "../../hooks/use-reactive-fields";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import {
	selectAdmin,
	selectBasePath,
	selectClient,
	selectNavigate,
	useAdminStore,
	useSafeContentLocales,
	useScopedLocale,
} from "../../runtime";
import {
	detectManyToManyRelations,
	hasManyToManyRelations,
} from "../../utils/detect-relations";

import { AutoFormFields } from "./auto-form-fields";
import { FormViewSkeleton } from "./view-skeletons";

// ============================================================================
// Constants
// ============================================================================

/** Query key prefix for CMS queries (used for cache invalidation) */
const QUERY_KEY_PREFIX = ["questpie", "collections"] as const;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract reactive configs from collection schema fields.
 * Used to determine which fields have server-side reactive behaviors.
 */
function extractReactiveConfigs(
	schema: CollectionSchema | undefined,
): Record<string, FieldReactiveSchema> {
	if (!schema?.fields) return {};

	const configs: Record<string, FieldReactiveSchema> = {};

	for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
		if (fieldDef.reactive) {
			configs[fieldName] = fieldDef.reactive;
		}
	}

	return configs;
}

/**
 * Component that manages reactive field states.
 * Must be rendered inside FormProvider to access form context.
 */
function ReactiveFieldsManager({
	collection,
	mode = "collection",
	reactiveConfigs,
	enabled,
}: {
	collection: string;
	mode?: "collection" | "global";
	reactiveConfigs: Record<string, FieldReactiveSchema>;
	enabled: boolean;
}) {
	// This hook handles:
	// 1. Watching form values for changes to reactive dependencies
	// 2. Calling server /reactive endpoint to execute handlers
	// 3. Setting computed values via form.setValue
	useReactiveFields({
		collection,
		mode,
		reactiveConfigs,
		enabled: enabled && Object.keys(reactiveConfigs).length > 0,
		debounce: 300,
	});

	return null;
}

// ============================================================================
// Types
// ============================================================================

/**
 * Form view configuration from registry.
 *
 * Re-exports FormViewConfig for type consistency between builder and component.
 */
export type FormViewRegistryConfig = FormViewConfig;

/**
 * Props for FormView component
 */
export interface FormViewProps {
	/**
	 * Collection name
	 */
	collection: string;

	/**
	 * Item ID (undefined for create, string for edit)
	 */
	id?: string;

	/**
	 * Collection configuration from admin builder
	 * Accepts CollectionBuilderState or any compatible config object
	 */
	config?: Partial<CollectionBuilderState> | Record<string, any>;

	/**
	 * View-specific configuration from registry
	 */
	viewConfig?: FormViewRegistryConfig;

	/**
	 * Navigate function for routing
	 */
	navigate: (path: string) => void;

	/**
	 * Base path for admin routes (e.g., "/admin")
	 */
	basePath?: string;

	/**
	 * Default values for create mode (from URL prefill params)
	 */
	defaultValues?: Record<string, any>;

	/**
	 * Component registry for custom field types
	 */
	registry?: ComponentRegistry;

	/**
	 * All collections config (for embedded collections)
	 */
	allCollectionsConfig?: Record<
		string,
		Partial<CollectionBuilderState> | Record<string, any>
	>;

	/**
	 * Show metadata (ID, created/updated dates)
	 * @default true
	 */
	showMeta?: boolean;

	/**
	 * Custom header actions (in addition to default Save button)
	 */
	headerActions?: React.ReactNode;

	/**
	 * Callback on successful save
	 */
	onSuccess?: (data: any) => void;

	/**
	 * Callback on error
	 */
	onError?: (error: Error) => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * FormView - Default form-based edit/create view for collections
 *
 * Features:
 * - Auto-generates form fields from collection config
 * - Supports tabs, sections, and sidebar layout
 * - Auto-detects M:N relations
 * - Keyboard shortcut (Cmd+S) to save
 * - Field-level validation errors from API
 *
 * @example
 * ```tsx
 * // Used automatically via registry when navigating to /admin/collections/:name/:id
 * // Can also be used directly:
 * <FormView
 *   collection="posts"
 *   id="123"
 *   config={postsConfig}
 *   navigate={navigate}
 *   basePath="/admin"
 * />
 * ```
 */
export default function FormView({
	collection,
	id,
	config,
	viewConfig,
	navigate,
	basePath = "/admin",
	defaultValues: defaultValuesProp,
	registry,
	allCollectionsConfig,
	showMeta = true,
	headerActions,
	onSuccess,
	onError,
}: FormViewProps): React.ReactElement {
	const { t } = useTranslation();
	const resolveText = useResolveText();
	const admin = useAdminStore(selectAdmin);
	const { data: adminConfig } = useAdminConfig();
	const isEditMode = !!id;
	const { fields: resolvedFields, schema } = useCollectionFields(collection, {
		fallbackFields: (config as any)?.fields,
	});
	const resolvedFormConfig = React.useMemo(
		() =>
			viewConfig ??
			(config?.form as any)?.["~config"] ??
			(config?.form as any) ??
			(schema?.admin?.form as any),
		[viewConfig, config?.form, schema?.admin?.form],
	);
	const formConfigBridge = React.useMemo(() => {
		if (!resolvedFormConfig) return config;

		return {
			...(config ?? {}),
			form: resolvedFormConfig,
		};
	}, [config, resolvedFormConfig]);

	// Extract reactive configs from schema for server-side reactive handlers
	const reactiveConfigs = React.useMemo(
		() => extractReactiveConfigs(schema),
		[schema],
	);

	// Try to get preview context (will be null if not in LivePreviewMode)
	const previewContext = useLivePreviewContext();

	// Preview configuration from introspected schema (server-side .preview() config)
	// Note: url function cannot be serialized, so we use hasUrlBuilder flag + RPC
	const schemaPreview = schema?.admin?.preview;
	const hasPreview =
		!!schemaPreview?.hasUrlBuilder && schemaPreview?.enabled !== false;

	// Check URL for ?preview=true on mount
	const [isLivePreviewOpen, setIsLivePreviewOpen] = React.useState(() => {
		if (typeof window === "undefined") return false;
		const params = new URLSearchParams(window.location.search);
		return params.get("preview") === "true" && hasPreview;
	});

	// Sync preview state with URL
	React.useEffect(() => {
		if (typeof window === "undefined") return;

		const url = new URL(window.location.href);
		if (isLivePreviewOpen) {
			url.searchParams.set("preview", "true");
		} else {
			url.searchParams.delete("preview");
		}

		// Update URL without navigation
		window.history.replaceState({}, "", url.toString());
	}, [isLivePreviewOpen]);

	// Auto-detect M:N relations that need to be included when fetching
	const withRelations = React.useMemo(
		() => detectManyToManyRelations({ fields: resolvedFields, schema }),
		[resolvedFields, schema],
	);

	// Fetch item if in edit mode (include relations if specified)
	const { data: item, isLoading } = useCollectionItem(
		collection as any,
		id ?? "",
		hasManyToManyRelations(withRelations)
			? { with: withRelations, localeFallback: false }
			: { localeFallback: false },
		{ enabled: isEditMode },
	);

	// Document locking - acquire lock when editing, show blocked state if someone else is editing
	const {
		isBlocked,
		blockedBy,
		isOpenElsewhere,
		refresh: refreshLock,
	} = useLock({
		resourceType: "collection",
		resource: collection,
		resourceId: id ?? "",
		autoAcquire: isEditMode,
	});
	const blockedByUser = blockedBy ? getLockUser(blockedBy) : null;

	// Transform loaded item - convert relation arrays of objects to arrays of IDs
	// Backend returns: { services: [{ id: "...", name: "..." }] }
	// Form needs: { services: ["id1", "id2"] }
	const transformedItem = React.useMemo(() => {
		if (!item || !hasManyToManyRelations(withRelations)) return item;

		const result = { ...item } as any;
		for (const key of Object.keys(withRelations)) {
			const value = result[key];
			if (
				Array.isArray(value) &&
				value.length > 0 &&
				typeof value[0] === "object" &&
				value[0]?.id
			) {
				// Transform array of objects to array of IDs
				result[key] = value.map((v: any) => v.id);
			}
		}
		return result;
	}, [item, withRelations]);

	// Mutations
	const createMutation = useCollectionCreate(collection as any);
	const updateMutation = useCollectionUpdate(collection as any);
	const deleteMutation = useCollectionDelete(collection as any);

	// Get validation resolver - prefer server validation (AJV with JSON Schema) over client validation
	const clientResolver = useCollectionValidation(collection);
	const resolver = usePreferServerValidation(
		collection,
		{ mode: isEditMode ? "update" : "create" },
		clientResolver,
	);

	const form = useForm({
		defaultValues: (transformedItem ?? defaultValuesProp ?? {}) as any,
		resolver,
	});

	// Autosave state
	const [isSaving, setIsSaving] = React.useState(false);
	const [lastSaved, setLastSaved] = React.useState<Date | null>(null);
	const autoSaveTimerRef = React.useRef<NodeJS.Timeout | null>(null);

	// Get autosave config from collection config
	const autoSaveConfig = React.useMemo(() => {
		const cfg = (config as any)?.autoSave;
		if (!cfg) return { enabled: false, debounce: 500 };
		return {
			enabled: cfg.enabled !== false,
			debounce: cfg.debounce ?? 500,
			indicator: cfg.indicator !== false,
			preventNavigation: cfg.preventNavigation !== false,
		};
	}, [config]);

	// Track content locale changes to warn about unsaved changes
	// Uses scoped locale (isolated in ResourceSheet) or global locale
	const {
		locale: contentLocale,
		setLocale: setContentLocale,
		isScoped,
	} = useScopedLocale();
	const contentLocales = useSafeContentLocales();
	const localeOptions = contentLocales?.locales ?? [];
	const prevLocaleRef = React.useRef(contentLocale);
	const [localeChangeDialog, setLocaleChangeDialog] = React.useState<{
		open: boolean;
		pendingLocale: string | null;
	}>({ open: false, pendingLocale: null });
	const localeChangeSnapshotRef = React.useRef<Record<string, any> | null>(
		null,
	);
	const skipItemResetRef = React.useRef(false);

	// Detect locale change and show confirmation dialog if form is dirty
	React.useEffect(() => {
		if (!isEditMode) {
			prevLocaleRef.current = contentLocale;
			return;
		}
		if (prevLocaleRef.current !== contentLocale) {
			if (form.formState.isDirty && !localeChangeDialog.open) {
				// Store the new locale and revert to previous locale
				// The dialog will decide whether to apply or discard
				skipItemResetRef.current = true;
				localeChangeSnapshotRef.current = form.getValues();
				setLocaleChangeDialog({ open: true, pendingLocale: contentLocale });
				setContentLocale(prevLocaleRef.current);
			} else {
				// No dirty form, allow locale change
				prevLocaleRef.current = contentLocale;
				skipItemResetRef.current = false;
			}
		}
	}, [
		contentLocale,
		form.formState.isDirty,
		form.getValues,
		setContentLocale,
		localeChangeDialog.open,
		isEditMode,
	]);

	// Reset form when item loads
	React.useEffect(() => {
		if (skipItemResetRef.current) return;
		if (transformedItem) {
			form.reset(transformedItem as any);
		} else if (defaultValuesProp) {
			form.reset(defaultValuesProp as any);
		}
	}, [form, transformedItem, defaultValuesProp]);

	// Handle locale change confirmation
	const handleLocaleChangeConfirm = React.useCallback(() => {
		skipItemResetRef.current = false;
		localeChangeSnapshotRef.current = null;
		if (localeChangeDialog.pendingLocale) {
			prevLocaleRef.current = localeChangeDialog.pendingLocale;
			setContentLocale(localeChangeDialog.pendingLocale);
		}
		setLocaleChangeDialog({ open: false, pendingLocale: null });
	}, [localeChangeDialog.pendingLocale, setContentLocale]);

	const handleLocaleChangeCancel = React.useCallback(() => {
		skipItemResetRef.current = false;
		if (localeChangeSnapshotRef.current) {
			form.reset(localeChangeSnapshotRef.current, {
				keepDirty: true,
				keepDirtyValues: true,
				keepErrors: true,
				keepTouched: true,
			});
		}
		localeChangeSnapshotRef.current = null;
		setLocaleChangeDialog({ open: false, pendingLocale: null });
	}, [form]);

	const onSubmit = React.useEffectEvent(async (data: any) => {
		const savePromise = async () => {
			if (isEditMode) {
				return await updateMutation.mutateAsync({
					id: id!,
					data,
				});
			} else {
				return await createMutation.mutateAsync(data);
			}
		};

		toast.promise(savePromise(), {
			loading: isEditMode ? t("toast.saving") : t("toast.creating"),
			success: (result) => {
				// Call onSuccess callback if provided
				if (onSuccess) {
					onSuccess(result);
				} else {
					if (isEditMode) {
						form.reset(result as any);

						// Trigger preview refresh after successful save
						if (previewContext) {
							previewContext.triggerPreviewRefresh();
						}
					} else if (result?.id) {
						navigate(`${basePath}/collections/${collection}/${result.id}`);
					} else {
						navigate(`${basePath}/collections/${collection}`);
					}
				}
				return isEditMode ? t("toast.saveSuccess") : t("toast.createSuccess");
			},
			error: (error) => {
				// Handle field-level validation errors from the API
				if (
					error instanceof QuestpieClientError &&
					error.fieldErrors &&
					error.fieldErrors.length > 0
				) {
					for (const fieldError of error.fieldErrors) {
						form.setError(fieldError.path as any, {
							type: "server",
							message: fieldError.message,
						});
					}
					return t("toast.validationFailed");
				}

				// Handle generic errors
				const message =
					error instanceof Error ? error.message : t("error.unknown");
				onError?.(error instanceof Error ? error : new Error(message));
				return `${t("toast.saveFailed")}: ${message}`;
			},
		});
	});

	// Autosave logic - debounced save on form changes
	React.useEffect(() => {
		// Clear existing timer
		if (autoSaveTimerRef.current) {
			clearTimeout(autoSaveTimerRef.current);
		}

		// Don't autosave if:
		// - Autosave is disabled
		// - Form is not dirty
		// - Form is already submitting
		// - Not in edit mode (don't autosave on create)
		if (
			!autoSaveConfig.enabled ||
			!form.formState.isDirty ||
			form.formState.isSubmitting ||
			!isEditMode
		) {
			return;
		}

		// Start debounce timer
		autoSaveTimerRef.current = setTimeout(async () => {
			try {
				setIsSaving(true);
				await form.handleSubmit(async (data) => {
					// Silent save (no toast)
					const result = await updateMutation.mutateAsync({
						id: id!,
						data,
					});

					// Reset form to mark as not dirty
					form.reset(result as any);

					// Trigger preview refresh after successful save
					if (previewContext) {
						previewContext.triggerPreviewRefresh();
					}

					// Update last saved timestamp
					setLastSaved(new Date());
					setIsSaving(false);
				})();
			} catch (error) {
				setIsSaving(false);
				// Silently fail autosave (user can still manually save)
				console.error("Autosave failed:", error);
			}
		}, autoSaveConfig.debounce);

		return () => {
			if (autoSaveTimerRef.current) {
				clearTimeout(autoSaveTimerRef.current);
			}
		};
	}, [
		form.formState.isDirty,
		form.formState.isSubmitting,
		form,
		autoSaveConfig.enabled,
		autoSaveConfig.debounce,
		isEditMode,
		updateMutation,
		resolvedFields,
		adminConfig?.blocks,
		id,
		previewContext,
		admin,
	]);

	// Prevent navigation when there are unsaved changes
	React.useEffect(() => {
		if (!autoSaveConfig.preventNavigation || !autoSaveConfig.enabled) return;

		const handleBeforeUnload = (e: BeforeUnloadEvent) => {
			if (form.formState.isDirty) {
				e.preventDefault();
				e.returnValue = "";
			}
		};

		window.addEventListener("beforeunload", handleBeforeUnload);
		return () => window.removeEventListener("beforeunload", handleBeforeUnload);
	}, [
		form.formState.isDirty,
		autoSaveConfig.preventNavigation,
		autoSaveConfig.enabled,
	]);

	// Keyboard shortcut: Cmd+S to save
	React.useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "s") {
				e.preventDefault();
				e.stopPropagation();
				form.handleSubmit(onSubmit, (errors) => {
					console.warn("[FormView] Validation errors:", errors);
					toast.error(t("toast.validationFailed"));
				})();
			}
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [form, onSubmit]);

	const isSubmitting =
		createMutation.isPending ||
		updateMutation.isPending ||
		form.formState.isSubmitting;

	// ========================================================================
	// Form Actions
	// ========================================================================

	// Get form actions from config or use defaults (only for edit mode)
	const configFormActions: FormViewActionsConfig | undefined = (
		resolvedFormConfig as any
	)?.actions;

	// Use defaults if no actions defined and in edit mode
	// In create mode, we don't show duplicate/delete actions
	const formActions: FormViewActionsConfig | undefined = React.useMemo(() => {
		if (configFormActions) return configFormActions;
		if (!isEditMode) return { primary: [], secondary: [] };
		return getDefaultFormActions();
	}, [configFormActions, isEditMode]);

	// Dialog state for form actions
	const [dialogAction, setDialogAction] =
		React.useState<ActionDefinition | null>(null);
	const [confirmAction, setConfirmAction] =
		React.useState<ActionDefinition | null>(null);
	const [actionLoading, setActionLoading] = React.useState(false);

	// Navigation and query client from store/hooks
	const storeNavigate = useAdminStore(selectNavigate);
	const storeBasePath = useAdminStore(selectBasePath);
	const client = useAdminStore(selectClient);
	const queryClient = useQueryClient();

	// Create query options proxy for key building (same as use-collection hooks)
	const queryOpts = React.useMemo(
		() =>
			createQuestpieQueryOptions(client as any, {
				keyPrefix: QUERY_KEY_PREFIX,
				locale: contentLocale,
			}),
		[client, contentLocale],
	);

	// Wrapped query client for action context
	const actionQueryClient: ActionQueryClient = React.useMemo(
		() => ({
			invalidateQueries: (filters) => queryClient.invalidateQueries(filters),
			refetchQueries: (filters) => queryClient.refetchQueries(filters),
			resetQueries: (filters) => queryClient.resetQueries(filters),
		}),
		[queryClient],
	);

	// Action helpers
	const actionHelpers: ActionHelpers = React.useMemo(
		() => ({
			navigate: storeNavigate,
			toast: {
				success: toast.success,
				error: toast.error,
				info: toast.info,
				warning: toast.warning,
			},
			t,
			invalidateCollection: async (targetCollection?: string) => {
				const col = targetCollection || collection;
				// Invalidate list and count queries for the collection
				await queryClient.invalidateQueries({
					queryKey: queryOpts.key(["collections", col, "find", contentLocale]),
				});
				await queryClient.invalidateQueries({
					queryKey: queryOpts.key(["collections", col, "count", contentLocale]),
				});
			},
			invalidateItem: async (itemId: string, targetCollection?: string) => {
				const col = targetCollection || collection;
				// Invalidate findOne query for specific item
				await queryClient.invalidateQueries({
					queryKey: queryOpts.key([
						"collections",
						col,
						"findOne",
						contentLocale,
						{ id: itemId },
					]),
				});
				// Also invalidate list queries since item data changed
				await queryClient.invalidateQueries({
					queryKey: queryOpts.key(["collections", col, "find", contentLocale]),
				});
			},
			invalidateAll: async () => {
				// Invalidate all CMS queries
				await queryClient.invalidateQueries({
					queryKey: [...QUERY_KEY_PREFIX],
				});
			},
			refresh: () => {
				// Invalidate current collection queries (better than page reload)
				queryClient.invalidateQueries({
					queryKey: queryOpts.key([
						"collections",
						collection,
						"find",
						contentLocale,
					]),
				});
				queryClient.invalidateQueries({
					queryKey: queryOpts.key([
						"collections",
						collection,
						"count",
						contentLocale,
					]),
				});
			},
			closeDialog: () => {
				setDialogAction(null);
				setConfirmAction(null);
			},
			basePath: storeBasePath || basePath,
		}),
		[
			storeNavigate,
			storeBasePath,
			basePath,
			queryClient,
			queryOpts,
			collection,
			contentLocale,
			t,
		],
	);

	// Action context for visibility/disabled checks
	const actionContext: ActionContext = React.useMemo(
		() => ({
			item: transformedItem,
			collection,
			helpers: actionHelpers,
			queryClient: actionQueryClient,
		}),
		[transformedItem, collection, actionHelpers, actionQueryClient],
	);

	// Filter visible actions
	const filterVisibleActions = React.useCallback(
		(actions: ActionDefinition[] | undefined) => {
			if (!actions) return [];
			return actions.filter((action) => {
				if (action.visible === undefined) return true;
				if (typeof action.visible === "function") {
					return action.visible(actionContext);
				}
				return action.visible;
			});
		},
		[actionContext],
	);

	const visiblePrimaryActions = React.useMemo(
		() => filterVisibleActions(formActions?.primary),
		[formActions?.primary, filterVisibleActions],
	);

	const visibleSecondaryActions = React.useMemo(
		() => filterVisibleActions(formActions?.secondary),
		[formActions?.secondary, filterVisibleActions],
	);

	// Group secondary by variant
	const regularSecondary = visibleSecondaryActions.filter(
		(a) => a.variant !== "destructive",
	);
	const destructiveSecondary = visibleSecondaryActions.filter(
		(a) => a.variant === "destructive",
	);

	// Execute action
	const executeAction = React.useCallback(
		async (action: ActionDefinition) => {
			const { handler } = action;
			const actionLabel = resolveText(action.label, action.id);

			switch (handler.type) {
				case "navigate": {
					const path =
						typeof handler.path === "function"
							? handler.path(transformedItem)
							: handler.path;
					storeNavigate(path);
					break;
				}
				case "api": {
					// For DELETE operations, use the deleteMutation hook
					if (handler.method === "DELETE") {
						const itemId = transformedItem?.id || id;
						if (!itemId) {
							toast.error(t("toast.deleteFailed"));
							break;
						}

						setActionLoading(true);
						toast.promise(
							deleteMutation.mutateAsync(itemId).finally(() => {
								setActionLoading(false);
							}),
							{
								loading: t("toast.deleting"),
								success: () => {
									// Navigate back to list on delete
									navigate(`${basePath}/collections/${collection}`);
									return t("toast.deleteSuccess");
								},
								error: (err) => err.message || t("toast.deleteFailed"),
							},
						);
					} else {
						// For other API operations, make a fetch request
						// (This is a fallback - most actions should use custom handlers)
						const endpoint = handler.endpoint.replace(
							"{id}",
							String(transformedItem?.id || id),
						);
						setActionLoading(true);
						const apiPromise = async () => {
							try {
								// Build the URL using CMS API path
								const url = `${storeBasePath}/${collection}/${endpoint}`;
								const response = await fetch(url, {
									method: handler.method || "POST",
									headers: { "Content-Type": "application/json" },
									body: handler.body
										? JSON.stringify(handler.body(actionContext))
										: undefined,
								});

								if (!response.ok) {
									const error = await response.json().catch(() => ({}));
									throw new Error(error.message || t("toast.actionFailed"));
								}
								return response.json();
							} finally {
								setActionLoading(false);
							}
						};

						toast.promise(apiPromise(), {
							loading: `${actionLabel}...`,
							success: t("toast.actionSuccess"),
							error: (err) => err.message || t("toast.actionFailed"),
						});
					}
					break;
				}
				case "custom": {
					const customPromise = handler.fn(actionContext);
					// Only use toast.promise if it returns a promise
					if (customPromise instanceof Promise) {
						setActionLoading(true);
						toast.promise(
							customPromise.finally(() => setActionLoading(false)),
							{
								loading: `${actionLabel}...`,
								success: t("toast.actionSuccess"),
								error: (err) => err.message || t("toast.actionFailed"),
							},
						);
					}
					break;
				}
			}
			setConfirmAction(null);
		},
		[
			transformedItem,
			id,
			actionContext,
			storeNavigate,
			storeBasePath,
			deleteMutation,
			collection,
			basePath,
			navigate,
			t,
			resolveText,
		],
	);

	// Handle action click
	const handleActionClick = React.useCallback(
		(action: ActionDefinition) => {
			if (action.confirmation) {
				setConfirmAction(action);
			} else if (
				action.handler.type === "dialog" ||
				action.handler.type === "form"
			) {
				setDialogAction(action);
			} else {
				// Execute immediately
				executeAction(action);
			}
		},
		[executeAction],
	);

	// Handle confirmation
	const handleConfirm = React.useCallback(async () => {
		if (confirmAction) {
			await executeAction(confirmAction);
		}
	}, [confirmAction, executeAction]);

	// Format date helper
	const formatDate = (date: string | Date) => {
		return new Date(date).toLocaleDateString(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	};

	// Format time ago helper
	const formatTimeAgo = (date: Date) => {
		const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
		if (seconds < 10) return t("autosave.justNow");
		if (seconds < 60) return t("autosave.secondsAgo", { count: seconds });
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return t("autosave.minutesAgo", { count: minutes });
		const hours = Math.floor(minutes / 60);
		return t("autosave.hoursAgo", { count: hours });
	};

	// Re-render every 10 seconds to update "time ago" display
	const [, forceUpdate] = React.useReducer((x) => x + 1, 0);
	React.useEffect(() => {
		if (!lastSaved || !autoSaveConfig.indicator) return;
		const interval = setInterval(forceUpdate, 10000);
		return () => clearInterval(interval);
	}, [lastSaved, autoSaveConfig.indicator]);

	// Watch form values for preview updates
	// Using useWatch hook (React way) instead of form.watch() method
	// This is more performant as it's a proper React subscription
	const watchedValues = useWatch({ control: form.control });

	// Refresh lock on form activity (debounced) - keeps lock alive while user is editing
	const lockRefreshTimerRef = React.useRef<NodeJS.Timeout | null>(null);
	React.useEffect(() => {
		if (!isEditMode || isBlocked) return;

		// Debounce lock refresh - only refresh after user stops typing for 1s
		if (lockRefreshTimerRef.current) {
			clearTimeout(lockRefreshTimerRef.current);
		}
		lockRefreshTimerRef.current = setTimeout(() => {
			refreshLock();
		}, 1000);

		return () => {
			if (lockRefreshTimerRef.current) {
				clearTimeout(lockRefreshTimerRef.current);
			}
		};
	}, [watchedValues, isEditMode, isBlocked, refreshLock]);

	// Generate preview URL via server RPC (url function runs server-side)
	// Must be after useWatch for reactive updates to form values
	const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);

	React.useEffect(() => {
		if (!hasPreview || !client) {
			setPreviewUrl(null);
			return;
		}

		// Debounce the RPC call to avoid too many requests
		const timeoutId = setTimeout(async () => {
			try {
				const formValues = (watchedValues ?? {}) as Record<string, unknown>;
				// Type assertion needed - getPreviewUrl is dynamically registered via adminModule
				const rpc = (client as any).rpc;
				const result = await rpc.getPreviewUrl({
					collection,
					record: formValues,
					locale: contentLocale,
				});
				setPreviewUrl(result?.url ?? null);
			} catch {
				setPreviewUrl(null);
			}
		}, 300);

		return () => clearTimeout(timeoutId);
	}, [hasPreview, client, collection, watchedValues, contentLocale]);

	// Show skeleton until form data is ready (edit mode only)
	// This prevents race conditions where form fields render before data is loaded
	if (isEditMode && isLoading) {
		return <FormViewSkeleton />;
	}

	const collectionLabel = resolveText(
		(config as any)?.label ?? schema?.admin?.config?.label,
		collection,
	);
	// In edit mode, show item's _title; in new mode, show "New {collection}"
	const title = isEditMode
		? (item as any)?._title ||
			item?.id ||
			t("collection.edit", { name: collectionLabel })
		: t("collection.new", { name: collectionLabel });

	// Form content - extracted for reuse in both layouts
	const formContent = (
		<>
			{/* Lock banner - show when someone else is editing */}
			{isBlocked && blockedByUser && (
				<div className="flex items-center gap-3 p-3 mb-4 rounded-lg bg-warning/10 border border-warning/30">
					{blockedByUser.image ? (
						<img
							src={blockedByUser.image}
							alt=""
							className="size-8 rounded-full"
						/>
					) : (
						<div className="size-8 rounded-full bg-warning/20 flex items-center justify-center">
							<Icon icon="ph:user" className="size-4 text-warning" />
						</div>
					)}
					<div className="flex-1 min-w-0">
						<p className="text-sm font-medium text-warning">
							{t("lock.blockedTitle", {
								name: blockedByUser.name ?? blockedByUser.email,
							})}
						</p>
						<p className="text-xs text-warning/80">
							{t("lock.blockedDescription")}
						</p>
					</div>
					<Icon icon="ph:lock-simple" className="size-5 text-warning" />
				</div>
			)}

			{/* Warning banner - show when same user has document open elsewhere */}
			{isOpenElsewhere && (
				<div className="flex items-center gap-3 p-3 mb-4 rounded-lg bg-info/10 border border-info/30">
					<Icon icon="ph:browser" className="size-5 text-info" />
					<p className="text-sm text-info">{t("lock.openElsewhere")}</p>
				</div>
			)}

			<FormProvider {...form}>
				{/* Manage server-side reactive field behaviors (compute, hidden, etc.) */}
				<ReactiveFieldsManager
					collection={collection}
					reactiveConfigs={reactiveConfigs}
					enabled={!isBlocked && !isSubmitting}
				/>
				<form
					onSubmit={(e) => {
						e.stopPropagation();
						if (isBlocked) {
							e.preventDefault();
							toast.error(t("lock.cannotSave"));
							return;
						}
						form.handleSubmit(onSubmit, (errors) => {
							console.warn("[FormView] Validation errors:", errors);
							toast.error(t("toast.validationFailed"), {
								description: t("toast.validationDescription"),
							});
						})(e);
					}}
					className="space-y-4"
				>
					{/* Header - Title, Meta & Actions */}
					<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-3 flex-wrap">
								<h1 className="text-2xl md:text-3xl font-extrabold tracking-tight truncate">
									{title}
								</h1>
								{localeOptions.length > 0 && (
									<LocaleSwitcher
										locales={localeOptions}
										value={contentLocale}
										onChange={setContentLocale}
									/>
								)}

								{/* Autosave status indicator */}
								{autoSaveConfig.indicator &&
									autoSaveConfig.enabled &&
									isEditMode && (
										<>
											{isSaving && (
												<Badge variant="secondary" className="gap-1.5">
													<Icon
														icon="ph:spinner-gap"
														className="size-3 animate-spin"
													/>
													{t("autosave.saving")}
												</Badge>
											)}
											{!isSaving && form.formState.isDirty && (
												<Badge variant="outline" className="gap-1.5">
													<Icon
														icon="ph:clock-counter-clockwise"
														className="size-3"
													/>
													{t("autosave.unsavedChanges")}
												</Badge>
											)}
											{!isSaving && !form.formState.isDirty && lastSaved && (
												<Badge
													variant="secondary"
													className="gap-1.5 text-muted-foreground"
												>
													<Icon icon="ph:check" className="size-3" />
													{t("autosave.saved")} {formatTimeAgo(lastSaved)}
												</Badge>
											)}
										</>
									)}
							</div>
							{/* Metadata - horizontal scroll on mobile */}
							{showMeta && item && (
								<div className="mt-1 overflow-x-auto no-scrollbar">
									<p className="text-xs text-muted-foreground font-mono flex items-center gap-2 whitespace-nowrap">
										<span className="opacity-60">{t("form.id")}:</span>
										<button
											type="button"
											className="hover:text-foreground transition-colors cursor-pointer"
											onClick={() => {
												navigator.clipboard.writeText(String(item.id)).then(
													() => toast.success(t("toast.idCopied")),
													() => toast.error(t("toast.copyFailed")),
												);
											}}
											title={t("common.copy")}
										>
											{item.id}
										</button>
										{item.createdAt && (
											<>
												<span className="opacity-40">·</span>
												<span>
													<span className="opacity-60">
														{t("form.created")}{" "}
													</span>
													{formatDate(item.createdAt)}
												</span>
											</>
										)}
										{item.updatedAt && (
											<>
												<span className="opacity-40">·</span>
												<span>
													<span className="opacity-60">
														{t("form.updated")}{" "}
													</span>
													{formatDate(item.updatedAt)}
												</span>
											</>
										)}
									</p>
								</div>
							)}
						</div>

						<div className="flex items-center gap-2 shrink-0 w-auto">
							{headerActions}

							{/* Live Preview button */}
							{hasPreview && (
								<Button
									type="button"
									variant="outline"
									size="icon"
									className="size-9"
									onClick={() => setIsLivePreviewOpen(true)}
									title={t("preview.livePreview")}
								>
									<Icon icon="ph:eye" className="size-4" />
									<span className="sr-only">{t("preview.livePreview")}</span>
								</Button>
							)}

							{/* Primary form actions as buttons */}
							{visiblePrimaryActions.map((action) => (
								<ActionButton
									key={action.id}
									action={action}
									collection={collection}
									helpers={actionHelpers}
									onOpenDialog={(a) => setDialogAction(a)}
								/>
							))}

							{/* Save button */}
							<Button
								type="submit"
								disabled={isSubmitting || !form.formState.isDirty}
								className="gap-2"
							>
								{isSubmitting ? (
									<>
										<Icon
											icon="ph:spinner-gap"
											className="size-4 animate-spin"
										/>
										{t("common.loading")}
									</>
								) : (
									<>
										<Icon icon="ph:check" width={16} height={16} />
										{t("common.save")}
									</>
								)}
							</Button>

							{/* Secondary form actions in dropdown */}
							{visibleSecondaryActions.length > 0 && (
								<DropdownMenu>
									<DropdownMenuTrigger
										render={
											<Button
												variant="outline"
												size="icon"
												className="size-9"
											/>
										}
									>
										<Icon icon="ph:dots-three-vertical" className="size-4" />
										<span className="sr-only">{t("common.moreActions")}</span>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										{regularSecondary.map((action) => {
											const iconElement = resolveIconElement(action.icon, {
												className: "mr-2 size-4",
											});
											return (
												<DropdownMenuItem
													key={action.id}
													onClick={() => handleActionClick(action)}
													disabled={actionLoading}
												>
													{iconElement}
													{resolveText(action.label)}
												</DropdownMenuItem>
											);
										})}

										{regularSecondary.length > 0 &&
											destructiveSecondary.length > 0 && (
												<DropdownMenuSeparator />
											)}

										{destructiveSecondary.map((action) => {
											const iconElement = resolveIconElement(action.icon, {
												className: "mr-2 size-4",
											});
											return (
												<DropdownMenuItem
													key={action.id}
													variant="destructive"
													onClick={() => handleActionClick(action)}
													disabled={actionLoading}
												>
													{iconElement}
													{resolveText(action.label)}
												</DropdownMenuItem>
											);
										})}
									</DropdownMenuContent>
								</DropdownMenu>
							)}
						</div>
					</div>

					{/* Main Content - Form Fields */}
					<AutoFormFields
						collection={collection as any}
						config={formConfigBridge}
						registry={registry}
						allCollectionsConfig={allCollectionsConfig}
					/>
				</form>
			</FormProvider>

			{/* Locale Change Confirmation Dialog */}
			<Dialog
				open={localeChangeDialog.open}
				onOpenChange={(open) => {
					if (!open) handleLocaleChangeCancel();
				}}
			>
				<DialogContent showCloseButton={false}>
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<Icon icon="ph:warning-fill" className="size-5 text-warning" />
							{t("confirm.localeChange")}
						</DialogTitle>
						<DialogDescription>
							{t("confirm.localeChangeDescription")}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={handleLocaleChangeCancel}>
							{t("confirm.localeChangeStay")}
						</Button>
						<Button variant="destructive" onClick={handleLocaleChangeConfirm}>
							{t("confirm.localeChangeDiscard")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Action Confirmation Dialog */}
			{confirmAction?.confirmation && (
				<ConfirmationDialog
					open={!!confirmAction}
					onOpenChange={(open) => !open && setConfirmAction(null)}
					config={confirmAction.confirmation}
					onConfirm={handleConfirm}
					loading={actionLoading}
				/>
			)}

			{/* Action Dialog (for form/dialog handlers) */}
			{dialogAction && (
				<ActionDialog
					open={!!dialogAction}
					onOpenChange={(open) => !open && setDialogAction(null)}
					action={dialogAction}
					collection={collection}
					item={transformedItem}
					helpers={actionHelpers}
				/>
			)}
		</>
	);

	return (
		<>
			<div className="w-full">{formContent}</div>

			{/* Live Preview Mode */}
			{hasPreview && previewUrl && (
				<LivePreviewMode
					open={isLivePreviewOpen}
					onClose={() => setIsLivePreviewOpen(false)}
					collection={collection}
					itemId={id}
					config={config}
					allCollectionsConfig={allCollectionsConfig}
					registry={registry}
					previewUrl={previewUrl}
					onSuccess={onSuccess}
				/>
			)}
		</>
	);
}
