"use client";

import { Icon } from "@iconify/react";
import { useQueries } from "@tanstack/react-query";
import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	type RowSelectionState,
	useReactTable,
} from "@tanstack/react-table";
import * as React from "react";

import type {
	ActionDefinition,
	ActionsConfig,
} from "../../builder/types/action-types";
import type {
	ListViewConfig,
	ListViewOutlineLevel,
} from "../../builder/types/collection-types";
import type { CollectionListViewProps } from "../../builder/types/views";
import { ActionButton } from "../../components/actions/action-button";
import { ActionDialog } from "../../components/actions/action-dialog";
import { HeaderActions } from "../../components/actions/header-actions";
import { resolveIconElement } from "../../components/component-renderer";
import { FilterBuilderSheet } from "../../components/filter-builder/filter-builder-sheet";
import type {
	AvailableField,
	ViewConfiguration,
} from "../../components/filter-builder/types";
import { LocaleSwitcher } from "../../components/locale-switcher";
import { flattenOptions } from "../../components/primitives/types";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { EmptyState } from "../../components/ui/empty-state";
import { SearchInput } from "../../components/ui/search-input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../../components/ui/select";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "../../components/ui/tooltip";
import { useActions } from "../../hooks/use-action";
import {
	useCollectionDelete,
	useCollectionList,
	useCollectionRestore,
} from "../../hooks/use-collection";
import { useCollectionFields } from "../../hooks/use-collection-fields";
import { useSuspenseCollectionMeta } from "../../hooks/use-collection-meta";
import { useSessionState } from "../../hooks/use-current-user";
import { getLockUser, useLocks } from "../../hooks/use-locks";
import { useQuestpieQueryOptions } from "../../hooks/use-questpie-query-options";
import { useRealtimeHighlight } from "../../hooks/use-realtime-highlight";
import {
	useDeleteSavedView,
	useSavedViews,
	useSaveView,
} from "../../hooks/use-saved-views";
import { useDebouncedValue, useSearch } from "../../hooks/use-search";
import {
	mergeServerActions,
	useServerActions,
} from "../../hooks/use-server-actions";
import { useSidebarSearchParam } from "../../hooks/use-sidebar-search-param";
import { useUploadCollection } from "../../hooks/use-upload-collection";
import { useViewState } from "../../hooks/use-view-state";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import {
	selectRealtime,
	useAdminStore,
	useSafeContentLocales,
	useScopedLocale,
} from "../../runtime";
import {
	autoExpandFields,
	hasFieldsToExpand,
} from "../../utils/auto-expand-fields";
import { AdminViewHeader, AdminViewLayout } from "../layout/admin-view-layout";
import { BulkActionToolbar } from "./bulk-action-toolbar";
import {
	buildColumns,
	computeDefaultColumns,
	getAllAvailableFields,
} from "./columns";
import {
	buildOutlineRows,
	type OutlineGroupMeta,
	type OutlineRow,
} from "./outline";
import { QuickFilterBar } from "./quick-filter-bar";
import {
	mapListSchemaToConfig,
	stringifyGroupValue,
	UploadCollectionButton,
} from "./table-view";
import { TableViewSkeleton } from "./view-skeletons";

type ListViewProps = CollectionListViewProps & {
	showSearch?: boolean;
	showFilters?: boolean;
	showToolbar?: boolean;
	actionsConfig?: ActionsConfig;
};

function normalizeFieldList(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function getColumnKey(column: ColumnDef<any>): string | undefined {
	return ((column as any).accessorKey ?? (column as any).id) as
		| string
		| undefined;
}

function getValueAtPath(source: unknown, path: string | undefined): unknown {
	if (!path) return source;
	let current = source;
	for (const part of path.split(".").filter(Boolean)) {
		if (!current || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

function extractRelationNamesFromOutline(
	outline: ListViewConfig["outline"] | undefined,
): string[] {
	const names = new Set<string>();
	for (const level of outline?.levels ?? []) {
		if (level.kind === "relation-field") names.add(level.relation);
	}
	return [...names];
}

function extractEdgeLevels(
	outline: ListViewConfig["outline"] | undefined,
): Extract<ListViewOutlineLevel, { kind: "edge" }>[] {
	return (outline?.levels ?? []).filter(
		(level): level is Extract<ListViewOutlineLevel, { kind: "edge" }> =>
			level.kind === "edge",
	);
}

function buildFilterWhere({
	filters,
	resolvedFields,
	relationNames,
}: {
	filters: ViewConfiguration["filters"];
	resolvedFields: Record<string, any> | undefined;
	relationNames: string[];
}) {
	if (filters.length === 0) return undefined;

	const whereConditions: Record<string, any> = {};
	const isEmptyValue = (val: unknown) => {
		if (val === undefined || val === null) return true;
		if (typeof val === "string") return val.trim().length === 0;
		if (Array.isArray(val)) return val.length === 0;
		return false;
	};
	const normalizeSelectValue = (val: unknown, fieldOptions: any) => {
		const optionsList = fieldOptions?.options;
		if (!optionsList) return val;
		const map = new Map(
			flattenOptions(optionsList).map((opt) => [String(opt.value), opt.value]),
		);
		const mapValue = (item: unknown) => map.get(String(item)) ?? item;
		if (Array.isArray(val)) return val.map(mapValue);
		if (val === undefined || val === null) return val;
		return mapValue(val);
	};
	const coerceValue = (val: unknown, fieldDef?: any) => {
		if (!fieldDef) return val;
		const fieldType = fieldDef?.name ?? "text";
		const fieldOptions = fieldDef?.["~options"] ?? {};
		if (fieldType === "number" && typeof val === "string") {
			const parsed = Number(val);
			return Number.isNaN(parsed) ? val : parsed;
		}
		if (
			(fieldType === "checkbox" || fieldType === "switch") &&
			typeof val === "string"
		) {
			if (val === "true") return true;
			if (val === "false") return false;
		}
		if (fieldType === "select") return normalizeSelectValue(val, fieldOptions);
		return val;
	};
	const toArray = (val: unknown): unknown[] => {
		if (Array.isArray(val)) return val;
		if (val === undefined || val === null || val === "") return [];
		return [val];
	};
	const buildRelationCondition = (
		operator: string,
		val: unknown,
		relationType: "single" | "multiple",
	) => {
		const isMultiple = relationType === "multiple";
		const ids = toArray(val);
		switch (operator) {
			case "equals":
				return isMultiple ? { some: { id: val } } : { is: { id: val } };
			case "not_equals":
				return isMultiple ? { none: { id: val } } : { isNot: { id: val } };
			case "in":
				return isMultiple
					? { some: { id: { in: ids } } }
					: { is: { id: { in: ids } } };
			case "not_in":
				return isMultiple
					? { none: { id: { in: ids } } }
					: { isNot: { id: { in: ids } } };
			case "some":
				return { some: { id: { in: ids } } };
			case "every":
				return { every: { id: { in: ids } } };
			case "none":
				return { none: { id: { in: ids } } };
			case "is_empty":
				return isMultiple ? { none: {} } : { isNot: {} };
			case "is_not_empty":
				return isMultiple ? { some: {} } : { is: {} };
			default:
				return undefined;
		}
	};

	for (const filter of filters) {
		const { field, operator, value } = filter;
		if (!field || field === "_title") continue;
		const fieldDef = resolvedFields?.[field] as any;
		const fieldType = fieldDef?.name ?? "text";
		const fieldOptions = fieldDef?.["~options"] ?? {};
		const relationName =
			fieldType === "relation"
				? ((fieldOptions.relationName as string | undefined) ?? field)
				: undefined;
		const hasRelation =
			relationName &&
			(relationNames.length === 0 || relationNames.includes(relationName));
		const isRelationField = fieldType === "relation" && !!hasRelation;
		const requiresValue =
			operator !== "is_empty" && operator !== "is_not_empty";
		if (requiresValue && isEmptyValue(value)) continue;
		const normalizedValue = coerceValue(value, fieldDef);

		if (isRelationField && relationName) {
			const relationType =
				fieldOptions.type === "multiple" ? "multiple" : "single";
			const condition = buildRelationCondition(
				operator,
				normalizedValue,
				relationType,
			);
			if (condition) whereConditions[relationName] = condition;
			continue;
		}

		switch (operator) {
			case "equals":
				whereConditions[field] = normalizedValue;
				break;
			case "not_equals":
				whereConditions[field] = { ne: normalizedValue };
				break;
			case "contains":
				whereConditions[field] = { contains: normalizedValue };
				break;
			case "not_contains":
				whereConditions[field] = { notIlike: `%${normalizedValue}%` };
				break;
			case "starts_with":
				whereConditions[field] = { startsWith: normalizedValue };
				break;
			case "ends_with":
				whereConditions[field] = { endsWith: normalizedValue };
				break;
			case "greater_than":
				whereConditions[field] = { gt: normalizedValue };
				break;
			case "less_than":
				whereConditions[field] = { lt: normalizedValue };
				break;
			case "greater_than_or_equal":
				whereConditions[field] = { gte: normalizedValue };
				break;
			case "less_than_or_equal":
				whereConditions[field] = { lte: normalizedValue };
				break;
			case "in":
				whereConditions[field] = {
					in: Array.isArray(normalizedValue)
						? normalizedValue
						: [normalizedValue],
				};
				break;
			case "not_in":
				whereConditions[field] = {
					notIn: Array.isArray(normalizedValue)
						? normalizedValue
						: [normalizedValue],
				};
				break;
			case "is_empty":
				whereConditions[field] = { isNull: true };
				break;
			case "is_not_empty":
				whereConditions[field] = { isNotNull: true };
				break;
		}
	}

	return Object.keys(whereConditions).length ? whereConditions : undefined;
}

function SimpleValue({ value }: { value: unknown }): React.ReactElement {
	if (value === null || value === undefined || value === "") {
		return <span className="text-muted-foreground">-</span>;
	}
	if (Array.isArray(value)) {
		return <>{value.map((item) => stringifySimpleValue(item)).join(", ")}</>;
	}
	return <>{stringifySimpleValue(value)}</>;
}

function formatShortDate(date: Date): string {
	const now = new Date();
	const sameYear = date.getFullYear() === now.getFullYear();
	const month = date.toLocaleDateString(undefined, { month: "short" });
	const day = date.getDate();
	return sameYear
		? `${month} ${day}`
		: `${month} ${day}, ${date.getFullYear()}`;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function stringifySimpleValue(value: unknown): string {
	if (value === null || value === undefined || value === "") return "-";
	if (typeof value === "object") {
		if (value instanceof Date && !Number.isNaN(value.getTime())) {
			return formatShortDate(value);
		}
		const record = value as Record<string, unknown>;
		return String(
			record.title ?? record.name ?? record.label ?? record.id ?? "-",
		);
	}
	if (typeof value === "string" && ISO_DATE_RE.test(value)) {
		const date = new Date(value);
		if (!Number.isNaN(date.getTime())) return formatShortDate(date);
	}
	return String(value);
}

function ListViewInner({
	collection,
	config,
	viewConfig,
	navigate,
	basePath = "/admin",
	showSearch = true,
	showFilters = true,
	showToolbar = true,
	realtime,
	headerActions,
	actionsConfig,
}: ListViewProps): React.ReactElement {
	"use no memo";
	const globalRealtimeConfig = useAdminStore(selectRealtime);
	const { fields: resolvedFields, schema } = useCollectionFields(collection, {
		fallbackFields: (config as any)?.fields,
	});
	const { collections: uploadCollections } = useUploadCollection();
	const schemaListConfig = mapListSchemaToConfig(schema?.admin?.list as any);
	const resolvedListConfig =
		viewConfig ??
		(config?.list as any)?.["~config"] ??
		config?.list ??
		schemaListConfig;
	const resolvedRealtime =
		realtime ??
		((resolvedListConfig as any)?.realtime as boolean | undefined) ??
		globalRealtimeConfig.enabled;
	const { user } = useSessionState();
	const { data: collectionMeta } = useSuspenseCollectionMeta(collection);
	const { t, locale: uiLocale } = useTranslation();
	const resolveText = useResolveText();
	const { locale: contentLocale, setLocale: setContentLocale } =
		useScopedLocale();
	const contentLocales = useSafeContentLocales();
	const localeOptions = contentLocales?.locales ?? [];
	const { queryOpts, locale } = useQuestpieQueryOptions();

	const rawActionsConfig =
		actionsConfig ?? (resolvedListConfig as any)?.actions;
	const { serverActions } = useServerActions({ collection });
	const mergedActionsConfig = React.useMemo(
		() =>
			mergeServerActions(
				(rawActionsConfig ?? {}) as ActionsConfig,
				serverActions,
			),
		[rawActionsConfig, serverActions],
	);
	const {
		helpers: actionHelpers,
		actions,
		dialogAction,
		dialogItem,
		openDialog,
		closeDialog,
	} = useActions({
		collection,
		actionsConfig: mergedActionsConfig,
	});
	const canUploadToCollection =
		uploadCollections.includes(collection) &&
		schema?.access?.operations?.create?.allowed === true;

	const columns = React.useMemo(
		() =>
			buildColumns({
				config: {
					fields: resolvedFields,
					list: resolvedListConfig,
				},
				fallbackColumns: ["id"],
				buildAllColumns: true,
				meta: collectionMeta,
			}),
		[resolvedFields, resolvedListConfig, collectionMeta],
	);
	const columnsByKey = React.useMemo(() => {
		const map = new Map<string, ColumnDef<any>>();
		for (const column of columns) {
			const key = getColumnKey(column as ColumnDef<any>);
			if (key) map.set(key, column as ColumnDef<any>);
		}
		return map;
	}, [columns]);

	const [isSheetOpen, setIsSheetOpen] = useSidebarSearchParam("view-options", {
		legacyKey: "viewOptions",
	});
	const [searchTerm, setSearchTerm] = React.useState("");
	const [isSearchPanelOpen, setIsSearchPanelOpen] = React.useState(false);
	const [toggledOutlineKeys, setToggledOutlineKeys] = React.useState<
		Set<string>
	>(() => new Set());
	const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});

	const defaultColumns = React.useMemo(
		() =>
			computeDefaultColumns(resolvedFields, {
				meta: collectionMeta,
				configuredColumns: resolvedListConfig?.columns as any,
			}),
		[resolvedFields, resolvedListConfig?.columns, collectionMeta],
	);
	const groupingConfig = resolvedListConfig?.grouping;
	const defaultGroupBy = groupingConfig?.defaultField ?? null;
	const defaultFilters = React.useMemo(
		() => resolvedListConfig?.defaultFilters ?? [],
		[resolvedListConfig?.defaultFilters],
	);
	const initialViewConfig = React.useMemo(
		() => ({
			realtime: resolvedRealtime,
			groupBy: defaultGroupBy,
			filters: defaultFilters,
		}),
		[resolvedRealtime, defaultGroupBy, defaultFilters],
	);
	const viewState = useViewState(
		defaultColumns,
		initialViewConfig,
		collection,
		user?.id,
	);
	const effectiveRealtime = viewState.config.realtime ?? resolvedRealtime;
	const visibleColumns =
		viewState.config.visibleColumns.length > 0
			? viewState.config.visibleColumns
			: defaultColumns;
	const layout = resolvedListConfig?.layout;
	const titleField =
		layout?.titleField ??
		(collectionMeta?.title?.type === "field"
			? collectionMeta.title.fieldName
			: undefined);
	const subtitleField = layout?.subtitleField;
	const leadingFields = normalizeFieldList(layout?.leadingFields);
	const badgeFields = normalizeFieldList(layout?.badgeFields);
	const metaFields = normalizeFieldList(layout?.metaFields);
	const density = layout?.density ?? "compact";
	const outlineRelationNames = React.useMemo(
		() => extractRelationNamesFromOutline(resolvedListConfig?.outline),
		[resolvedListConfig?.outline],
	);
	const visibleColumnsForExpansion = React.useMemo(
		() =>
			Array.from(
				new Set([
					...visibleColumns,
					...outlineRelationNames,
					...metaFields,
					...leadingFields,
					...badgeFields,
				]),
			),
		[
			visibleColumns,
			outlineRelationNames,
			metaFields,
			leadingFields,
			badgeFields,
		],
	);
	const expandedFields = React.useMemo(
		() =>
			autoExpandFields({
				fields: resolvedFields,
				list: resolvedListConfig as any,
				visibleColumns: visibleColumnsForExpansion,
				relations: collectionMeta?.relations,
			}),
		[
			resolvedFields,
			resolvedListConfig,
			visibleColumnsForExpansion,
			collectionMeta?.relations,
		],
	);
	const isKnownSortField = React.useCallback(
		(field: string | undefined) =>
			!!field && (field === "_title" || !!resolvedFields?.[field]),
		[resolvedFields],
	);
	const effectiveSort = React.useMemo(() => {
		if (isKnownSortField(viewState.config.sortConfig?.field)) {
			return viewState.config.sortConfig;
		}
		if (isKnownSortField(resolvedListConfig?.defaultSort?.field)) {
			return resolvedListConfig.defaultSort;
		}
		return { field: "createdAt", direction: "desc" as const };
	}, [
		viewState.config.sortConfig,
		resolvedListConfig?.defaultSort,
		isKnownSortField,
	]);

	const availableFields: AvailableField[] = React.useMemo(
		() => getAllAvailableFields(resolvedFields, { meta: collectionMeta }),
		[resolvedFields, collectionMeta],
	);
	const fieldByName = React.useMemo(
		() => new Map(availableFields.map((field) => [field.name, field])),
		[availableFields],
	);
	const effectiveOutline = React.useMemo(() => {
		const outline = resolvedListConfig?.outline;
		const groupBy = viewState.config.groupBy;
		if (!groupBy) return outline;
		const levels = outline?.levels ?? [];
		const first = levels[0];
		if (first?.kind === "field" && first.field === groupBy) return outline;
		return {
			...outline,
			defaultExpanded: outline?.defaultExpanded ?? true,
			levels: [{ kind: "field" as const, field: groupBy }, ...levels],
		};
	}, [resolvedListConfig?.outline, viewState.config.groupBy]);

	const hasOutline = (resolvedListConfig?.outline?.levels?.length ?? 0) > 0;

	const firstFieldLevel = React.useMemo(() => {
		const first = effectiveOutline?.levels?.[0];
		return first?.kind === "field" ? first : null;
	}, [effectiveOutline]);

	const groupValues = React.useMemo(() => {
		if (!firstFieldLevel) return null;
		const fieldDef = fieldByName.get(firstFieldLevel.field);
		if (fieldDef?.type !== "select" || !fieldDef.options?.options) return null;
		const flat = flattenOptions(fieldDef.options.options as any);
		const order = firstFieldLevel.order;
		if (Array.isArray(order)) {
			return order.map(
				(v) =>
					flat.find((o) => String(o.value) === String(v)) ?? {
						value: v,
						label: { en: String(v) },
					},
			);
		}
		return flat;
	}, [firstFieldLevel, fieldByName]);

	const filteredGroupValues = React.useMemo(() => {
		if (!groupValues || !firstFieldLevel) return groupValues;
		const groupField = firstFieldLevel.field;
		const relevant = viewState.config.filters.filter(
			(f) => f.field === groupField,
		);
		if (relevant.length === 0) return groupValues;
		return groupValues.filter((gv) => {
			const val = String(gv.value);
			for (const filter of relevant) {
				switch (filter.operator) {
					case "equals":
						if (String(filter.value) !== val) return false;
						break;
					case "not_equals":
						if (String(filter.value) === val) return false;
						break;
					case "in":
						if (
							!Array.isArray(filter.value) ||
							!filter.value.map(String).includes(val)
						)
							return false;
						break;
					case "not_in":
						if (
							Array.isArray(filter.value) &&
							filter.value.map(String).includes(val)
						)
							return false;
						break;
				}
			}
			return true;
		});
	}, [groupValues, firstFieldLevel, viewState.config.filters]);

	const isGrouped =
		filteredGroupValues != null && filteredGroupValues.length > 0;

	const [groupLimits, setGroupLimits] = React.useState<Record<string, number>>(
		{},
	);
	const DEFAULT_GROUP_LIMIT = 20;
	const loadMoreInGroup = React.useCallback((groupKey: string) => {
		setGroupLimits((prev) => ({
			...prev,
			[groupKey]: (prev[groupKey] ?? DEFAULT_GROUP_LIMIT) + DEFAULT_GROUP_LIMIT,
		}));
	}, []);

	const baseQueryOptions = React.useMemo(() => {
		const options: any = {};
		if (collectionMeta?.softDelete) {
			options.includeDeleted = !!viewState.config.includeDeleted;
		}
		if (hasFieldsToExpand(expandedFields)) options.with = expandedFields;
		const where = buildFilterWhere({
			filters: viewState.config.filters,
			resolvedFields,
			relationNames: collectionMeta?.relations ?? [],
		});
		if (where) options.where = where;

		const sortConfig = effectiveSort;
		if (sortConfig) {
			options.orderBy = { [sortConfig.field]: sortConfig.direction };
		}
		return options;
	}, [
		collectionMeta?.softDelete,
		collectionMeta?.relations,
		viewState.config.includeDeleted,
		viewState.config.filters,
		expandedFields,
		effectiveSort,
		resolvedFields,
	]);

	const flatQueryOptions = React.useMemo(() => {
		if (isGrouped) return baseQueryOptions;
		const options = { ...baseQueryOptions };
		const groupBy = viewState.config.groupBy;
		const sortConfig = effectiveSort;
		if (groupBy && sortConfig?.field && sortConfig.field !== groupBy) {
			options.orderBy = [
				{ [groupBy]: "asc" },
				{ [sortConfig.field]: sortConfig.direction },
			];
		}
		if (hasOutline && !isGrouped) {
			options.limit = 500;
		} else {
			const pageSize = viewState.config.pagination?.pageSize ?? 25;
			const page = viewState.config.pagination?.page ?? 1;
			options.limit = pageSize;
			options.offset = (page - 1) * pageSize;
		}
		return options;
	}, [
		baseQueryOptions,
		isGrouped,
		hasOutline,
		viewState.config.groupBy,
		viewState.config.pagination?.page,
		viewState.config.pagination?.pageSize,
		effectiveSort,
	]);

	const debouncedSearchTerm = useDebouncedValue(searchTerm, 300);
	const isSearching = debouncedSearchTerm.trim().length > 0;
	const {
		data: searchData,
		isLoading: searchLoading,
		isFetching: searchFetching,
	} = useSearch(
		{
			collection,
			query: debouncedSearchTerm,
			limit: 100,
			highlights: true,
		},
		{ enabled: isSearching },
	);

	const groupQueries = useQueries({
		queries:
			isGrouped && !isSearching
				? filteredGroupValues.map((gv) => {
						const groupKey = String(gv.value);
						const limit = groupLimits[groupKey] ?? DEFAULT_GROUP_LIMIT;
						const groupWhere = {
							...baseQueryOptions.where,
							[firstFieldLevel!.field]: gv.value,
						};
						const collectionQueries = (queryOpts as any).collections?.[
							collection as string
						];
						if (!collectionQueries?.find) {
							return {
								queryKey: ["questpie", "group-missing", collection, groupKey],
								queryFn: async () => ({ docs: [], totalDocs: 0 }),
								enabled: false,
							};
						}
						return collectionQueries.find(
							{
								...baseQueryOptions,
								where: groupWhere,
								limit,
								offset: 0,
								locale,
							},
							{ realtime: false },
						);
					})
				: [],
	});

	const {
		data: listData,
		isLoading: listLoading,
		error: listError,
	} = useCollectionList(
		collection as any,
		flatQueryOptions,
		{ enabled: !isSearching && !isGrouped },
		{ realtime: effectiveRealtime },
	);

	const groupDataVersion = isGrouped
		? groupQueries.map((q) => q.dataUpdatedAt).join(",")
		: "";
	const items = React.useMemo(() => {
		if (isSearching) return searchData?.docs ?? [];
		if (isGrouped) {
			return groupQueries.flatMap((q) => (q.data as any)?.docs ?? []);
		}
		return listData?.docs ?? [];
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		isSearching,
		isGrouped,
		searchData?.docs,
		groupDataVersion,
		listData?.docs,
	]);
	const isLoading = isSearching
		? searchLoading
		: isGrouped
			? groupQueries.some((q) => q.isLoading)
			: listLoading;
	const isSearchActive = isSearching && searchFetching;
	const { isHighlighted } = useRealtimeHighlight(items, {
		enabled: effectiveRealtime && !isSearching,
	});
	const { getLock, isLocked: isDocLocked } = useLocks({
		resourceType: "collection",
		resource: collection,
		realtime: effectiveRealtime,
	});

	const edgeLevels = React.useMemo(
		() => extractEdgeLevels(resolvedListConfig?.outline),
		[resolvedListConfig?.outline],
	);
	const edgeQueries = useQueries({
		queries: edgeLevels.map((level) => {
			const collectionQueries = (queryOpts as any).collections?.[
				level.collection
			];
			if (!collectionQueries?.find) {
				return {
					queryKey: ["questpie", "outline-edge-missing", level.collection],
					queryFn: async () => ({ docs: [] }),
					enabled: false,
				};
			}
			return collectionQueries.find({
				where: level.where,
				with: {
					[level.parentField]: true,
					[level.childField]: true,
				},
				limit: 1000,
				locale,
			});
		}),
	});
	const edgesByCollection = React.useMemo(() => {
		const map: Record<string, Record<string, unknown>[]> = {};
		edgeLevels.forEach((level, index) => {
			const docs = (edgeQueries[index]?.data as any)?.docs ?? [];
			map[level.collection] = [...(map[level.collection] ?? []), ...docs];
		});
		return map;
	}, [edgeLevels, edgeQueries]);

	const metaForValue = React.useCallback(
		(value: unknown, field?: string): OutlineGroupMeta | undefined => {
			if (!field) return undefined;
			const fieldDef = fieldByName.get(field);
			if (fieldDef?.type !== "select") return undefined;
			const options = fieldDef?.options?.options;
			if (!Array.isArray(options)) return undefined;
			const flat = flattenOptions(options as any);
			const option = flat.find((opt) => String(opt.value) === String(value));
			if (!option) return undefined;
			if (!option.icon && !option.className) return undefined;
			return { icon: option.icon, className: option.className };
		},
		[fieldByName],
	);
	const remainingOutline = React.useMemo(() => {
		if (!isGrouped || !effectiveOutline) return effectiveOutline;
		return {
			...effectiveOutline,
			levels: effectiveOutline.levels.slice(1),
		};
	}, [isGrouped, effectiveOutline]);

	const labelForValue = React.useCallback(
		(value: unknown, field?: string) =>
			stringifyGroupValue(
				value,
				field ? fieldByName.get(field) : undefined,
				resolveText,
				t,
				uiLocale,
				t("common.noValue"),
			),
		[fieldByName, resolveText, t, uiLocale],
	);

	const outlineRows = React.useMemo(
		() =>
			isGrouped
				? []
				: buildOutlineRows({
						docs: items as Record<string, unknown>[],
						outline: effectiveOutline,
						edgesByCollection,
						toggledKeys: toggledOutlineKeys,
						labelForValue,
						metaForValue,
					}),
		[
			isGrouped,
			items,
			effectiveOutline,
			edgesByCollection,
			toggledOutlineKeys,
			labelForValue,
			metaForValue,
		],
	);

	const allGroupDocs = React.useMemo(() => {
		if (!isGrouped) return undefined;
		return groupQueries.flatMap(
			(q) => ((q.data as any)?.docs ?? []) as Record<string, unknown>[],
		);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isGrouped, groupDataVersion]);

	const groupOutlineRows = React.useMemo(() => {
		if (!isGrouped) return [];
		return filteredGroupValues.map((gv, i) => {
			const docs = ((groupQueries[i]?.data as any)?.docs ?? []) as Record<
				string,
				unknown
			>[];
			if (docs.length === 0) return [];
			const outline = remainingOutline;
			if (!outline || outline.levels.length === 0) {
				return docs.map(
					(doc) =>
						({
							kind: "record" as const,
							key: `record:${(doc as any).id}`,
							id: String((doc as any).id),
							doc,
							depth: 0,
						}) satisfies OutlineRow,
				);
			}
			return buildOutlineRows({
				docs,
				outline,
				edgesByCollection,
				toggledKeys: toggledOutlineKeys,
				labelForValue,
				metaForValue,
				allDocs: allGroupDocs,
			});
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		isGrouped,
		filteredGroupValues,
		groupDataVersion,
		remainingOutline,
		edgesByCollection,
		toggledOutlineKeys,
		labelForValue,
		metaForValue,
		allGroupDocs,
	]);

	const table = useReactTable({
		data: items as any[],
		columns,
		getCoreRowModel: getCoreRowModel(),
		enableRowSelection: true,
		onRowSelectionChange: setRowSelection,
		getRowId: (row: any) => String(row.id),
		state: { rowSelection },
	});
	const rowsById = React.useMemo(() => {
		const map = new Map<string, any>();
		for (const row of table.getRowModel().rows) {
			map.set(String(row.id), row);
			const originalId = (row.original as any)?.id;
			if (originalId !== undefined && originalId !== null) {
				map.set(String(originalId), row);
			}
		}
		return map;
	}, [table]);
	const deleteMutation = useCollectionDelete(collection as any);
	const restoreMutation = useCollectionRestore(collection as any);
	const { data: savedViewsData, isLoading: savedViewsLoading } = useSavedViews(
		collection,
		user?.id,
	);
	const saveViewMutation = useSaveView(collection, user?.id);
	const deleteViewMutation = useDeleteSavedView(collection, user?.id);
	const hasActiveFilters = viewState.config.filters.length > 0;
	const hasViewOptionsState =
		hasActiveFilters ||
		!!viewState.config.sortConfig ||
		!!viewState.config.groupBy ||
		!!viewState.config.includeDeleted;
	const groupableFields = React.useMemo(() => {
		const groupableNames = groupingConfig?.fields ?? [];
		if (groupableNames.length === 0) return [];
		const groupableSet = new Set(groupableNames);
		return availableFields.filter((field) => groupableSet.has(field.name));
	}, [availableFields, groupingConfig?.fields]);

	const clearFilters = React.useCallback(() => {
		viewState.setConfig({ ...viewState.config, filters: [] });
	}, [viewState]);
	const applyQuickFilters = React.useCallback(
		(filters: ViewConfiguration["filters"]) => {
			viewState.setConfig((current) => ({
				...current,
				filters,
				pagination: {
					...(current.pagination ?? { pageSize: 25 }),
					page: 1,
				},
			}));
		},
		[viewState],
	);
	const handleSaveView = React.useCallback(
		(name: string, configuration: ViewConfiguration) => {
			saveViewMutation.mutate({ name, configuration });
		},
		[saveViewMutation],
	);
	const handleBulkDelete = React.useCallback(
		async (ids: string[]) => {
			await Promise.allSettled(
				ids.map((id) => deleteMutation.mutateAsync({ id })),
			);
			actionHelpers.invalidateCollection(collection);
		},
		[deleteMutation, actionHelpers, collection],
	);
	const handleBulkRestore = React.useCallback(
		async (ids: string[]) => {
			await Promise.allSettled(
				ids.map((id) => restoreMutation.mutateAsync({ id })),
			);
			actionHelpers.invalidateCollection(collection);
		},
		[restoreMutation, actionHelpers, collection],
	);
	const toggleOutlineKey = React.useCallback((key: string) => {
		setToggledOutlineKeys((current) => {
			const next = new Set(current);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	}, []);
	const renderField = React.useCallback(
		(row: any, field: string, fallback?: unknown) => {
			const column = columnsByKey.get(field);
			const cell = row?.getAllCells?.().find((candidate: any) => {
				const key = getColumnKey(candidate.column.columnDef);
				return key === field || candidate.column.id === field;
			});
			if (cell && column) {
				return flexRender(cell.column.columnDef.cell, cell.getContext());
			}
			return (
				<SimpleValue value={fallback ?? getValueAtPath(row?.original, field)} />
			);
		},
		[columnsByKey],
	);
	const resolveFieldValue = React.useCallback(
		(item: Record<string, unknown>, field: string): unknown => {
			const value = getValueAtPath(item, field);
			if (value != null && typeof value === "object") return value;
			const fieldDef = fieldByName.get(field);
			if (fieldDef?.type === "relation") {
				const accessor = fieldDef.options?.relationName ?? field;
				const expanded = getValueAtPath(item, accessor);
				if (expanded && typeof expanded === "object") return expanded;
			}
			return value;
		},
		[fieldByName],
	);
	const renderMetaField = React.useCallback(
		(field: string, value: unknown): React.ReactNode => {
			if (value === null || value === undefined || value === "") {
				return <span className="text-muted-foreground/40">-</span>;
			}
			const fieldDef = fieldByName.get(field);
			const isDate =
				fieldDef?.type === "datetime" ||
				fieldDef?.type === "date" ||
				field === "updatedAt" ||
				field === "createdAt";
			if (isDate) {
				const str =
					typeof value === "string" && ISO_DATE_RE.test(value)
						? formatShortDate(new Date(value))
						: value instanceof Date
							? formatShortDate(value)
							: String(value);
				return <span>{str}</span>;
			}
			const label =
				typeof value === "object"
					? String(
							(value as any).title ??
								(value as any).name ??
								(value as any).label ??
								(value as any).id ??
								"-",
						)
					: String(value);
			return (
				<Badge variant="secondary" className="max-w-full truncate">
					{label}
				</Badge>
			);
		},
		[fieldByName],
	);
	const renderLeadingIcon = React.useCallback(
		(field: string, value: unknown): React.ReactNode => {
			const fieldDef = fieldByName.get(field);
			if (fieldDef?.type === "select" && fieldDef.options?.options) {
				const flat = flattenOptions(fieldDef.options.options as any);
				const option = flat.find((opt) => String(opt.value) === String(value));
				if (option?.icon) {
					return resolveIconElement(option.icon as any);
				}
			}
			return null;
		},
		[fieldByName],
	);
	const handleRowClick = React.useCallback(
		(item: any) => navigate(`${basePath}/collections/${collection}/${item.id}`),
		[navigate, basePath, collection],
	);

	if (listError && !isSearching) {
		const errorMessage =
			listError instanceof Error ? listError.message : undefined;
		return (
			<div className="container">
				<EmptyState
					variant="error"
					iconName="ph:warning-circle"
					title={t("error.failedToLoad")}
					description={errorMessage}
					height="h-64"
					action={
						<Button
							variant="outline"
							size="sm"
							className="gap-2"
							onClick={() => window.location.reload()}
						>
							<Icon icon="ph:arrow-clockwise" className="size-3.5" />
							{t("common.retry")}
						</Button>
					}
				/>
			</div>
		);
	}

	if (isLoading) return <TableViewSkeleton />;

	const emptyStateTitle =
		isSearching || hasActiveFilters
			? t("collectionSearch.noResults")
			: t("table.noItemsInCollection");
	const emptyStateDescription = isSearching
		? t("collectionSearch.noResultsDescription")
		: hasActiveFilters
			? t("viewOptions.noResultsDescription")
			: t("table.emptyDescription");

	return (
		<AdminViewLayout
			header={
				<AdminViewHeader
					title={resolveText(
						(config as any)?.label ?? schema?.admin?.config?.label,
						collection,
					)}
					titleAccessory={
						localeOptions.length > 0 ? (
							<LocaleSwitcher
								locales={localeOptions}
								value={contentLocale}
								onChange={setContentLocale}
							/>
						) : undefined
					}
					description={resolveText(
						(config as any)?.description ?? schema?.admin?.config?.description,
					)}
					actions={
						<>
							{showSearch && (
								<Tooltip>
									<TooltipTrigger
										render={
											<Button
												variant="outline"
												size="icon-sm"
												className="relative"
												onClick={() => setIsSearchPanelOpen((open) => !open)}
												aria-label={t("common.search")}
											>
												<Icon icon="ph:magnifying-glass" />
												{searchTerm && (
													<span className="bg-foreground absolute top-1 right-1 size-1.5 rounded-full" />
												)}
											</Button>
										}
									/>
									<TooltipContent side="bottom" align="end">
										{t("common.search")}
									</TooltipContent>
								</Tooltip>
							)}
							{showFilters && (
								<Tooltip>
									<TooltipTrigger
										render={
											<Button
												variant="outline"
												size="icon-sm"
												className={cn(
													"relative",
													hasViewOptionsState && "border-foreground",
												)}
												onClick={() => setIsSheetOpen(true)}
												aria-label={t("viewOptions.title")}
											>
												<Icon icon="ph:sliders-horizontal" />
												{hasViewOptionsState && (
													<span className="bg-foreground absolute top-1 right-1 size-1.5 rounded-full" />
												)}
											</Button>
										}
									/>
									<TooltipContent side="bottom" align="end">
										{t("viewOptions.title")}
									</TooltipContent>
								</Tooltip>
							)}
							{canUploadToCollection && showToolbar && (
								<UploadCollectionButton
									collection={collection}
									onUploaded={() =>
										actionHelpers.invalidateCollection(collection)
									}
								/>
							)}
							<HeaderActions
								actions={actions.header}
								collection={collection}
								helpers={actionHelpers}
								onOpenDialog={(action) => openDialog(action)}
							/>
							{headerActions}
						</>
					}
				/>
			}
		>
			<div className="space-y-3">
				{showSearch && isSearchPanelOpen && (
					<div className="border-border-subtle bg-muted/20 rounded-md border p-3">
						<SearchInput
							value={searchTerm}
							onChange={(event) => setSearchTerm(event.target.value)}
							onClear={() => setSearchTerm("")}
							placeholder={t("collectionSearch.placeholder")}
							isLoading={isSearchActive}
						/>
					</div>
				)}

				<QuickFilterBar
					quickFilters={resolvedListConfig?.quickFilters}
					currentFilters={viewState.config.filters}
					onApply={applyQuickFilters}
				/>

				{(() => {
					const isEmpty = isGrouped
						? groupOutlineRows.every((g) => g.length === 0)
						: outlineRows.length === 0;

					if (isEmpty) {
						return (
							<EmptyState
								title={emptyStateTitle}
								description={emptyStateDescription}
								height="h-64"
								action={
									isSearching || hasActiveFilters ? (
										<div className="flex gap-2">
											{isSearching && (
												<Button
													variant="outline"
													size="sm"
													className="gap-2"
													onClick={() => setSearchTerm("")}
												>
													<Icon icon="ph:x" className="size-3.5" />
													{t("common.clear")}
												</Button>
											)}
											{hasActiveFilters && (
												<Button
													variant="outline"
													size="sm"
													className="gap-2"
													onClick={clearFilters}
												>
													<Icon icon="ph:funnel-x" className="size-3.5" />
													{t("viewOptions.clearFilters")}
												</Button>
											)}
										</div>
									) : undefined
								}
							/>
						);
					}

					const renderRecordRow = (
						outlineRow: Extract<OutlineRow, { kind: "record" }>,
						groupContext?: { field: string; value: unknown },
					) => {
						const tableRow = rowsById.get(outlineRow.id);
						const item = (tableRow?.original ?? outlineRow.doc) as any;
						const lock = getLock(item.id);
						const locked = isDocLocked(item.id);
						const lockUser = lock ? getLockUser(lock) : null;
						const isSelected = tableRow?.getIsSelected() ?? false;
						const titleValue =
							(titleField
								? getValueAtPath(item, titleField)
								: item["_title"]) ??
							item.title ??
							item.name ??
							item.id;
						const subtitleValue = subtitleField
							? getValueAtPath(item, subtitleField)
							: undefined;
						const isGroupMismatch =
							groupContext != null &&
							getValueAtPath(item, groupContext.field) !== groupContext.value;

						return (
							<div
								key={outlineRow.key}
								data-state={isSelected ? "selected" : undefined}
								className={cn(
									"group/list-row hover:bg-muted/40 data-[state=selected]:bg-muted/60 relative flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-4 text-sm transition-colors",
									density === "compact" ? "min-h-9 py-1" : "min-h-11 py-2",
									isHighlighted(item.id) && "bg-info/10",
									isGroupMismatch && "opacity-45",
								)}
							>
								{outlineRow.depth > 0 && (
									<span
										className="bg-border/40 absolute top-0 bottom-0 w-px"
										style={{
											left: `${52 + (outlineRow.depth - 1) * 18}px`,
										}}
										aria-hidden="true"
									/>
								)}
								<div
									role="presentation"
									data-state={isSelected ? "selected" : undefined}
									className="shrink-0 opacity-0 transition-opacity duration-[var(--motion-duration-fast)] group-hover/list-row:opacity-100 data-[state=selected]:opacity-100"
									onClick={(event) => event.stopPropagation()}
									onKeyDown={(event) => event.stopPropagation()}
								>
									<Checkbox
										checked={isSelected}
										disabled={!tableRow || !tableRow.getCanSelect()}
										onCheckedChange={(checked) =>
											tableRow?.toggleSelected(!!checked)
										}
										aria-label={t("table.selectRow")}
									/>
								</div>
								{outlineRow.expandable ? (
									<button
										type="button"
										className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/40 -ml-1 flex size-7 shrink-0 items-center justify-center rounded-[var(--control-radius-inner)] transition-[background-color,color,box-shadow] focus-visible:ring-2 focus-visible:outline-none"
										onClick={(event) => {
											event.stopPropagation();
											toggleOutlineKey(outlineRow.key);
										}}
										aria-label={
											outlineRow.collapsed
												? t("a11y.expand")
												: t("a11y.collapse")
										}
									>
										<Icon
											icon="ph:caret-right-bold"
											className={cn(
												"size-3 transition-transform",
												!outlineRow.collapsed && "rotate-90",
											)}
										/>
									</button>
								) : null}
								<button
									type="button"
									className="focus-visible:ring-ring/40 -my-1 min-w-0 flex-1 rounded-[var(--control-radius-inner)] py-1 text-left focus-visible:ring-2 focus-visible:outline-none"
									style={
										outlineRow.depth > 0
											? { paddingLeft: `${outlineRow.depth * 18}px` }
											: undefined
									}
									onClick={() => handleRowClick(item)}
								>
									<div className="flex min-w-0 items-center gap-2">
										{leadingFields.map((field) => {
											const fieldValue = getValueAtPath(item, field);
											const icon = renderLeadingIcon(field, fieldValue);
											return (
												<span
													key={field}
													className="flex size-4 shrink-0 items-center justify-center"
												>
													{icon || renderField(tableRow, field, fieldValue)}
												</span>
											);
										})}
										<span
											className={cn(
												"truncate",
												outlineRow.depth > 0
													? "text-muted-foreground font-normal"
													: "text-foreground font-medium",
											)}
										>
											{titleField
												? renderField(tableRow, titleField, titleValue)
												: stringifySimpleValue(titleValue)}
										</span>
										{badgeFields.map((field) => {
											const fieldValue = getValueAtPath(item, field);
											const icon = renderLeadingIcon(field, fieldValue);
											if (icon) {
												return (
													<span
														key={field}
														className="flex size-4 shrink-0 items-center justify-center"
													>
														{icon}
													</span>
												);
											}
											return (
												<span
													key={field}
													className="text-muted-foreground inline-flex max-w-36 shrink-0 items-center text-xs"
												>
													<span className="truncate">
														{renderField(tableRow, field, fieldValue)}
													</span>
												</span>
											);
										})}
										{locked && (
											<span className="text-warning inline-flex items-center gap-1 text-xs">
												<Icon icon="ph:lock-key" className="size-3" />
												{lockUser?.name ?? t("collection.locked")}
											</span>
										)}
									</div>
									{subtitleValue !== undefined && (
										<div className="text-muted-foreground mt-0.5 truncate text-xs">
											{renderField(tableRow, subtitleField!, subtitleValue)}
										</div>
									)}
								</button>
								{metaFields.length > 0 && (
									<div className="text-muted-foreground hidden shrink-0 items-center gap-2 text-xs md:flex">
										{metaFields.map((field) => (
											<span
												key={field}
												className="flex w-28 min-w-0 items-center justify-end"
											>
												{renderMetaField(field, resolveFieldValue(item, field))}
											</span>
										))}
									</div>
								)}
								{actions.row.length > 0 && (
									<div
										role="presentation"
										className="flex shrink-0 justify-end gap-1 opacity-0 transition-opacity group-hover/list-row:opacity-100 focus-within:opacity-100"
										onClick={(event) => event.stopPropagation()}
										onKeyDown={(event) => event.stopPropagation()}
									>
										{actions.row.map((action) => (
											<ActionButton
												key={action.id}
												action={action}
												collection={collection}
												item={item}
												helpers={actionHelpers}
												size="icon-sm"
												iconOnly
												onOpenDialog={(dialogAction) =>
													openDialog(dialogAction, item)
												}
											/>
										))}
									</div>
								)}
							</div>
						);
					};

					if (isGrouped) {
						return (
							<div className="flex flex-col gap-1.5 overflow-hidden">
								{filteredGroupValues.map((gv, i) => {
									const rows = groupOutlineRows[i] ?? [];
									const queryData = groupQueries[i]?.data as any;
									const totalDocs = queryData?.totalDocs ?? 0;
									const loadedCount = (queryData?.docs ?? []).length;
									const groupKey = String(gv.value);
									const groupLabel = labelForValue(
										gv.value,
										firstFieldLevel?.field,
									);
									const meta = metaForValue(gv.value, firstFieldLevel?.field);
									const groupIcon = meta?.icon
										? resolveIconElement(meta.icon as any)
										: null;
									const isGroupLoading = groupQueries[i]?.isLoading ?? false;

									if (totalDocs === 0 && !isGroupLoading) return null;

									const groupToggleKey = `group:${groupKey}`;
									const isGroupCollapsed =
										toggledOutlineKeys.has(groupToggleKey);

									return (
										<div key={groupKey} className="flex flex-col">
											<button
												type="button"
												className="bg-muted/[0.06] hover:bg-muted/20 flex min-h-8 items-center gap-2 rounded-md px-3 py-1 text-left transition-colors"
												onClick={() => toggleOutlineKey(groupToggleKey)}
												aria-expanded={!isGroupCollapsed}
											>
												<Icon
													icon="ph:caret-right-bold"
													className={cn(
														"text-muted-foreground size-3 shrink-0 transition-transform",
														!isGroupCollapsed && "rotate-90",
													)}
												/>
												{groupIcon && (
													<span className="size-4 shrink-0">{groupIcon}</span>
												)}
												<span className="text-muted-foreground text-xs font-medium">
													{groupLabel}
												</span>
												<span className="text-muted-foreground/60 text-xs tabular-nums">
													{totalDocs}
												</span>
											</button>
											{!isGroupCollapsed &&
												(isGroupLoading ? (
													<div className="flex items-center justify-center py-4">
														<Icon
															icon="ph:spinner-gap"
															className="text-muted-foreground size-4 animate-spin"
														/>
													</div>
												) : (
													<div className="flex flex-col gap-px">
														{rows.map((outlineRow) => {
															if (outlineRow.kind !== "record") {
																return (
																	<OutlineHeaderRow
																		key={outlineRow.key}
																		row={outlineRow}
																		showCounts={
																			resolvedListConfig?.outline?.showCounts ??
																			true
																		}
																		onToggle={toggleOutlineKey}
																	/>
																);
															}
															return renderRecordRow(outlineRow, {
																field: firstFieldLevel!.field,
																value: gv.value,
															});
														})}
														{totalDocs > loadedCount && (
															<button
																type="button"
																className="text-muted-foreground hover:text-foreground hover:bg-muted/50 flex w-full items-center justify-center gap-2 rounded-md py-2 text-xs transition-colors"
																onClick={() => loadMoreInGroup(groupKey)}
															>
																<Icon icon="ph:caret-down" className="size-3" />
																<span>
																	{t("table.loadMore")} (
																	{totalDocs - loadedCount})
																</span>
															</button>
														)}
													</div>
												))}
										</div>
									);
								})}
							</div>
						);
					}

					return (
						<div className="flex flex-col gap-px overflow-hidden">
							{outlineRows.map((outlineRow) => {
								if (outlineRow.kind !== "record") {
									return (
										<OutlineHeaderRow
											key={outlineRow.key}
											row={outlineRow}
											showCounts={
												resolvedListConfig?.outline?.showCounts ?? true
											}
											onToggle={toggleOutlineKey}
										/>
									);
								}
								return renderRecordRow(outlineRow);
							})}
						</div>
					);
				})()}

				{!isSearching && (hasOutline || isGrouped) && (
					<div
						className="text-muted-foreground flex items-center gap-2 py-2 text-sm tabular-nums"
						aria-live="polite"
						aria-atomic="true"
					>
						<span>
							{isGrouped
								? groupQueries.reduce(
										(sum, q) => sum + ((q.data as any)?.totalDocs ?? 0),
										0,
									)
								: items.length}{" "}
							{t("table.items")}
						</span>
					</div>
				)}

				{!isSearching && !hasOutline && !isGrouped && (
					<div
						className="qa-list-view__pagination flex items-center justify-between gap-4 py-2 tabular-nums"
						role="navigation"
						aria-label={t("table.pagination")}
					>
						<div
							className="text-muted-foreground flex items-center gap-4 text-sm"
							aria-live="polite"
							aria-atomic="true"
						>
							<span>
								{items.length > 0
									? `${((viewState.config.pagination?.page ?? 1) - 1) * (viewState.config.pagination?.pageSize ?? 25) + 1}-${Math.min(((viewState.config.pagination?.page ?? 1) - 1) * (viewState.config.pagination?.pageSize ?? 25) + items.length, listData?.totalDocs ?? items.length)}`
									: "0"}{" "}
								{t("table.of")} {listData?.totalDocs ?? 0}
							</span>
							<div className="flex items-center gap-2">
								<span>{t("table.show")}</span>
								<Select
									value={String(viewState.config.pagination?.pageSize ?? 25)}
									onValueChange={(value) =>
										viewState.setPageSize(Number(value))
									}
								>
									<SelectTrigger className="h-8 w-[70px]">
										<SelectValue />
									</SelectTrigger>
									<SelectContent side="top">
										{[10, 25, 50, 100].map((size) => (
											<SelectItem key={size} value={String(size)}>
												{size}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>

						<div className="flex items-center gap-1">
							<Button
								variant="ghost"
								size="sm"
								className="size-8 p-0"
								disabled={(viewState.config.pagination?.page ?? 1) <= 1}
								onClick={() =>
									viewState.setPage(
										(viewState.config.pagination?.page ?? 1) - 1,
									)
								}
								aria-label={t("table.previousPage")}
							>
								<Icon icon="ph:caret-left" className="size-4" />
							</Button>

							{Array.from(
								{
									length: Math.min(5, listData?.totalPages ?? 1),
								},
								(_, i) => {
									const currentPage = viewState.config.pagination?.page ?? 1;
									const totalPages = listData?.totalPages ?? 1;
									let pageNum: number;

									if (totalPages <= 5) {
										pageNum = i + 1;
									} else if (currentPage <= 3) {
										pageNum = i + 1;
									} else if (currentPage >= totalPages - 2) {
										pageNum = totalPages - 4 + i;
									} else {
										pageNum = currentPage - 2 + i;
									}

									return (
										<Button
											key={pageNum}
											variant={currentPage === pageNum ? "secondary" : "ghost"}
											size="sm"
											className="size-8 min-w-8 p-0 tabular-nums"
											onClick={() => viewState.setPage(pageNum)}
											aria-label={t("table.page", { page: pageNum })}
											aria-current={
												currentPage === pageNum ? "page" : undefined
											}
										>
											{pageNum}
										</Button>
									);
								},
							)}

							<Button
								variant="ghost"
								size="sm"
								className="size-8 p-0"
								disabled={
									(viewState.config.pagination?.page ?? 1) >=
									(listData?.totalPages ?? 1)
								}
								onClick={() =>
									viewState.setPage(
										(viewState.config.pagination?.page ?? 1) + 1,
									)
								}
								aria-label={t("table.nextPage")}
							>
								<Icon icon="ph:caret-right" className="size-4" />
							</Button>
						</div>
					</div>
				)}

				{isSearching && (
					<div
						className="text-muted-foreground flex items-center gap-2 py-2 text-sm tabular-nums"
						aria-live="polite"
						aria-atomic="true"
					>
						{isSearchActive && (
							<Icon icon="ph:spinner-gap" className="size-3 animate-spin" />
						)}
						{t("cell.item", { count: items.length })}
					</div>
				)}

				<BulkActionToolbar
					table={table}
					actions={actions.bulk}
					collection={collection}
					helpers={actionHelpers}
					totalCount={isSearching ? items.length : listData?.totalDocs}
					pageCount={items.length}
					onOpenDialog={(action, selectedItems) =>
						openDialog(action as ActionDefinition, selectedItems)
					}
					onBulkDelete={handleBulkDelete}
					onBulkRestore={handleBulkRestore}
					filterCount={viewState.config.filters.length}
					onClearFilters={clearFilters}
					onOpenFilters={() => setIsSheetOpen(true)}
				/>

				<FilterBuilderSheet
					collection={collection}
					availableFields={availableFields}
					currentConfig={viewState.config}
					onConfigChange={viewState.setConfig}
					isOpen={isSheetOpen}
					onOpenChange={setIsSheetOpen}
					defaultColumns={defaultColumns}
					savedViews={savedViewsData?.docs ?? []}
					savedViewsLoading={savedViewsLoading}
					onSaveView={handleSaveView}
					onDeleteView={(viewId) => deleteViewMutation.mutate(viewId)}
					supportsSoftDelete={!!collectionMeta?.softDelete}
					groupableFields={groupableFields}
					defaultGroupBy={defaultGroupBy}
					defaultFilters={defaultFilters}
					panels={{ columns: false }}
				/>

				{dialogAction && (
					<ActionDialog
						open={!!dialogAction}
						onOpenChange={(open) => !open && closeDialog()}
						action={dialogAction}
						collection={collection}
						item={dialogItem}
						helpers={actionHelpers}
					/>
				)}
			</div>
		</AdminViewLayout>
	);
}

function OutlineHeaderRow({
	row,
	showCounts,
	onToggle,
}: {
	row: Extract<OutlineRow, { kind: "group" | "synthetic" }>;
	showCounts: boolean;
	onToggle: (key: string) => void;
}) {
	const groupIcon =
		row.kind === "group" && "icon" in row
			? resolveIconElement(row.icon as any)
			: null;
	return (
		<button
			type="button"
			className="hover:bg-muted/50 focus-visible:ring-ring/40 flex min-h-8 w-full items-center gap-2 px-3 py-1 text-left transition-[background-color,color,box-shadow] focus-visible:ring-2 focus-visible:outline-none"
			onClick={() => onToggle(row.key)}
			aria-expanded={!row.collapsed}
		>
			<Icon
				icon="ph:caret-right-bold"
				className={cn(
					"text-muted-foreground size-3 transition-transform",
					!row.collapsed && "rotate-90",
				)}
			/>
			{row.kind === "synthetic" && (
				<Icon
					icon="ph:folder-simple"
					className="text-muted-foreground size-4"
				/>
			)}
			{groupIcon && <span className="size-4 shrink-0">{groupIcon}</span>}
			<span
				className="text-muted-foreground truncate text-xs font-medium"
				style={
					row.depth > 0 ? { paddingLeft: `${row.depth * 18}px` } : undefined
				}
			>
				{row.label}
			</span>
			{showCounts && (
				<span className="text-muted-foreground/70 ml-1 text-xs tabular-nums">
					{row.count}
				</span>
			)}
		</button>
	);
}

export default function ListView(props: ListViewProps): React.ReactElement {
	return <ListViewInner {...props} />;
}
