/**
 * Shared CRUD Utilities
 *
 * Re-exports all shared utilities used by CRUDGenerator and GlobalCRUDGenerator.
 */

export {
	type AccessRuleEvaluationContext,
	checkFieldWriteAccess,
	executeAccessRule,
	type FilterFieldsForReadOptions,
	getRestrictedReadFields,
	matchesAccessConditions,
	mergeWhereWithAccess,
	validateFieldsWriteAccess,
} from "./access-control.js";
export { getDb, type NormalizedContext, normalizeContext } from "./context.js";
// TState-based field extraction (new approach)
export {
	extractFieldNamesByLocation,
	extractLocalizedFieldNames,
	extractMainFieldNames,
	extractNestedLocalizationSchema,
	extractNestedLocalizationSchemas,
	extractVirtualFieldNames,
	hasLocalizedFields,
	hasNestedLocalizedFields,
	hasVirtualFields,
	mergeFieldsByLocation,
	type NestedArraySchema,
	type NestedBlocksSchema,
	type NestedLocalizationSchema,
	type NestedObjectSchema,
	splitFieldsByLocation,
} from "./field-extraction.js";
export { resolveFieldKey } from "./field-resolver.js";
export {
	type CreateHookContextParams,
	createHookContext,
	executeHooks,
} from "./hooks.js";
export {
	hasI18nPrefixedColumns,
	I18N_CURRENT_PREFIX,
	I18N_FALLBACK_PREFIX,
	type MergeI18nOptions,
	mergeI18nRow,
	mergeI18nRows,
} from "./i18n-merge.js";
export {
	autoMergeNestedLocalizedFields,
	hasI18nMarkers,
	LOCALIZED_COLUMN,
	mergeNestedLocalizedFromColumn,
	splitLocalizedFields,
} from "./localization.js";

// Nested i18n merge utilities (for JSONB fields with $i18n markers)
export {
	arrayToMap,
	deepMergeI18n,
	I18N_MARKER,
	isBlocksStructure,
	isI18nMarker,
	isIdBasedMap,
	mapToArray,
	ORDER_KEY,
	TREE_KEY,
	VALUES_KEY,
} from "./nested-i18n-merge.js";

// Nested i18n split utilities
export { type SplitResult, splitByNestedSchema } from "./nested-i18n-split.js";

// Path utilities for nested object manipulation
export { isPlainObject } from "./path-utils.js";

export {
	type AppendRealtimeChangeParams,
	appendRealtimeChange,
	notifyRealtimeChange,
} from "./realtime.js";

// Transaction utilities with AsyncLocalStorage
export {
	getCurrentTransaction,
	getTransactionContext,
	isInTransaction,
	onAfterCommit,
	type TransactionContext,
	withTransaction,
	withTransactionOrExisting,
} from "./transaction.js";
