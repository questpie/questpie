/**
 * useResourceFormController
 *
 * Reusable controller for collection edit/create forms. Extracts the
 * data-loading, locking, validation, and react-hook-form setup that
 * `FormView` and the upcoming `VisualEditWorkspace` both need to share.
 *
 * Behavior must match `form-view.tsx` byte-for-byte — the hook is a pure
 * relocation of existing logic, no semantics change. UI concerns
 * (autosave, locale dialog, preview URL, sheet, action handlers,
 * workflow dialog) intentionally stay in the consumer.
 */

"use client";

import type { CollectionSchema, FieldReactiveSchema } from "questpie/client";
import * as React from "react";
import { type UseFormReturn, useForm } from "react-hook-form";

import {
	useCollectionValidation,
	usePreferServerValidation,
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
import { useTransitionStage } from "../../hooks/use-transition-stage";
import {
	detectManyToManyRelations,
	hasManyToManyRelations,
} from "../../utils/detect-relations";

// ============================================================================
// Types
// ============================================================================

/**
 * Workflow shape extracted from `schema.options.workflow`. Mirrors the
 * server-side definition; kept loose because the shape is plugin-driven.
 */
type WorkflowConfig = {
	enabled: boolean;
	initialStage: string;
	stages: Array<{
		name: string;
		label?: string;
		description?: string;
		transitions?: string[];
	}>;
};

export type ResourceFormControllerOptions = {
	/** Collection name (e.g. `"posts"`) */
	collection: string;
	/** Item id when editing; undefined for create */
	id?: string;
	/**
	 * Optional collection config (used as fallback when introspection is
	 * offline). Typed loosely on purpose — the hook only reads
	 * `config.form` / `config.fields` and otherwise hands the value back
	 * unchanged so the consumer can keep its own typing.
	 */
	config?: unknown;
	/**
	 * Optional explicit form view config — overrides `config.form` and
	 * `schema.admin.form`. Typed loosely for the same passthrough reason.
	 */
	viewConfig?: unknown;
	/** Default values for create mode */
	defaultValues?: Record<string, unknown>;
};

export type ResourceFormControllerLock = {
	isBlocked: boolean;
	blockedBy: ReturnType<typeof useLock>["blockedBy"];
	blockedByUser: ReturnType<typeof getLockUser> | null;
	isOpenElsewhere: boolean;
	refresh: () => void;
};

export type ResourceFormControllerMutations = {
	create: ReturnType<typeof useCollectionCreate>;
	update: ReturnType<typeof useCollectionUpdate>;
	remove: ReturnType<typeof useCollectionDelete>;
	restore: ReturnType<typeof useCollectionRestore>;
	revertVersion: ReturnType<typeof useCollectionRevertVersion>;
	transition: ReturnType<typeof useTransitionStage>;
};

export type ResourceFormControllerWorkflow = {
	config: WorkflowConfig | undefined;
	enabled: boolean;
	currentStage: string | null;
	currentStageConfig: WorkflowConfig["stages"][number] | null;
	currentStageLabel: string;
	allowedTransitions: WorkflowConfig["stages"];
};

export type ResourceFormController = {
	/** react-hook-form instance — defaults match `transformedItem ?? defaultValues ?? {}` */
	form: UseFormReturn<any>;
	/** Collection name the controller is bound to */
	collection: string;
	/** Item id when editing, undefined when creating */
	id: string | undefined;
	/** Whether we are editing an existing record (id is set) */
	isEditMode: boolean;
	/** Validation mode passed to the server validation hook */
	validationMode: "create" | "update";
	/** Resolved field instances for the collection (registry-bridged) */
	fields: ReturnType<typeof useCollectionFields>["fields"];
	/** Live introspection schema for the collection */
	schema: CollectionSchema | undefined;
	/** Whether fields/introspection are still loading */
	isFieldsLoading: boolean;
	/** Resolved form view config (viewConfig prop > config.form > schema.admin.form) */
	resolvedFormConfig: any;
	/** `config` merged with the resolved form config — used by AutoFormFields */
	formConfigBridge: unknown;
	/** Reactive configs (`hidden`, `compute`, …) extracted from the schema */
	reactiveConfigs: Record<string, FieldReactiveSchema>;
	/** Many-to-many relations that must be included via `with: ...` on fetch */
	withRelations: Record<string, boolean>;
	/** Raw item from the server (undefined for create or while loading) */
	item: any;
	/**
	 * Item with M:N relation arrays flattened to id arrays — what the form
	 * actually consumes via `form.reset`.
	 */
	transformedItem: any;
	isItemLoading: boolean;
	itemError: unknown;
	lock: ResourceFormControllerLock;
	mutations: ResourceFormControllerMutations;
	workflow: ResourceFormControllerWorkflow;
};

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

// ============================================================================
// Hook
// ============================================================================

export function useResourceFormController({
	collection,
	id,
	config,
	viewConfig,
	defaultValues,
}: ResourceFormControllerOptions): ResourceFormController {
	const isEditMode = !!id;

	// ----- Schema + fields ----------------------------------------------------
	const {
		fields,
		schema,
		isLoading: isFieldsLoading,
	} = useCollectionFields(collection, {
		fallbackFields: (config as any)?.fields,
	});

	const resolvedFormConfig = React.useMemo(
		() =>
			viewConfig ??
			(config as any)?.form?.["~config"] ??
			(config as any)?.form ??
			(schema?.admin?.form as any),
		[viewConfig, config, schema?.admin?.form],
	);

	const formConfigBridge = React.useMemo(() => {
		if (!resolvedFormConfig) return config;
		return {
			...((config as any) ?? {}),
			form: resolvedFormConfig,
		};
	}, [config, resolvedFormConfig]);

	const reactiveConfigs = React.useMemo(
		() => extractReactiveConfigs(schema),
		[schema],
	);

	// ----- Item fetch ---------------------------------------------------------
	const withRelations = React.useMemo(
		() => detectManyToManyRelations({ fields, schema }),
		[fields, schema],
	);

	const {
		data: item,
		isLoading: isItemLoading,
		error: itemError,
	} = useCollectionItem(
		collection as any,
		id ?? "",
		hasManyToManyRelations(withRelations)
			? { with: withRelations, localeFallback: false }
			: { localeFallback: false },
		{ enabled: isEditMode },
	);

	// Transform M:N relation arrays of objects to arrays of IDs so they
	// drop straight into the form's defaultValues without round-tripping.
	const transformedItem = React.useMemo(() => {
		if (!item || !hasManyToManyRelations(withRelations)) return item;

		const result = { ...(item as Record<string, unknown>) } as Record<
			string,
			unknown
		>;
		for (const key of Object.keys(withRelations)) {
			const value = result[key];
			if (
				Array.isArray(value) &&
				value.length > 0 &&
				typeof value[0] === "object" &&
				(value[0] as { id?: unknown })?.id
			) {
				result[key] = value.map((v) => (v as { id: unknown }).id);
			}
		}
		return result;
	}, [item, withRelations]);

	// ----- Lock ---------------------------------------------------------------
	const lockState = useLock({
		resourceType: "collection",
		resource: collection,
		resourceId: id ?? "",
		autoAcquire: isEditMode,
	});
	const blockedByUser = lockState.blockedBy
		? getLockUser(lockState.blockedBy)
		: null;
	const lock: ResourceFormControllerLock = {
		isBlocked: lockState.isBlocked,
		blockedBy: lockState.blockedBy,
		blockedByUser,
		isOpenElsewhere: lockState.isOpenElsewhere,
		refresh: lockState.refresh,
	};

	// ----- Mutations ----------------------------------------------------------
	const mutations: ResourceFormControllerMutations = {
		create: useCollectionCreate(collection as any),
		update: useCollectionUpdate(collection as any),
		remove: useCollectionDelete(collection as any),
		restore: useCollectionRestore(collection as any),
		revertVersion: useCollectionRevertVersion(collection as any),
		transition: useTransitionStage(collection),
	};

	// ----- Workflow ----------------------------------------------------------
	const workflowConfig = schema?.options?.workflow as
		| WorkflowConfig
		| undefined;
	const workflowEnabled = !!workflowConfig?.enabled;

	// Lightweight versions query (limit: 1) just to read the current
	// `versionStage`. The full 50-version query lives in the consumer.
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

	const allowedTransitions = React.useMemo<WorkflowConfig["stages"]>(() => {
		if (!workflowConfig?.stages || !currentStage) return [];
		const stageNames = currentStageConfig?.transitions;
		if (stageNames && stageNames.length > 0) {
			return stageNames
				.map((name) => workflowConfig.stages.find((s) => s.name === name))
				.filter(Boolean) as WorkflowConfig["stages"];
		}
		// Unrestricted — all stages except the current one
		return workflowConfig.stages.filter((s) => s.name !== currentStage);
	}, [workflowConfig, currentStage, currentStageConfig]);

	const workflow: ResourceFormControllerWorkflow = {
		config: workflowConfig,
		enabled: workflowEnabled,
		currentStage,
		currentStageConfig,
		currentStageLabel,
		allowedTransitions,
	};

	// ----- Validation + form -------------------------------------------------
	const validationMode: "create" | "update" = isEditMode ? "update" : "create";
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
		defaultValues: (transformedItem ?? defaultValues ?? {}) as any,
		resolver,
		mode: "onBlur",
	});

	return {
		form,
		collection,
		id,
		isEditMode,
		validationMode,
		fields,
		schema,
		isFieldsLoading,
		resolvedFormConfig,
		formConfigBridge,
		reactiveConfigs,
		withRelations,
		item,
		transformedItem,
		isItemLoading,
		itemError,
		lock,
		mutations,
		workflow,
	};
}
