/**
 * Form View - Default edit view component
 *
 * Renders collection item edit/create form with sections, tabs, validation.
 * This is the default edit view registered in the admin view registry.
 */

import { Icon } from "@iconify/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
	CollectionSchema,
	FieldReactiveSchema,
	FieldSchema,
} from "questpie/client";
import { QuestpieClientError } from "questpie/client";
import * as React from "react";
import { FormProvider, useForm, useFormState } from "react-hook-form";
import { toast } from "sonner";

import { createQuestpieQueryOptions } from "@questpie/tanstack-query";

import { getDefaultFormActions } from "../../builder/types/action-registry";
import type {
	ActionContext,
	ActionDefinition,
	ActionHelpers,
	ActionQueryClient,
} from "../../builder/types/action-types";
import type { CollectionBuilderState } from "../../builder/types/collection-types";
import type {
	ComponentRegistry,
	FormViewActionsConfig,
	FormViewConfig,
} from "../../builder/types/field-types";
import { ActionButton } from "../../components/actions/action-button";
import { ActionDialog } from "../../components/actions/action-dialog";
import { ConfirmationDialog } from "../../components/actions/confirmation-dialog";
import { resolveIconElement } from "../../components/component-renderer";
import { HistorySidebar } from "../../components/history-sidebar";
import { LocaleSwitcher } from "../../components/locale-switcher";
import { LivePreviewMode } from "../../components/preview/live-preview-mode";
import type { PreviewPaneRef } from "../../components/preview/preview-pane";
import { DateTimeInput } from "../../components/primitives/date-input";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
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
import { EmptyState } from "../../components/ui/empty-state";
import { Label } from "../../components/ui/label";
import { scrollFieldIntoView } from "../../contexts/focus-context";
import {
	useCollectionValidation,
	usePreferServerValidation,
	useSearchParamToggle,
	useSidebarSearchParam,
} from "../../hooks";
import {
	useCollectionCreate,
	useCollectionDelete,
	useCollectionItem,
	useCollectionRestore,
	useCollectionRevertVersion,
	useCollectionUpdate,
	useCollectionVersions,
} from "../../hooks/use-collection";
import { useCollectionFields } from "../../hooks/use-collection-fields";
import { getLockUser, useLock } from "../../hooks/use-locks";
import { useReactiveFields } from "../../hooks/use-reactive-fields";
import { useServerActions } from "../../hooks/use-server-actions";
import { useTransitionStage } from "../../hooks/use-transition-stage";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import { RenderProfiler } from "../../lib/render-profiler.js";
import type {
	FieldValueEditedMessage,
	PreviewPatchOp,
} from "../../preview/types";
import {
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
import { shouldHandleAdminShortcut } from "../../utils/keyboard-shortcuts";
import { AdminViewHeader } from "../layout/admin-view-layout";
import { AutoFormFields } from "./auto-form-fields";
import { FormViewSkeleton } from "./view-skeletons";

// ============================================================================
// Constants
// ============================================================================

/** Query key prefix for app queries (used for cache invalidation) */
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== "object") return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function clonePreviewSnapshot<T>(value: T): T {
	if (typeof structuredClone === "function") {
		try {
			return structuredClone(value);
		} catch {
			// Fall through to JSON clone for form values that are JSON-shaped.
		}
	}

	const json = JSON.stringify(value);
	return json === undefined ? value : (JSON.parse(json) as T);
}

function arePreviewValuesEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;

	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
			return false;
		}
		return a.every((value, index) => arePreviewValuesEqual(value, b[index]));
	}

	if (isPlainObject(a) || isPlainObject(b)) {
		if (!isPlainObject(a) || !isPlainObject(b)) return false;
		const aKeys = Object.keys(a);
		const bKeys = Object.keys(b);
		if (aKeys.length !== bKeys.length) return false;
		return aKeys.every(
			(key) =>
				Object.prototype.hasOwnProperty.call(b, key) &&
				arePreviewValuesEqual(a[key], b[key]),
		);
	}

	return false;
}

function joinPreviewPath(basePath: string, key: string): string {
	return basePath ? `${basePath}.${key}` : key;
}

function diffPreviewSnapshots(
	previous: unknown,
	current: unknown,
	basePath = "",
): PreviewPatchOp[] {
	if (arePreviewValuesEqual(previous, current)) {
		return [];
	}

	if (isPlainObject(previous) && isPlainObject(current)) {
		const ops: PreviewPatchOp[] = [];
		const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);

		for (const key of keys) {
			const path = joinPreviewPath(basePath, key);
			const previousHasKey = Object.prototype.hasOwnProperty.call(
				previous,
				key,
			);
			const currentHasKey = Object.prototype.hasOwnProperty.call(current, key);

			if (!currentHasKey) {
				ops.push({ op: "remove", path });
				continue;
			}

			if (!previousHasKey) {
				ops.push({ op: "set", path, value: current[key] });
				continue;
			}

			ops.push(...diffPreviewSnapshots(previous[key], current[key], path));
		}

		return ops;
	}

	if (!basePath) {
		return [{ op: "set", path: "", value: current }];
	}

	return [{ op: "set", path: basePath, value: current }];
}

function isSafePreviewEditPath(path: string): boolean {
	if (!path || path.length > 512) return false;
	return path
		.split(".")
		.every(
			(segment) =>
				segment.length > 0 &&
				segment !== "__proto__" &&
				segment !== "prototype" &&
				segment !== "constructor",
		);
}

function hasValueAtPath(value: unknown, path: string): boolean {
	let current = value;
	for (const segment of path.split(".")) {
		if (!current || typeof current !== "object") return false;
		if (!Object.prototype.hasOwnProperty.call(current, segment)) return false;
		current = (current as Record<string, unknown>)[segment];
	}
	return true;
}

function getTopLevelFieldSchema(
	schema: CollectionSchema | undefined,
	path: string,
): FieldSchema | undefined {
	const topLevelField = path.split(".")[0];
	if (!topLevelField) return undefined;
	return schema?.fields?.[topLevelField];
}

function fieldSupportsInlineEdit(
	field: FieldSchema,
	path: string,
	inputKind: FieldValueEditedMessage["inputKind"],
): boolean {
	const fieldType = field.metadata?.type;
	const isNestedPath = path.includes(".");

	if (fieldType === "object" || fieldType === "json") {
		return isNestedPath;
	}

	switch (inputKind) {
		case "text":
			return (
				fieldType === "text" ||
				fieldType === "email" ||
				fieldType === "url" ||
				fieldType === "select"
			);
		case "textarea":
			return (
				fieldType === "textarea" ||
				fieldType === "richText" ||
				fieldType === "text"
			);
		case "number":
			return fieldType === "number";
		case "boolean":
			return fieldType === "boolean";
	}
}

function isAllowedPreviewEditPath({
	message,
	schema,
	values,
}: {
	message: FieldValueEditedMessage;
	schema: CollectionSchema | undefined;
	values: Record<string, unknown>;
}): boolean {
	if (!schema || !isSafePreviewEditPath(message.path)) return false;
	if (message.fieldType === "relation") return false;

	const blockMatch = message.path.match(/^([^.]+)\._values\.([^.]+)\.(.+)$/);
	if (blockMatch) {
		const [, blocksFieldName, blockId] = blockMatch;
		const blocksField = schema.fields?.[blocksFieldName];
		if (blocksField?.metadata?.type !== "blocks") return false;
		if (message.blockId && message.blockId !== blockId) return false;
		return hasValueAtPath(values, message.path);
	}

	const field = getTopLevelFieldSchema(schema, message.path);
	if (!field) return false;
	if (field.metadata?.readOnly || field.access?.update?.allowed === false) {
		return false;
	}
	if (message.path.includes(".") && !hasValueAtPath(values, message.path)) {
		return false;
	}
	return fieldSupportsInlineEdit(field, message.path, message.inputKind);
}

function normalizeInlineEditValue(
	message: FieldValueEditedMessage,
): { ok: true; value: unknown } | { ok: false } {
	switch (message.inputKind) {
		case "text":
		case "textarea":
			return typeof message.value === "string"
				? { ok: true, value: message.value }
				: { ok: false };
		case "number": {
			const value =
				typeof message.value === "number"
					? message.value
					: typeof message.value === "string"
						? Number(message.value)
						: Number.NaN;
			return Number.isFinite(value) ? { ok: true, value } : { ok: false };
		}
		case "boolean":
			return typeof message.value === "boolean"
				? { ok: true, value: message.value }
				: { ok: false };
	}
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

type FormFieldsContentProps = {
	collection: string;
	config: Partial<CollectionBuilderState> | Record<string, any> | undefined;
	registry?: ComponentRegistry;
	allCollectionsConfig?: Record<
		string,
		Partial<CollectionBuilderState> | Record<string, any>
	>;
};

const FormFieldsContent = React.memo(function FormFieldsContent({
	collection,
	config,
	registry,
	allCollectionsConfig,
}: FormFieldsContentProps) {
	return (
		<RenderProfiler id={`form.fields.${collection}`} minDurationMs={10}>
			<AutoFormFields
				collection={collection as any}
				config={config as any}
				registry={registry}
				allCollectionsConfig={allCollectionsConfig as any}
			/>
		</RenderProfiler>
	);
});

type FormStateRefBridgeProps = {
	control: ReturnType<typeof useForm>["control"];
	onDirtyChange: (isDirty: boolean) => void;
	onSubmittingChange: (isSubmitting: boolean) => void;
};

const FormStateRefBridge = React.memo(function FormStateRefBridge({
	control,
	onDirtyChange,
	onSubmittingChange,
}: FormStateRefBridgeProps) {
	const { isDirty, isSubmitting } = useFormState({ control });

	React.useEffect(() => {
		onDirtyChange(isDirty);
	}, [isDirty, onDirtyChange]);

	React.useEffect(() => {
		onSubmittingChange(isSubmitting);
	}, [isSubmitting, onSubmittingChange]);

	return null;
});

type PreviewPatchBridgeProps = {
	form: ReturnType<typeof useForm>;
	previewRef: React.RefObject<PreviewPaneRef | null>;
	enabled: boolean;
};

const PreviewPatchBridge = React.memo(function PreviewPatchBridge({
	form,
	previewRef,
	enabled,
}: PreviewPatchBridgeProps) {
	const previousSnapshotRef = React.useRef<Record<string, unknown> | null>(
		null,
	);
	const snapshotVersionRef = React.useRef<number | undefined>(undefined);

	React.useEffect(() => {
		if (!enabled) {
			previousSnapshotRef.current = null;
			snapshotVersionRef.current = undefined;
			return;
		}

		const initialSnapshot = clonePreviewSnapshot(
			form.getValues() as Record<string, unknown>,
		);
		previousSnapshotRef.current = initialSnapshot;
		snapshotVersionRef.current =
			previewRef.current?.sendInitSnapshot(initialSnapshot);

		const subscription = form.watch((values) => {
			const previousSnapshot = previousSnapshotRef.current;
			const nextSnapshot = clonePreviewSnapshot(
				values as Record<string, unknown>,
			);

			if (!previousSnapshot) {
				previousSnapshotRef.current = nextSnapshot;
				snapshotVersionRef.current =
					previewRef.current?.sendInitSnapshot(nextSnapshot);
				return;
			}

			const ops = diffPreviewSnapshots(previousSnapshot, nextSnapshot).filter(
				(op) => op.path,
			);

			previousSnapshotRef.current = nextSnapshot;
			if (ops.length === 0) return;

			previewRef.current?.sendPatchBatch(ops, snapshotVersionRef.current);
		});

		return () => {
			subscription.unsubscribe();
		};
	}, [enabled, form, previewRef]);

	return null;
});

type AutosaveManagerProps = {
	form: ReturnType<typeof useForm>;
	formElementRef: React.RefObject<HTMLFormElement | null>;
	isEditMode: boolean;
	id?: string;
	enabled: boolean;
	debounce: number;
	isDirtyRef: React.MutableRefObject<boolean>;
	isSubmittingRef: React.MutableRefObject<boolean>;
	updateMutation: { mutateAsync: (args: any) => Promise<any> };
	onPreviewRefresh?: () => void;
	onPreviewCommit?: (data: unknown) => void;
	onSavingChange: (isSaving: boolean) => void;
	onSaved: (savedAt: Date) => void;
};

const AutosaveManager = React.memo(function AutosaveManager({
	form,
	formElementRef,
	isEditMode,
	id,
	enabled,
	debounce,
	isDirtyRef,
	isSubmittingRef,
	updateMutation,
	onPreviewRefresh,
	onPreviewCommit,
	onSavingChange,
	onSaved,
}: AutosaveManagerProps) {
	const { t } = useTranslation();
	const timerRef = React.useRef<NodeJS.Timeout | null>(null);

	const runAutosave = React.useCallback(async () => {
		if (!id || !isDirtyRef.current || isSubmittingRef.current) {
			return;
		}

		try {
			onSavingChange(true);

			await form.handleSubmit(
				async (data) => {
					const result = await updateMutation.mutateAsync({
						id,
						data,
					});

					form.reset(result as any, { keepTouched: true });

					onPreviewCommit?.(result);
					onPreviewRefresh?.();

					onSaved(new Date());
					onSavingChange(false);
				},
				() => {
					onSavingChange(false);
				},
			)();
		} catch (error) {
			onSavingChange(false);
			console.error("Autosave failed:", error);
			toast.error(t("error.autosaveFailed"), {
				description: error instanceof Error ? error.message : undefined,
			});
		}
	}, [
		form,
		id,
		isDirtyRef,
		isSubmittingRef,
		onSaved,
		onSavingChange,
		onPreviewCommit,
		onPreviewRefresh,
		t,
		updateMutation,
	]);

	React.useEffect(() => {
		if (timerRef.current) {
			clearTimeout(timerRef.current);
		}

		if (!enabled || !isEditMode || !id) {
			return;
		}

		const target = formElementRef.current;
		if (!target) {
			return;
		}

		const scheduleAutosave = () => {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
			}

			timerRef.current = setTimeout(() => {
				void runAutosave();
			}, debounce);
		};

		target.addEventListener("input", scheduleAutosave, { capture: true });
		target.addEventListener("change", scheduleAutosave, { capture: true });

		return () => {
			target.removeEventListener("input", scheduleAutosave, { capture: true });
			target.removeEventListener("change", scheduleAutosave, {
				capture: true,
			});

			if (timerRef.current) {
				clearTimeout(timerRef.current);
			}
		};
	}, [debounce, enabled, formElementRef, id, isEditMode, runAutosave]);

	return null;
});

type AutosaveIndicatorProps = {
	control: ReturnType<typeof useForm>["control"];
	enabled: boolean;
	indicator: boolean;
	isEditMode: boolean;
	isSaving: boolean;
	lastSaved: Date | null;
	formatTimeAgo: (date: Date) => string;
	t: ReturnType<typeof useTranslation>["t"];
};

const AutosaveIndicator = React.memo(function AutosaveIndicator({
	control,
	enabled,
	indicator,
	isEditMode,
	isSaving,
	lastSaved,
	formatTimeAgo,
	t,
}: AutosaveIndicatorProps) {
	const { isDirty } = useFormState({ control });
	const [, forceUpdate] = React.useReducer((x) => x + 1, 0);

	React.useEffect(() => {
		if (!lastSaved) {
			return;
		}

		const interval = setInterval(forceUpdate, 10000);
		return () => clearInterval(interval);
	}, [lastSaved]);

	if (!enabled || !indicator || !isEditMode) {
		return null;
	}

	if (isSaving) {
		return (
			<Badge variant="secondary" className="gap-1.5">
				<Icon icon="ph:spinner-gap" className="size-3 animate-spin" />
				{t("autosave.saving")}
			</Badge>
		);
	}

	if (isDirty) {
		return (
			<Badge variant="outline" className="gap-1.5">
				<Icon icon="ph:clock-counter-clockwise" className="size-3" />
				{t("autosave.unsavedChanges")}
			</Badge>
		);
	}

	if (lastSaved) {
		return (
			<Badge variant="secondary" className="text-muted-foreground gap-1.5">
				<Icon icon="ph:check" className="size-3" />
				{t("autosave.saved")} {formatTimeAgo(lastSaved)}
			</Badge>
		);
	}

	return null;
});

type SaveSubmitButtonProps = {
	control: ReturnType<typeof useForm>["control"];
	isMutationPending: boolean;
	t: ReturnType<typeof useTranslation>["t"];
};

const SaveSubmitButton = React.memo(function SaveSubmitButton({
	control,
	isMutationPending,
	t,
}: SaveSubmitButtonProps) {
	const { isDirty, isSubmitting } = useFormState({ control });
	const isSubmittingNow = isMutationPending || isSubmitting;

	return (
		<Button
			type="submit"
			size="sm"
			disabled={isSubmittingNow || !isDirty}
			className="gap-2"
		>
			{isSubmittingNow ? (
				<>
					<Icon icon="ph:spinner-gap" className="size-4 animate-spin" />
					{t("common.loading")}
				</>
			) : (
				<>
					<Icon icon="ph:check" width={16} height={16} />
					{t("common.save")}
				</>
			)}
		</Button>
	);
});

// ============================================================================
// Types
// ============================================================================

/**
 * Form view configuration from registry.
 *
 * Re-exports FormViewConfig for type consistency between builder and component.
 */
type FormViewRegistryConfig = FormViewConfig;

/**
 * Props for FormView component
 */
interface FormViewProps {
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
	const isEditMode = !!id;
	const {
		fields: resolvedFields,
		schema,
		isLoading: isFieldsLoading,
	} = useCollectionFields(collection, {
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

	// Preview configuration from introspected schema (server-side .preview() config)
	// Note: url function cannot be serialized, so we use hasUrlBuilder flag + RPC
	const schemaPreview = schema?.admin?.preview;
	const hasPreview =
		!!schemaPreview?.hasUrlBuilder && schemaPreview?.enabled !== false;
	const canUseLivePreview = hasPreview && isEditMode && !!id;
	const previewSearchParamOptions = React.useMemo(
		() => ({ legacyKeys: [{ key: "sidebar", trueValue: "preview" }] }),
		[],
	);
	const [isLivePreviewOpen, setIsLivePreviewOpen] = useSearchParamToggle(
		"preview",
		previewSearchParamOptions,
	);
	const [isHistoryOpen, setIsHistoryOpen] = useSidebarSearchParam("history", {
		legacyKey: "history",
	});
	const previewRef = React.useRef<PreviewPaneRef>(null);
	const triggerPreviewRefresh = React.useCallback(() => {
		if (!isLivePreviewOpen) return;
		previewRef.current?.triggerRefresh();
	}, [isLivePreviewOpen]);

	// Create mode (or missing id) should never keep preview open.
	// Also wait for schema to load — prevents clearing ?preview on page refresh before
	// we know if the collection supports preview.
	React.useEffect(() => {
		if (!schema) return;
		if (!canUseLivePreview && isLivePreviewOpen) {
			setIsLivePreviewOpen(false);
		}
	}, [canUseLivePreview, isLivePreviewOpen, setIsLivePreviewOpen, schema]);

	// Create mode should never keep history sidebar open
	React.useEffect(() => {
		if ((!isEditMode || !id) && isHistoryOpen) {
			setIsHistoryOpen(false);
		}
	}, [isEditMode, id, isHistoryOpen, setIsHistoryOpen]);

	// Auto-detect M:N relations that need to be included when fetching
	const withRelations = React.useMemo(
		() => detectManyToManyRelations({ fields: resolvedFields, schema }),
		[resolvedFields, schema],
	);

	// Fetch item if in edit mode (include relations if specified)
	const {
		data: item,
		isLoading,
		error: itemError,
	} = useCollectionItem(
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
	const restoreMutation = useCollectionRestore(collection as any);
	const revertVersionMutation = useCollectionRevertVersion(collection as any);

	const [pendingRevertVersion, setPendingRevertVersion] =
		React.useState<any>(null);

	const { data: versionsData, isLoading: versionsLoading } =
		useCollectionVersions(
			collection as any,
			id ?? "",
			{ limit: 50 },
			{
				enabled:
					isEditMode && !!id && isHistoryOpen && !!schema?.options?.versioning,
			},
		);

	// ========================================================================
	// Workflow — stage badge, transition dropdown, scheduling
	// ========================================================================

	const workflowConfig = schema?.options?.workflow as
		| {
				enabled: boolean;
				initialStage: string;
				stages: Array<{
					name: string;
					label?: string;
					description?: string;
					transitions?: string[];
				}>;
		  }
		| undefined;
	const workflowEnabled = !!workflowConfig?.enabled;

	/**
	 * Lightweight versions query (limit: 1) just to read the current
	 * `versionStage`. Runs whenever workflow is enabled and we have an item id.
	 * The full 50-version query is still lazy-loaded behind the History sidebar.
	 */
	const { data: latestVersionData } = useCollectionVersions(
		collection as any,
		id ?? "",
		{ limit: 1 },
		{ enabled: workflowEnabled && isEditMode && !!id },
	);

	const currentStage =
		(latestVersionData as any)?.[0]?.versionStage ??
		workflowConfig?.initialStage ??
		null;

	const currentStageConfig = React.useMemo(
		() => workflowConfig?.stages?.find((s) => s.name === currentStage) ?? null,
		[workflowConfig?.stages, currentStage],
	);

	const currentStageLabel = currentStageConfig?.label ?? currentStage ?? "";

	/**
	 * Allowed transitions from the current stage.
	 * If the stage defines explicit `transitions`, only those are reachable.
	 * Otherwise fall back to all other stages (unrestricted).
	 */
	const allowedTransitions = React.useMemo(() => {
		if (!workflowConfig?.stages || !currentStage) return [];
		const stageNames = currentStageConfig?.transitions;
		if (stageNames && stageNames.length > 0) {
			return stageNames
				.map((name) => workflowConfig.stages.find((s) => s.name === name))
				.filter(Boolean) as typeof workflowConfig.stages;
		}
		// Unrestricted — all stages except the current one
		return workflowConfig.stages.filter((s) => s.name !== currentStage);
	}, [workflowConfig, currentStage, currentStageConfig]);

	// Transition mutation
	const transitionMutation = useTransitionStage(collection);

	// Dialog state for workflow transitions
	const [transitionTarget, setTransitionTarget] = React.useState<{
		name: string;
		label?: string;
	} | null>(null);
	const [transitionSchedule, setTransitionSchedule] = React.useState(false);
	const [transitionScheduledAt, setTransitionScheduledAt] =
		React.useState<Date | null>(null);

	// Get validation resolver - prefer server validation (AJV with JSON Schema) over client validation
	const validationMode = isEditMode ? "update" : "create";
	const hasServerValidationSchema =
		validationMode === "update"
			? !!schema?.validation?.update
			: !!schema?.validation?.insert;
	const shouldBuildClientResolver =
		!isFieldsLoading && !hasServerValidationSchema;
	const clientResolver = useCollectionValidation(collection, {
		enabled: shouldBuildClientResolver,
	});
	const resolver = usePreferServerValidation(
		collection,
		{ mode: validationMode, schema },
		clientResolver,
	);

	const form = useForm({
		defaultValues: (transformedItem ?? defaultValuesProp ?? {}) as any,
		resolver,
		mode: "onBlur",
	});

	const commitPreviewSnapshot = React.useCallback(
		(data: unknown) => {
			if (!isLivePreviewOpen) return;
			previewRef.current?.sendCommit(clonePreviewSnapshot(data));
		},
		[isLivePreviewOpen],
	);

	const triggerPreviewFullResync = React.useCallback(
		(reason?: string) => {
			if (!isLivePreviewOpen) return;
			previewRef.current?.sendFullResync(reason);
			previewRef.current?.triggerRefresh();
		},
		[isLivePreviewOpen],
	);

	const handlePreviewFieldValueEdited = React.useCallback(
		(message: FieldValueEditedMessage) => {
			const values = form.getValues() as Record<string, unknown>;
			if (!isAllowedPreviewEditPath({ message, schema, values })) {
				return;
			}

			const normalized = normalizeInlineEditValue(message);
			if (!normalized.ok) {
				return;
			}

			form.setValue(message.path as any, normalized.value as any, {
				shouldDirty: true,
				shouldTouch: true,
				shouldValidate: true,
			});

			setTimeout(() => scrollFieldIntoView(message.path), 0);
		},
		[form, schema],
	);

	const handlePreviewResyncRequest = React.useCallback(
		(reason?: string) => {
			triggerPreviewFullResync(reason ?? "preview-request");
		},
		[triggerPreviewFullResync],
	);

	/**
	 * Execute the confirmed workflow transition (immediate or scheduled).
	 */
	const confirmTransition = () => {
		if (!transitionTarget || !id) return;

		const params: { id: string; stage: string; scheduledAt?: Date } = {
			id,
			stage: transitionTarget.name,
		};
		if (transitionSchedule) {
			if (transitionScheduledAt) {
				params.scheduledAt = transitionScheduledAt;
			}
		}

		const stageLabel = transitionTarget.label
			? transitionTarget.label
			: transitionTarget.name;

		const resetTransitionState = () => {
			setTransitionTarget(null);
			setTransitionSchedule(false);
			setTransitionScheduledAt(null);
		};

		transitionMutation.mutateAsync(params).then(
			(result) => {
				if (result) {
					if (typeof result === "object") {
						if ("id" in result) {
							form.reset(result as any);
						}
					}
				}
				triggerPreviewFullResync("workflow-transition");

				if (transitionSchedule) {
					if (transitionScheduledAt) {
						toast.success(
							t("workflow.scheduledSuccess", {
								stage: stageLabel,
								date: transitionScheduledAt.toLocaleString(),
							}),
						);
					} else {
						toast.success(
							t("workflow.transitionSuccess", {
								stage: stageLabel,
							}),
						);
					}
				} else {
					toast.success(
						t("workflow.transitionSuccess", {
							stage: stageLabel,
						}),
					);
				}
				resetTransitionState();
			},
			(err) => {
				let description: string;
				if (err instanceof Error) {
					description = err.message;
				} else {
					description = t("error.unknown");
				}
				toast.error(t("workflow.transitionFailed"), {
					description,
				});
				resetTransitionState();
			},
		);
	};

	// Autosave state
	const [isSaving, setIsSaving] = React.useState(false);
	const [lastSaved, setLastSaved] = React.useState<Date | null>(null);
	const formElementRef = React.useRef<HTMLFormElement | null>(null);
	const formIsDirtyRef = React.useRef(false);
	const formIsSubmittingRef = React.useRef(false);

	// Get autosave config from collection config
	const autoSaveConfig = React.useMemo(() => {
		const cfg = (config as any)?.autoSave;
		if (!cfg) {
			return {
				enabled: false,
				debounce: 500,
				indicator: false,
				preventNavigation: false,
			};
		}
		return {
			enabled: cfg.enabled !== false,
			debounce: cfg.debounce ?? 500,
			indicator: cfg.indicator !== false,
			preventNavigation: cfg.preventNavigation !== false,
		};
	}, [config]);

	// Track content locale changes to warn about unsaved changes
	// Uses scoped locale (isolated in ResourceSheet) or global locale
	const { locale: contentLocale, setLocale: setContentLocale } =
		useScopedLocale();
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

	const handleFormDirtyChange = React.useCallback((isDirty: boolean) => {
		formIsDirtyRef.current = isDirty;
	}, []);

	const handleFormSubmittingChange = React.useCallback(
		(isSubmitting: boolean) => {
			formIsSubmittingRef.current = isSubmitting;
		},
		[],
	);

	// Detect locale change and show confirmation dialog if form is dirty
	React.useEffect(() => {
		if (!isEditMode) {
			prevLocaleRef.current = contentLocale;
			return;
		}
		if (prevLocaleRef.current !== contentLocale) {
			if (formIsDirtyRef.current && !localeChangeDialog.open) {
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
		form,
		setContentLocale,
		localeChangeDialog.open,
		isEditMode,
	]);

	// Reset form when item loads
	React.useEffect(() => {
		if (skipItemResetRef.current || isLoading) return;
		if (transformedItem) {
			form.reset(transformedItem as any);
		} else if (!isEditMode && defaultValuesProp) {
			form.reset(defaultValuesProp as any);
		}
	}, [form, transformedItem, defaultValuesProp, isLoading, isEditMode]);

	// Handle locale change confirmation - invalidate queries so fresh locale data loads
	const localeQueryClient = useQueryClient();
	const handleLocaleChangeConfirm = React.useCallback(() => {
		skipItemResetRef.current = false;
		localeChangeSnapshotRef.current = null;
		if (localeChangeDialog.pendingLocale) {
			prevLocaleRef.current = localeChangeDialog.pendingLocale;
			setContentLocale(localeChangeDialog.pendingLocale);
			// Invalidate item query to refetch with new locale
			localeQueryClient.invalidateQueries({
				queryKey: ["collections", collection],
			});
			triggerPreviewFullResync("locale-change");
		}
		setLocaleChangeDialog({ open: false, pendingLocale: null });
	}, [
		localeChangeDialog.pendingLocale,
		setContentLocale,
		localeQueryClient,
		collection,
		triggerPreviewFullResync,
	]);

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

	const handleLocaleDialogOpenChange = React.useCallback(
		(open: boolean) => {
			if (!open) {
				handleLocaleChangeCancel();
			}
		},
		[handleLocaleChangeCancel],
	);

	const onSubmit = React.useEffectEvent(async (data: any) => {
		const savePromise = async () => {
			if (isEditMode && id) {
				return await updateMutation.mutateAsync({
					id,
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

						commitPreviewSnapshot(result);
						// Trigger preview refresh after successful save
						triggerPreviewRefresh();
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

	// Prevent navigation when there are unsaved changes
	React.useEffect(() => {
		if (!autoSaveConfig.preventNavigation || !autoSaveConfig.enabled) return;

		const handleBeforeUnload = (e: BeforeUnloadEvent) => {
			if (formIsDirtyRef.current) {
				e.preventDefault();
				e.returnValue = "";
			}
		};

		window.addEventListener("beforeunload", handleBeforeUnload);
		return () => window.removeEventListener("beforeunload", handleBeforeUnload);
	}, [autoSaveConfig.preventNavigation, autoSaveConfig.enabled]);

	const onSubmitRef = React.useRef(onSubmit);
	React.useEffect(() => {
		onSubmitRef.current = onSubmit;
	});

	// Keyboard shortcut: Cmd+S to save
	React.useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (
				shouldHandleAdminShortcut(e, {
					allowEditableTarget: true,
					key: "s",
				})
			) {
				e.preventDefault();
				e.stopPropagation();
				form.handleSubmit(onSubmitRef.current, (errors) => {
					console.warn("[FormView] Validation errors:", errors);
					toast.error(t("toast.validationFailed"));
				})();
			}
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [form, t]);

	const isMutationPending =
		createMutation.isPending || updateMutation.isPending;

	// ========================================================================
	// Form Actions
	// ========================================================================

	// Get form actions from config or use defaults (only for edit mode)
	const configFormActions: FormViewActionsConfig | undefined = (
		resolvedFormConfig as any
	)?.actions;

	const { serverActions } = useServerActions({ collection, schema });

	const scopedServerFormActions = React.useMemo(
		() =>
			isEditMode
				? serverActions.filter((action) => {
						const scope = (action as any).scope;
						return scope === "single" || scope === "row";
					})
				: [],
		[isEditMode, serverActions],
	);

	// Use defaults if no actions defined and in edit mode
	// In create mode, we don't show duplicate/delete actions
	const formActions: FormViewActionsConfig = React.useMemo(() => {
		const base =
			configFormActions ??
			(!isEditMode ? { primary: [], secondary: [] } : getDefaultFormActions());

		const primary = [...(base.primary ?? [])];
		const secondary = [...(base.secondary ?? [])];
		const existingIds = new Set([...primary, ...secondary].map((a) => a.id));

		for (const action of scopedServerFormActions) {
			if (existingIds.has(action.id)) continue;
			secondary.push(action as ActionDefinition);
			existingIds.add(action.id);
		}

		return {
			primary,
			secondary,
		};
	}, [configFormActions, isEditMode, scopedServerFormActions]);

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
				// Invalidate all queries
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
			t,
			collection,
			queryClient,
			queryOpts,
			contentLocale,
			storeBasePath,
			basePath,
		],
	);

	// Action context for visibility/disabled checks
	// Use ref for transformedItem to avoid re-computing action visibility on every field change
	const transformedItemRef = React.useRef(transformedItem);
	transformedItemRef.current = transformedItem;

	const actionContext: ActionContext = React.useMemo(
		() => ({
			get item() {
				return transformedItemRef.current;
			},
			collection,
			helpers: actionHelpers,
			queryClient: actionQueryClient,
		}),
		[collection, actionHelpers, actionQueryClient],
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
		() => filterVisibleActions(formActions.primary),
		[formActions.primary, filterVisibleActions],
	);

	const visibleSecondaryActions = React.useMemo(
		() => filterVisibleActions(formActions.secondary),
		[formActions.secondary, filterVisibleActions],
	);

	// Group secondary by variant
	const regularSecondary = visibleSecondaryActions.filter(
		(a) => a.variant !== "destructive",
	);
	const destructiveSecondary = visibleSecondaryActions.filter(
		(a) => a.variant === "destructive",
	);

	// Execute action
	const executeAction = async (action: ActionDefinition) => {
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
				if (handler.method === "POST" && handler.endpoint === "{id}/restore") {
					const itemId = transformedItem?.id || id;
					if (!itemId) {
						toast.error(t("collection.restoreError"));
						break;
					}

					setActionLoading(true);
					toast.promise(
						restoreMutation.mutateAsync({ id: itemId }).finally(() => {
							setActionLoading(false);
						}),
						{
							loading: t("collection.restoring"),
							success: t("collection.restoreSuccess"),
							error: (err) => err.message || t("collection.restoreError"),
						},
					);
					break;
				}

				// For DELETE operations, use the deleteMutation hook
				if (handler.method === "DELETE") {
					const itemId = transformedItem?.id || id;
					if (!itemId) {
						toast.error(t("toast.deleteFailed"));
						break;
					}

					setActionLoading(true);
					toast.promise(
						deleteMutation.mutateAsync({ id: itemId }).finally(() => {
							setActionLoading(false);
						}),
						{
							loading: t("toast.deleting"),
							success: () => {
								storeNavigate(
									`${storeBasePath || basePath}/collections/${collection}`,
								);
								return t("toast.deleteSuccess");
							},
							error: (err) => err.message || t("toast.deleteFailed"),
						},
					);
				} else {
					// For other API operations, make a fetch request
					// (This is a fallback - most actions should use custom handlers)
					let itemId_: string;
					if (transformedItem?.id) {
						itemId_ = String(transformedItem.id);
					} else {
						itemId_ = String(id);
					}
					const endpoint = handler.endpoint.replace("{id}", itemId_);
					const method = handler.method ? handler.method : "POST";
					let body: string | undefined;
					if (handler.body) {
						body = JSON.stringify(handler.body(actionContext));
					}
					setActionLoading(true);
					const apiPromise = async () => {
						// Build the URL using API path
						const url = `${storeBasePath}/${collection}/${endpoint}`;
						const response = await fetch(url, {
							method,
							headers: { "Content-Type": "application/json" },
							body,
						});

						if (!response.ok) {
							let errorBody: Record<string, unknown> = {};
							try {
								errorBody = await response.json();
							} catch {
								// ignore parse errors
							}
							let errorMessage: string;
							if (errorBody.message) {
								if (typeof errorBody.message === "string") {
									errorMessage = errorBody.message;
								} else {
									errorMessage = t("toast.actionFailed");
								}
							} else {
								errorMessage = t("toast.actionFailed");
							}
							throw new Error(errorMessage);
						}
						return response.json();
					};

					const p = apiPromise();
					p.then(
						() => setActionLoading(false),
						() => setActionLoading(false),
					);
					toast.promise(p, {
						loading: `${actionLabel}...`,
						success: t("toast.actionSuccess"),
						error: (err: any) => {
							if (err.message) return err.message;
							return t("toast.actionFailed");
						},
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
			case "server": {
				const serverHandler = handler as {
					type: "server";
					actionId: string;
					collection: string;
				};
				setActionLoading(true);
				try {
					const routes = (client as any)?.routes;
					if (!routes?.executeAction) {
						throw new Error(t("error.serverActionFailed"));
					}
					const response = await routes.executeAction({
						collection: serverHandler.collection,
						actionId: serverHandler.actionId,
						itemId: transformedItem?.id || id,
					});
					if (!response?.success || response.result?.type === "error") {
						throw new Error(
							response?.error ??
								response?.result?.toast?.message ??
								t("error.serverActionFailed"),
						);
					}
					const result = response.result;
					if (result?.toast?.message) {
						toast.success(result.toast.message);
					} else {
						toast.success(t("toast.actionSuccess"));
					}
					if (result?.effects?.invalidate === true) {
						await actionHelpers.invalidateAll();
					} else if (Array.isArray(result?.effects?.invalidate)) {
						for (const col of result.effects.invalidate) {
							await actionHelpers.invalidateCollection(col);
						}
					}
					if (result?.effects?.redirect) {
						storeNavigate(result.effects.redirect);
					}
					if (result?.type === "redirect" && result.url) {
						if (result.external) {
							window.open(result.url, "_blank");
						} else {
							storeNavigate(result.url);
						}
					}
					if (result?.effects?.closeModal) {
						actionHelpers.closeDialog();
					}
				} catch (error) {
					toast.error(
						error instanceof Error ? error.message : t("error.actionFailed"),
					);
				} finally {
					setActionLoading(false);
				}
				break;
			}
		}
		setConfirmAction(null);
	};

	const handleRevertVersion = (version: any) => {
		setPendingRevertVersion(version);
	};

	const confirmRevertVersion = async () => {
		if (!pendingRevertVersion || !id) return;

		const payload: { id: string; version?: number; versionId?: string } = {
			id,
		};
		if (typeof pendingRevertVersion.versionId === "string") {
			payload.versionId = pendingRevertVersion.versionId;
		} else if (typeof pendingRevertVersion.versionNumber === "number") {
			payload.version = pendingRevertVersion.versionNumber;
		}

		const result = await revertVersionMutation.mutateAsync(payload);
		form.reset(result as any);
		triggerPreviewFullResync("version-revert");
		toast.success(t("version.revertSuccess"));
		setPendingRevertVersion(null);
	};

	// Handle action click
	const handleActionClick = (action: ActionDefinition) => {
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
	};

	// Handle confirmation
	const handleConfirm = async () => {
		if (confirmAction) {
			await executeAction(confirmAction);
		}
	};

	const handleConfirmActionOpenChange = React.useCallback((open: boolean) => {
		if (!open) {
			setConfirmAction(null);
		}
	}, []);

	const handleActionDialogOpenChange = React.useCallback((open: boolean) => {
		if (!open) {
			setDialogAction(null);
		}
	}, []);

	const handleRevertDialogOpenChange = React.useCallback((open: boolean) => {
		if (!open) {
			setPendingRevertVersion(null);
		}
	}, []);

	const handleWorkflowDialogOpenChange = React.useCallback((open: boolean) => {
		if (!open) {
			setTransitionTarget(null);
			setTransitionSchedule(false);
			setTransitionScheduledAt(null);
		}
	}, []);

	const workflowTransitionTriggerRender = React.useMemo(
		() => (
			<Button type="button" variant="outline" size="sm" className="gap-2" />
		),
		[],
	);

	const secondaryActionsTriggerRender = React.useMemo(
		() => <Button variant="outline" size="icon-sm" />,
		[],
	);

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

	// Refresh lock on form activity (debounced) - keeps lock alive while user is editing
	const lockRefreshTimerRef = React.useRef<NodeJS.Timeout | null>(null);
	React.useEffect(() => {
		if (!isEditMode || isBlocked || isLoading) return;

		const target = formElementRef.current;
		if (!target) return;

		const scheduleLockRefresh = () => {
			if (lockRefreshTimerRef.current) {
				clearTimeout(lockRefreshTimerRef.current);
			}
			lockRefreshTimerRef.current = setTimeout(() => {
				refreshLock();
			}, 1000);
		};

		const events = ["input", "change"] as const;

		for (const event of events) {
			target.addEventListener(event, scheduleLockRefresh, {
				capture: true,
			});
		}

		// Keep lock alive if user opens edit form and pauses before first change
		scheduleLockRefresh();

		return () => {
			for (const event of events) {
				target.removeEventListener(event, scheduleLockRefresh, {
					capture: true,
				});
			}

			if (lockRefreshTimerRef.current) {
				clearTimeout(lockRefreshTimerRef.current);
			}
		};
	}, [isEditMode, isBlocked, isLoading, refreshLock]);

	// Generate preview URL via server RPC (url function runs server-side)
	const { data: previewUrl = null } = useQuery({
		queryKey: [
			"questpie",
			"preview-url",
			collection,
			(transformedItem as any)?.id,
			contentLocale,
		],
		queryFn: async () => {
			const result = await (client as any).routes.getPreviewUrl({
				collection,
				record: transformedItem as Record<string, unknown>,
				locale: contentLocale,
			});
			return result?.url ?? null;
		},
		enabled:
			isLivePreviewOpen && canUseLivePreview && !!client && !!transformedItem,
		staleTime: 30_000,
	});

	// Show error state for failed item fetch
	if (isEditMode && itemError) {
		const is404 =
			itemError != null &&
			typeof itemError === "object" &&
			"status" in itemError &&
			(itemError as any).status === 404;
		return (
			<EmptyState
				variant={is404 ? "empty" : "error"}
				iconName={is404 ? "ph:file-dashed" : "ph:warning-circle"}
				title={is404 ? t("error.notFound") : t("error.failedToLoad")}
				description={
					!is404 && itemError instanceof Error ? itemError.message : undefined
				}
				height="h-64"
				action={
					is404 ? (
						<Button
							variant="outline"
							size="sm"
							className="gap-2"
							onClick={() => navigate(`${basePath}/collections/${collection}`)}
						>
							<Icon icon="ph:arrow-left" className="size-3.5" />
							{t("common.backToList")}
						</Button>
					) : (
						<Button
							variant="outline"
							size="sm"
							className="gap-2"
							onClick={() => window.location.reload()}
						>
							<Icon icon="ph:arrow-clockwise" className="size-3.5" />
							{t("common.retry")}
						</Button>
					)
				}
			/>
		);
	}

	// Keep skeleton visible until the backing document and field schema are both ready.
	// This avoids mounting an empty form and then immediately re-hydrating it.
	if ((isEditMode && isLoading) || isFieldsLoading) {
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
				<div className="qa-form-view__lock-banner bg-warning/10 border-warning/30 mb-4 flex items-center gap-3 border p-3">
					{blockedByUser.image ? (
						<img
							src={blockedByUser.image}
							alt=""
							className="image-outline size-8 rounded-full"
						/>
					) : (
						<div className="bg-warning/20 flex size-8 items-center justify-center rounded-full">
							<Icon icon="ph:user" className="text-warning size-4" />
						</div>
					)}
					<div className="min-w-0 flex-1">
						<p className="text-warning text-sm font-medium">
							{t("lock.blockedTitle", {
								name: blockedByUser.name ?? blockedByUser.email,
							})}
						</p>
						<p className="text-warning/80 text-xs">
							{t("lock.blockedDescription")}
						</p>
					</div>
					<Icon icon="ph:lock-simple" className="text-warning size-5" />
				</div>
			)}

			{/* Warning banner - show when same user has document open elsewhere */}
			{isOpenElsewhere && (
				<div className="qa-form-view__open-elsewhere-banner bg-info/10 border-info/30 mb-4 flex items-center gap-3 border p-3">
					<Icon icon="ph:browser" className="text-info size-5" />
					<p className="text-info text-sm">{t("lock.openElsewhere")}</p>
				</div>
			)}

			<FormProvider {...form}>
				<FormStateRefBridge
					control={form.control}
					onDirtyChange={handleFormDirtyChange}
					onSubmittingChange={handleFormSubmittingChange}
				/>
				<AutosaveManager
					form={form}
					formElementRef={formElementRef}
					isEditMode={isEditMode}
					id={id}
					enabled={autoSaveConfig.enabled}
					debounce={autoSaveConfig.debounce}
					isDirtyRef={formIsDirtyRef}
					isSubmittingRef={formIsSubmittingRef}
					updateMutation={updateMutation}
					onPreviewCommit={commitPreviewSnapshot}
					onPreviewRefresh={triggerPreviewRefresh}
					onSavingChange={setIsSaving}
					onSaved={setLastSaved}
				/>
				<PreviewPatchBridge
					form={form}
					previewRef={previewRef}
					enabled={isLivePreviewOpen && !!previewUrl && !isBlocked}
				/>
				{/* Manage server-side reactive field behaviors (compute, hidden, etc.) */}
				<ReactiveFieldsManager
					collection={collection}
					reactiveConfigs={reactiveConfigs}
					enabled={!isBlocked && !isMutationPending}
				/>
				<RenderProfiler id={`form.shell.${collection}`} minDurationMs={12}>
					<form
						ref={formElementRef}
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
						className="qa-form-view__form space-y-4"
					>
						<AdminViewHeader
							className="qa-form-view__header"
							title={title}
							titleAccessory={
								<>
									{localeOptions.length > 0 && (
										<LocaleSwitcher
											locales={localeOptions}
											value={contentLocale}
											onChange={setContentLocale}
										/>
									)}

									{/* Autosave status indicator */}
									<AutosaveIndicator
										control={form.control}
										enabled={autoSaveConfig.enabled}
										indicator={autoSaveConfig.indicator}
										isEditMode={isEditMode}
										isSaving={isSaving}
										lastSaved={lastSaved}
										formatTimeAgo={formatTimeAgo}
										t={t}
									/>

									{/* Workflow stage badge */}
									{workflowEnabled && currentStage && (
										<Badge variant="outline" className="gap-1.5">
											<Icon icon="ph:git-branch" className="size-3" />
											{currentStageLabel}
										</Badge>
									)}
								</>
							}
							meta={
								showMeta && item ? (
									<>
										<span className="opacity-60">{t("form.id")}:</span>
										<button
											type="button"
											className="hover:text-foreground cursor-pointer transition-colors"
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
									</>
								) : undefined
							}
							actions={
								<>
									{headerActions}

									{/* Live Preview button */}
									{canUseLivePreview && (
										<Button
											type="button"
											variant="outline"
											size="icon-sm"
											onClick={() => setIsLivePreviewOpen(true)}
											title={t("preview.livePreview")}
										>
											<Icon icon="ph:eye" className="size-4" />
											<span className="sr-only">
												{t("preview.livePreview")}
											</span>
										</Button>
									)}

									{/* History button — only show when versioning is enabled */}
									{isEditMode && id && schema?.options?.versioning && (
										<Button
											type="button"
											variant="outline"
											size="icon-sm"
											onClick={() => setIsHistoryOpen(true)}
											title={t("history.title")}
										>
											<Icon
												icon="ph:clock-counter-clockwise"
												className="size-4"
											/>
											<span className="sr-only">{t("history.title")}</span>
										</Button>
									)}

									{/* Workflow transition dropdown */}
									{workflowEnabled &&
										isEditMode &&
										id &&
										allowedTransitions.length > 0 && (
											<DropdownMenu>
												<DropdownMenuTrigger
													render={workflowTransitionTriggerRender}
												>
													<Icon
														icon="ph:arrows-left-right"
														className="size-4"
													/>
													{t("workflow.transition")}
												</DropdownMenuTrigger>
												<DropdownMenuContent align="end">
													{allowedTransitions.map((stage) => (
														<DropdownMenuItem
															key={stage.name}
															onClick={() =>
																setTransitionTarget({
																	name: stage.name,
																	label: stage.label,
																})
															}
														>
															<Icon
																icon="ph:arrow-right"
																className="mr-2 size-4"
															/>
															{stage.label || stage.name}
														</DropdownMenuItem>
													))}
												</DropdownMenuContent>
											</DropdownMenu>
										)}

									{/* Primary form actions as buttons */}
									{visiblePrimaryActions.map((action) => (
										<ActionButton
											key={action.id}
											action={action}
											collection={collection}
											helpers={actionHelpers}
											size="sm"
											onOpenDialog={(a) => setDialogAction(a)}
										/>
									))}

									{/* Save button */}
									<SaveSubmitButton
										control={form.control}
										isMutationPending={isMutationPending}
										t={t}
									/>

									{/* Secondary form actions in dropdown */}
									{visibleSecondaryActions.length > 0 && (
										<DropdownMenu>
											<DropdownMenuTrigger
												render={secondaryActionsTriggerRender}
											>
												<Icon
													icon="ph:dots-three-vertical"
													className="size-4"
												/>
												<span className="sr-only">
													{t("common.moreActions")}
												</span>
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
								</>
							}
						/>

						{/* Soft-deleted banner */}
						{item?.deletedAt && (
							<div className="qa-form-view__deleted-banner border-destructive/30 bg-destructive/5 text-destructive flex items-center gap-2 border px-4 py-3 text-sm">
								<Icon icon="ph:trash" className="size-4 shrink-0" />
								<span>
									{t("form.deletedBanner", {
										date: formatDate(item.deletedAt),
										defaultValue: `This record was deleted on ${formatDate(item.deletedAt)}. Use the Restore action to make it active again.`,
									})}
								</span>
							</div>
						)}

						{/* Main Content - Form Fields */}
						<FormFieldsContent
							collection={collection}
							config={formConfigBridge}
							registry={registry}
							allCollectionsConfig={allCollectionsConfig}
						/>
					</form>
				</RenderProfiler>
			</FormProvider>

			{/* Locale Change Confirmation Dialog */}
			{localeChangeDialog.open && (
				<Dialog
					open={localeChangeDialog.open}
					onOpenChange={handleLocaleDialogOpenChange}
				>
					<DialogContent showCloseButton={false}>
						<DialogHeader>
							<DialogTitle className="flex items-center gap-2">
								<Icon icon="ph:warning-fill" className="text-warning size-5" />
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
			)}

			{/* Action Confirmation Dialog */}
			{confirmAction?.confirmation && (
				<ConfirmationDialog
					open={!!confirmAction}
					onOpenChange={handleConfirmActionOpenChange}
					config={confirmAction.confirmation}
					onConfirm={handleConfirm}
					loading={actionLoading}
				/>
			)}

			{/* Action Dialog (for form/dialog handlers) */}
			{dialogAction && (
				<ActionDialog
					open={!!dialogAction}
					onOpenChange={handleActionDialogOpenChange}
					action={dialogAction}
					collection={collection}
					item={transformedItem}
					helpers={actionHelpers}
				/>
			)}

			{isHistoryOpen && (
				<HistorySidebar
					open={isHistoryOpen}
					onOpenChange={setIsHistoryOpen}
					versions={(versionsData ?? []) as any[]}
					fields={schema?.fields as any}
					isLoadingVersions={versionsLoading}
					isReverting={revertVersionMutation.isPending}
					onRevert={async (version) => {
						handleRevertVersion(version);
					}}
					showVersionsTab={!!schema?.options?.versioning}
				/>
			)}

			{pendingRevertVersion && (
				<ConfirmationDialog
					open={!!pendingRevertVersion}
					onOpenChange={handleRevertDialogOpenChange}
					config={{
						title: t("version.revertConfirmTitle"),
						description: t("version.revertConfirmDescription", {
							number:
								pendingRevertVersion?.versionNumber ??
								pendingRevertVersion?.versionId ??
								"-",
						}),
						confirmLabel: t("version.revert"),
						cancelLabel: t("common.cancel"),
						destructive: false,
					}}
					onConfirm={confirmRevertVersion}
					loading={revertVersionMutation.isPending}
				/>
			)}

			{/* Workflow Transition Confirmation Dialog */}
			{transitionTarget && (
				<Dialog
					open={!!transitionTarget}
					onOpenChange={handleWorkflowDialogOpenChange}
				>
					<DialogContent>
						<DialogHeader>
							<DialogTitle className="flex items-center gap-2">
								<Icon icon="ph:arrows-left-right" className="size-5" />
								{t("workflow.transitionTo", {
									stage:
										transitionTarget?.label ?? transitionTarget?.name ?? "",
								})}
							</DialogTitle>
							<DialogDescription>
								{t("workflow.transitionDescription", {
									from: currentStageLabel,
									to: transitionTarget?.label ?? transitionTarget?.name ?? "",
								})}
							</DialogDescription>
						</DialogHeader>

						{/* Optional scheduling */}
						<div className="space-y-3 py-2">
							<div className="flex items-center gap-2">
								<Checkbox
									checked={transitionSchedule}
									onCheckedChange={(val) => {
										setTransitionSchedule(!!val);
										if (!val) setTransitionScheduledAt(null);
									}}
									id="transition-schedule"
								/>
								<Label
									htmlFor="transition-schedule"
									className="cursor-pointer text-sm"
								>
									{t("workflow.scheduleLabel")}
								</Label>
							</div>

							{transitionSchedule && (
								<div className="space-y-1.5 pl-6">
									<Label className="text-muted-foreground text-xs">
										{t("workflow.scheduledAt")}
									</Label>
									<DateTimeInput
										value={transitionScheduledAt}
										onChange={setTransitionScheduledAt}
										minDate={new Date()}
									/>
									<p className="text-muted-foreground text-xs">
										{t("workflow.scheduledDescription")}
									</p>
								</div>
							)}
						</div>

						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => {
									setTransitionTarget(null);
									setTransitionSchedule(false);
									setTransitionScheduledAt(null);
								}}
							>
								{t("common.cancel")}
							</Button>
							<Button
								type="button"
								onClick={confirmTransition}
								disabled={
									transitionMutation.isPending ||
									(transitionSchedule && !transitionScheduledAt)
								}
								className="gap-2"
							>
								{transitionMutation.isPending && (
									<Icon icon="ph:spinner-gap" className="size-4 animate-spin" />
								)}
								{transitionSchedule
									? t("workflow.scheduleLabel")
									: t("workflow.transition")}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
		</>
	);

	const formShell = <div className="qa-form-view w-full">{formContent}</div>;

	if (!canUseLivePreview) {
		return formShell;
	}

	return (
		<LivePreviewMode
			open={isLivePreviewOpen}
			onClose={() => setIsLivePreviewOpen(false)}
			previewUrl={previewUrl}
			previewRef={previewRef}
			onFieldValueEdited={handlePreviewFieldValueEdited}
			onResyncRequest={handlePreviewResyncRequest}
			defaultSize={schemaPreview?.defaultSize}
			minSize={schemaPreview?.minSize}
		>
			{formShell}
		</LivePreviewMode>
	);
}
