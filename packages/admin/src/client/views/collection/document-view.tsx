/**
 * Document View — Notion-style document page
 *
 * Renders a collection record as a centered page: an optional title, a compact
 * block of inline-editable property rows, a divider, and a dominant long-form
 * body field rendered with the rich-text editor.
 *
 * Drop-in with the form view: takes the same props (`CollectionFormViewProps`).
 * Layout and which fields are body/title/properties are declared via
 * `viewConfig.document` (the `DocumentViewConfig` contract) — no hardcoded field
 * names. Save is configurable: `"autosave"` (debounced, shared `useAutosave`
 * pipeline) or `"manual"` (a Save affordance with dirty tracking).
 */

import { Icon } from "@iconify/react";
import * as React from "react";
import {
	FormProvider,
	useForm,
	useFormContext,
	useFormState,
} from "react-hook-form";
import { toast } from "sonner";

import type { CollectionBuilderState } from "../../builder/types/collection-types";
import type {
	ComponentRegistry,
	DocumentViewConfig,
} from "../../builder/types/field-types";
import { resolveIconElement } from "../../components/component-renderer";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { Separator } from "../../components/ui/separator";
import {
	useCollectionValidation,
	usePreferServerValidation,
} from "../../hooks";
import { adminCollectionKey } from "../../hooks/query-access";
import { useAutosave } from "../../hooks/use-autosave";
import {
	useCollectionItem,
	useCollectionUpdate,
} from "../../hooks/use-collection";
import { useCollectionFields } from "../../hooks/use-collection-fields";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import { optimisticUpdateInput } from "../../utils/optimistic-lock";
import { AdminViewHeader, AdminViewLayout } from "../layout/admin-view-layout";
import { FieldRenderer } from "./field-renderer";
import { FormViewSkeleton } from "./view-skeletons";

// ============================================================================
// Types
// ============================================================================

interface DocumentViewProps {
	collection: string;
	id?: string;
	config?: Partial<CollectionBuilderState> | Record<string, any>;
	viewConfig?: DocumentViewConfig & Record<string, any>;
	navigate: (path: string) => void;
	basePath?: string;
	defaultValues?: Record<string, any>;
	registry?: ComponentRegistry;
	allCollectionsConfig?: Record<string, any>;
	title?: string;
}

type ResolvedDocumentConfig = DocumentViewConfig["document"];

// ============================================================================
// Constants
// ============================================================================

/**
 * Presentation-only default icons per field type, used for property rows when a
 * field carries no explicit icon. Falls back to a generic tag icon.
 */
const FIELD_TYPE_ICONS: Record<string, string> = {
	text: "ph:text-aa",
	textarea: "ph:text-align-left",
	richText: "ph:article",
	number: "ph:hash",
	boolean: "ph:toggle-left",
	select: "ph:list-checks",
	relation: "ph:link-simple",
	date: "ph:calendar-blank",
	datetime: "ph:calendar-blank",
	upload: "ph:paperclip",
	json: "ph:brackets-curly",
	color: "ph:palette",
	email: "ph:envelope-simple",
	url: "ph:globe-simple",
};

const DEFAULT_PROPERTY_ICON = "ph:tag";

// ============================================================================
// Property Row
// ============================================================================

/**
 * A single Notion-style property row: icon + label + the field's inline editor.
 */
const DocumentPropertyRow = React.memo(function DocumentPropertyRow({
	collection,
	fieldName,
	fieldDef,
	icon,
	label,
	registry,
	allCollectionsConfig,
}: {
	collection: string;
	fieldName: string;
	fieldDef: any;
	icon: React.ReactNode;
	label: string;
	registry?: ComponentRegistry;
	allCollectionsConfig?: Record<string, any>;
}) {
	return (
		<div className="qa-document-view__property hover:bg-muted/40 flex items-start gap-3 rounded-md px-2 py-1.5 transition-colors duration-150">
			<div className="text-muted-foreground flex w-32 shrink-0 items-center gap-2 pt-2">
				<span className="flex size-3.5 shrink-0 items-center justify-center">
					{icon}
				</span>
				<span className="truncate text-xs">{label}</span>
			</div>
			<div className="qa-document-view__property-control min-w-0 flex-1">
				<FieldRenderer
					fieldName={fieldName}
					fieldDef={fieldDef}
					collection={collection}
					registry={registry}
					allCollectionsConfig={allCollectionsConfig}
					hideLabel
				/>
			</div>
		</div>
	);
});

// ============================================================================
// Manual Save affordance
// ============================================================================

const DocumentSaveButton = React.memo(function DocumentSaveButton({
	isPending,
}: {
	isPending: boolean;
}) {
	const { t } = useTranslation();
	const { isDirty, isSubmitting } = useFormState();
	const busy = isPending || isSubmitting;

	return (
		<Button type="submit" size="sm" disabled={busy || !isDirty} className="gap-2">
			{busy ? (
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
// Autosave indicator
// ============================================================================

const DocumentAutosaveIndicator = React.memo(function DocumentAutosaveIndicator({
	isSaving,
	lastSaved,
}: {
	isSaving: boolean;
	lastSaved: Date | null;
}) {
	const { t } = useTranslation();
	const { isDirty } = useFormState();
	const [, forceUpdate] = React.useReducer((x) => x + 1, 0);

	React.useEffect(() => {
		if (!lastSaved) return;
		const interval = setInterval(forceUpdate, 10000);
		return () => clearInterval(interval);
	}, [lastSaved]);

	const formatTimeAgo = (date: Date) => {
		const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
		if (seconds < 10) return t("autosave.justNow");
		if (seconds < 60) return t("autosave.secondsAgo", { count: seconds });
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return t("autosave.minutesAgo", { count: minutes });
		const hours = Math.floor(minutes / 60);
		return t("autosave.hoursAgo", { count: hours });
	};

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

// ============================================================================
// Helpers
// ============================================================================

/**
 * Resolve the ordered list of property field names.
 * - `"auto"` → every schema field except the body and title, in schema order.
 * - `string[]` → the explicit list (filtered to fields that exist).
 */
function resolvePropertyNames(
	properties: ResolvedDocumentConfig["properties"],
	resolvedFields: Record<string, unknown>,
	body: string,
	title: string | undefined,
): string[] {
	const allNames = Object.keys(resolvedFields);

	if (Array.isArray(properties)) {
		return properties.filter((name) => allNames.includes(name));
	}

	// "auto" (or undefined): all fields minus body/title
	return allNames.filter((name) => name !== body && name !== title);
}

// ============================================================================
// Body bridge (lives inside FormProvider to read form state for the indicator)
// ============================================================================

const DocumentForm = React.memo(function DocumentForm({
	collection,
	documentConfig,
	propertyNames,
	resolvedFields,
	schema,
	registry,
	allCollectionsConfig,
	title,
	saveMode,
	isSaving,
	lastSaved,
	isMutationPending,
}: {
	collection: string;
	documentConfig: ResolvedDocumentConfig;
	propertyNames: string[];
	resolvedFields: Record<string, any>;
	schema: any;
	registry?: ComponentRegistry;
	allCollectionsConfig?: Record<string, any>;
	title: React.ReactNode;
	saveMode: "autosave" | "manual";
	isSaving: boolean;
	lastSaved: Date | null;
	isMutationPending: boolean;
}) {
	const resolveText = useResolveText();
	const form = useFormContext();

	const propertyRows = React.useMemo(() => {
		const schemaFields = (schema?.fields ?? {}) as Record<
			string,
			{ metadata?: { label?: unknown; icon?: any } }
		>;

		return propertyNames
			.map((name) => {
				const fieldDef = resolvedFields[name];
				if (!fieldDef) return null;

				const meta = schemaFields[name]?.metadata;
				const fieldType: string = fieldDef.name;
				const label = resolveText(
					(meta?.label as any) ?? name,
					name,
					form.getValues() as Record<string, unknown>,
				);
				const explicitIcon = meta?.icon
					? resolveIconElement(meta.icon, { className: "size-3.5" })
					: null;
				const icon = explicitIcon ?? (
					<Icon
						icon={FIELD_TYPE_ICONS[fieldType] ?? DEFAULT_PROPERTY_ICON}
						className="size-3.5"
					/>
				);

				return { name, fieldDef, label, icon };
			})
			.filter(Boolean) as Array<{
			name: string;
			fieldDef: any;
			label: string;
			icon: React.ReactNode;
		}>;
	}, [propertyNames, resolvedFields, schema?.fields, resolveText, form]);

	const bodyFieldDef = resolvedFields[documentConfig.body];

	return (
		<div className="qa-document-view mx-auto max-w-3xl px-6 py-8">
			<AdminViewHeader
				className="mb-6"
				title={title}
				titleAccessory={
					saveMode === "autosave" ? (
						<DocumentAutosaveIndicator
							isSaving={isSaving}
							lastSaved={lastSaved}
						/>
					) : (
						<DocumentSaveButton isPending={isMutationPending} />
					)
				}
			/>

			{propertyRows.length > 0 && (
				<div className="qa-document-view__properties mb-6 space-y-px">
					{propertyRows.map((row) => (
						<DocumentPropertyRow
							key={row.name}
							collection={collection}
							fieldName={row.name}
							fieldDef={row.fieldDef}
							icon={row.icon}
							label={row.label}
							registry={registry}
							allCollectionsConfig={allCollectionsConfig}
						/>
					))}
				</div>
			)}

			<Separator className="mb-8" />

			<div className="qa-document-view__body min-w-0">
				{bodyFieldDef ? (
					<FieldRenderer
						fieldName={documentConfig.body}
						fieldDef={bodyFieldDef}
						collection={collection}
						registry={registry}
						allCollectionsConfig={allCollectionsConfig}
						hideLabel
					/>
				) : (
					<EmptyState
						iconName="ph:warning"
						title={`Document body field "${documentConfig.body}" not found.`}
					/>
				)}
			</div>
		</div>
	);
});

// ============================================================================
// Editor (inner) — owns `useForm`, mounted ONLY once the record has loaded
// ============================================================================

/**
 * The form-bearing inner component. The outer `DocumentView` gates on loading
 * and mounts this with `initialValues` already populated, so `useForm` — and
 * therefore the TipTap body editor (`content: value`) — initializes WITH the
 * stored content on its very first render. This is the fix for the empty-body /
 * spurious "unsaved changes" bug: we never mount the editor empty and then try
 * to re-sync a value-prop change into ProseMirror.
 *
 * Remounted (via `key`) by the outer when the record identity changes, so each
 * record gets a fresh form seeded with its own values.
 */
function DocumentEditor({
	collection,
	id,
	documentConfig,
	propertyNames,
	resolvedFields,
	schema,
	registry,
	allCollectionsConfig,
	resolver,
	updateMutation,
	initialValues,
	title,
	autosaveDebounce,
}: {
	collection: string;
	id?: string;
	documentConfig: ResolvedDocumentConfig;
	propertyNames: string[];
	resolvedFields: Record<string, any>;
	schema: any;
	registry?: ComponentRegistry;
	allCollectionsConfig?: Record<string, any>;
	resolver: any;
	updateMutation: ReturnType<typeof useCollectionUpdate>;
	initialValues: Record<string, any>;
	title: React.ReactNode;
	autosaveDebounce: number;
}): React.ReactElement {
	const { t } = useTranslation();

	const saveMode: "autosave" | "manual" =
		documentConfig.save === "manual" ? "manual" : "autosave";

	const form = useForm({
		defaultValues: initialValues as any,
		resolver,
		mode: "onBlur",
	});

	// Mirror dirty/submitting into refs for the autosave guard.
	const formIsDirtyRef = React.useRef(false);
	const formIsSubmittingRef = React.useRef(false);
	const { isDirty: formIsDirty, isSubmitting: formIsSubmitting } = useFormState({
		control: form.control,
	});
	React.useEffect(() => {
		formIsDirtyRef.current = formIsDirty;
	}, [formIsDirty]);
	React.useEffect(() => {
		formIsSubmittingRef.current = formIsSubmitting;
	}, [formIsSubmitting]);

	const [isSaving, setIsSaving] = React.useState(false);
	const [lastSaved, setLastSaved] = React.useState<Date | null>(null);

	useAutosave({
		form,
		id,
		enabled: saveMode === "autosave",
		debounce: autosaveDebounce,
		isDirtyRef: formIsDirtyRef,
		isSubmittingRef: formIsSubmittingRef,
		updateMutation,
		optimisticLock: schema?.options?.optimisticLock,
		onSavingChange: setIsSaving,
		onSaved: setLastSaved,
	});

	const onManualSubmit = form.handleSubmit(async (data) => {
		if (!id) return;
		try {
			const result = await updateMutation.mutateAsync(
				optimisticUpdateInput(id, data, schema?.options?.optimisticLock),
			);
			form.reset(result as any, { keepTouched: true });
			setLastSaved(new Date());
			toast.success(t("toast.saveSuccess"));
		} catch (error) {
			toast.error(t("toast.saveFailed"), {
				description: error instanceof Error ? error.message : undefined,
			});
		}
	});

	return (
		<FormProvider {...form}>
			<form
				onSubmit={(e) => {
					e.stopPropagation();
					if (saveMode === "manual") {
						void onManualSubmit(e);
					} else {
						e.preventDefault();
					}
				}}
			>
				<DocumentForm
					collection={collection}
					documentConfig={documentConfig}
					propertyNames={propertyNames}
					resolvedFields={resolvedFields}
					schema={schema}
					registry={registry}
					allCollectionsConfig={allCollectionsConfig}
					title={title}
					saveMode={saveMode}
					isSaving={isSaving}
					lastSaved={lastSaved}
					isMutationPending={updateMutation.isPending}
				/>
			</form>
		</FormProvider>
	);
}

// ============================================================================
// Component (outer) — config/fields/record loading + guards
// ============================================================================

export default function DocumentView({
	collection,
	id,
	config,
	viewConfig,
	defaultValues: defaultValuesProp,
	registry,
	allCollectionsConfig,
	title: titleProp,
}: DocumentViewProps): React.ReactElement {
	const { t } = useTranslation();
	const isEditMode = !!id;
	const collectionKey = adminCollectionKey(collection);

	const {
		fields: resolvedFields,
		schema,
		isLoading: isFieldsLoading,
	} = useCollectionFields(collection, {
		fallbackFields: (config as any)?.fields,
	});

	// Resolve the document config from the view config (or schema admin.form).
	const documentConfig = React.useMemo<ResolvedDocumentConfig | undefined>(
		() =>
			(viewConfig as any)?.document ??
			(schema?.admin?.form as any)?.document ??
			(config as any)?.form?.document,
		[viewConfig, schema?.admin?.form, config],
	);

	const propertyNames = React.useMemo(
		() =>
			documentConfig
				? resolvePropertyNames(
						documentConfig.properties,
						resolvedFields,
						documentConfig.body,
						documentConfig.title,
					)
				: [],
		[documentConfig, resolvedFields],
	);

	// Load the record.
	const {
		data: item,
		isLoading,
		error: itemError,
	} = useCollectionItem(
		collectionKey,
		id ?? "",
		{ localeFallback: false },
		{ enabled: isEditMode },
	);

	const updateMutation = useCollectionUpdate(collectionKey);

	// Validation resolver — prefer server validation, fall back to client.
	const hasServerValidationSchema = !!(schema as any)?.validation?.update;
	const clientResolver = useCollectionValidation(collection, {
		enabled: !isFieldsLoading && !hasServerValidationSchema,
	});
	const resolver = usePreferServerValidation(
		collection,
		{ mode: "update", schema },
		clientResolver,
	);

	// Debounce ~300ms by default for the Notion-feel; honor explicit autoSave.debounce.
	const autosaveDebounce = (config as any)?.autoSave?.debounce ?? 300;

	// Loading / error / config guards.
	if (!documentConfig) {
		return (
			<AdminViewLayout contentClassName="overflow-y-auto">
				<div className="mx-auto max-w-3xl px-6 py-8">
					<EmptyState
						iconName="ph:warning"
						title="No document configuration"
						description="This view has kind 'document' but no document config (body/properties). Configure it via view(..., { kind: 'document', document: { body, properties } })."
					/>
				</div>
			</AdminViewLayout>
		);
	}

	if (isEditMode && itemError) {
		return (
			<AdminViewLayout contentClassName="overflow-y-auto">
				<div className="mx-auto max-w-3xl px-6 py-8">
					<EmptyState
						iconName="ph:warning"
						title={t("error.failedToLoad")}
						description={
							itemError instanceof Error ? itemError.message : undefined
						}
					/>
				</div>
			</AdminViewLayout>
		);
	}

	// Gate the form on a loaded record: the inner editor (and its TipTap body)
	// must mount WITH the stored values, never empty-then-reset.
	if ((isEditMode && (isLoading || !item)) || isFieldsLoading) {
		return <FormViewSkeleton />;
	}

	const initialValues = (isEditMode
		? item
		: (defaultValuesProp ?? {})) as Record<string, any>;

	// Prefer the title field, then an explicit `title` prop (e.g. a filename),
	// then the record id. Treat empty/whitespace title-field values as absent so
	// the caller-supplied title wins instead of rendering a blank heading.
	const titleFieldValue = documentConfig.title
		? (initialValues[documentConfig.title] as string | undefined)
		: undefined;
	const resolvedTitle =
		(titleFieldValue && titleFieldValue.trim() ? titleFieldValue : undefined) ??
		titleProp ??
		(initialValues.id as string | undefined) ??
		collection;

	return (
		<AdminViewLayout contentClassName="overflow-y-auto">
			<DocumentEditor
				key={id ?? "new"}
				collection={collection}
				id={id}
				documentConfig={documentConfig}
				propertyNames={propertyNames}
				resolvedFields={resolvedFields}
				schema={schema}
				registry={registry}
				allCollectionsConfig={allCollectionsConfig}
				resolver={resolver}
				updateMutation={updateMutation}
				initialValues={initialValues}
				title={resolvedTitle}
				autosaveDebounce={autosaveDebounce}
			/>
		</AdminViewLayout>
	);
}
