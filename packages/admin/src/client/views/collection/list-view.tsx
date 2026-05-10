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
import { FilterBuilderSheet } from "../../components/filter-builder/filter-builder-sheet";
import type {
	AvailableField,
	ViewConfiguration,
} from "../../components/filter-builder/types";
import { LocaleSwitcher } from "../../components/locale-switcher";
import { flattenOptions } from "../../components/primitives/types";
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
import { buildOutlineRows, type OutlineRow } from "./outline";
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

function stringifySimpleValue(value: unknown): string {
	if (value === null || value === undefined || value === "") return "-";
	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		return String(
			record.title ?? record.name ?? record.label ?? record.id ?? "-",
		);
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
	const [collapsedOutlineKeys, setCollapsedOutlineKeys] = React.useState<
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
	const viewState = useViewState(
		defaultColumns,
		{ realtime: resolvedRealtime, groupBy: defaultGroupBy },
		collection,
		user?.id,
	);
	const effectiveRealtime = viewState.config.realtime ?? resolvedRealtime;
	const visibleColumns =
		viewState.config.visibleColumns.length > 0
			? viewState.config.visibleColumns
			: defaultColumns;
	const outlineRelationNames = React.useMemo(
		() => extractRelationNamesFromOutline(resolvedListConfig?.outline),
		[resolvedListConfig?.outline],
	);
	const visibleColumnsForExpansion = React.useMemo(
		() => Array.from(new Set([...visibleColumns, ...outlineRelationNames])),
		[visibleColumns, outlineRelationNames],
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

	const queryOptions = React.useMemo(() => {
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

		const groupBy = viewState.config.groupBy;
		const sortConfig = effectiveSort;
		if (groupBy && sortConfig?.field && sortConfig.field !== groupBy) {
			options.orderBy = [
				{ [groupBy]: "asc" },
				{ [sortConfig.field]: sortConfig.direction },
			];
		} else if (groupBy) {
			options.orderBy = { [groupBy]: sortConfig?.direction ?? "asc" };
		} else if (sortConfig) {
			options.orderBy = { [sortConfig.field]: sortConfig.direction };
		}

		const pageSize = viewState.config.pagination?.pageSize ?? 25;
		const page = viewState.config.pagination?.page ?? 1;
		options.limit = pageSize;
		options.offset = (page - 1) * pageSize;
		return options;
	}, [
		collectionMeta?.softDelete,
		collectionMeta?.relations,
		viewState.config.includeDeleted,
		viewState.config.filters,
		viewState.config.groupBy,
		viewState.config.pagination?.page,
		viewState.config.pagination?.pageSize,
		expandedFields,
		effectiveSort,
		resolvedFields,
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
	const {
		data: listData,
		isLoading: listLoading,
		error: listError,
	} = useCollectionList(
		collection as any,
		queryOptions,
		{ enabled: !isSearching },
		{ realtime: effectiveRealtime },
	);
	const items = React.useMemo(
		() => (isSearching ? (searchData?.docs ?? []) : (listData?.docs ?? [])),
		[isSearching, searchData?.docs, listData?.docs],
	);
	const isLoading = isSearching ? searchLoading : listLoading;
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
	const availableFields: AvailableField[] = React.useMemo(
		() => getAllAvailableFields(resolvedFields, { meta: collectionMeta }),
		[resolvedFields, collectionMeta],
	);
	const fieldByName = React.useMemo(
		() => new Map(availableFields.map((field) => [field.name, field])),
		[availableFields],
	);
	const outlineRows = React.useMemo(
		() =>
			buildOutlineRows({
				docs: items as Record<string, unknown>[],
				outline: effectiveOutline,
				edgesByCollection,
				collapsedKeys: collapsedOutlineKeys,
				labelForValue: (value, field) =>
					stringifyGroupValue(
						value,
						field ? fieldByName.get(field) : undefined,
						resolveText,
						t,
						uiLocale,
						t("common.noValue"),
					),
			}),
		[
			items,
			effectiveOutline,
			edgesByCollection,
			collapsedOutlineKeys,
			fieldByName,
			resolveText,
			t,
			uiLocale,
		],
	);

	const table = useReactTable({
		data: items as any[],
		columns,
		getCoreRowModel: getCoreRowModel(),
		enableRowSelection: true,
		onRowSelectionChange: setRowSelection,
		getRowId: (row: any) => String(row.id),
		state: { rowSelection },
	});
	const rowsById = React.useMemo(
		() => new Map(table.getRowModel().rows.map((row) => [String(row.id), row])),
		[table, items],
	);
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
		!!viewState.config.groupBy ||
		viewState.config.visibleColumns.length !== defaultColumns.length ||
		!!viewState.config.includeDeleted;
	const groupableFields = React.useMemo(() => {
		const groupableNames = groupingConfig?.fields ?? [];
		if (groupableNames.length === 0) return [];
		const groupableSet = new Set(groupableNames);
		return availableFields.filter((field) => groupableSet.has(field.name));
	}, [availableFields, groupingConfig?.fields]);

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

	const clearFilters = React.useCallback(() => {
		viewState.setConfig({ ...viewState.config, filters: [] });
	}, [viewState]);
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
		setCollapsedOutlineKeys((current) => {
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
							<Select
								value={effectiveSort?.field ?? ""}
								onValueChange={(field) =>
									viewState.setSort(
										field
											? {
													field,
													direction: effectiveSort?.direction ?? "asc",
												}
											: null,
									)
								}
							>
								<SelectTrigger className="h-8 w-40">
									<SelectValue placeholder="Sort" />
								</SelectTrigger>
								<SelectContent>
									{availableFields.map((field) => (
										<SelectItem key={field.name} value={field.name}>
											{resolveText(field.label, field.name)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Button
								variant="outline"
								size="icon-sm"
								aria-label="Toggle sort direction"
								onClick={() =>
									viewState.setSort({
										field: effectiveSort?.field ?? "createdAt",
										direction:
											effectiveSort?.direction === "asc" ? "desc" : "asc",
									})
								}
							>
								<Icon
									icon={
										effectiveSort?.direction === "asc"
											? "ph:sort-ascending"
											: "ph:sort-descending"
									}
								/>
							</Button>
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
							autoFocus
							isLoading={isSearchActive}
						/>
					</div>
				)}

				{outlineRows.length === 0 ? (
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
				) : (
					<div className="border-border-subtle overflow-hidden rounded-md border">
						{outlineRows.map((outlineRow) => {
							if (outlineRow.kind !== "record") {
								return (
									<OutlineHeaderRow
										key={outlineRow.key}
										row={outlineRow}
										showCounts={resolvedListConfig?.outline?.showCounts ?? true}
										onToggle={toggleOutlineKey}
									/>
								);
							}

							const tableRow = rowsById.get(outlineRow.id);
							if (!tableRow) return null;
							const item = tableRow.original as any;
							const lock = getLock(item.id);
							const locked = isDocLocked(item.id);
							const lockUser = lock ? getLockUser(lock) : null;
							const isSelected = tableRow.getIsSelected();
							const titleValue =
								(titleField ? getValueAtPath(item, titleField) : item._title) ??
								item.title ??
								item.name ??
								item.id;
							const subtitleValue = subtitleField
								? getValueAtPath(item, subtitleField)
								: undefined;

							return (
								<div
									key={outlineRow.key}
									className={cn(
										"group/list-row border-border-subtle hover:bg-muted/35 flex min-w-0 items-start gap-2 border-b px-3 text-sm transition-colors last:border-b-0",
										density === "compact" ? "py-2" : "py-3",
										isHighlighted(item.id) && "bg-info/10",
										isSelected && "bg-muted/50",
									)}
									style={{ paddingLeft: `${12 + outlineRow.depth * 18}px` }}
								>
									<div
										role="presentation"
										className="mt-0.5 shrink-0"
										onClick={(event) => event.stopPropagation()}
										onKeyDown={(event) => event.stopPropagation()}
									>
										<Checkbox
											checked={isSelected}
											disabled={!tableRow.getCanSelect()}
											onCheckedChange={(checked) =>
												tableRow.toggleSelected(!!checked)
											}
											aria-label="Select row"
										/>
									</div>
									<button
										type="button"
										className={cn(
											"text-muted-foreground mt-0.5 flex size-5 shrink-0 items-center justify-center rounded transition-colors",
											outlineRow.expandable &&
												"hover:bg-muted hover:text-foreground",
										)}
										disabled={!outlineRow.expandable}
										onClick={(event) => {
											event.stopPropagation();
											if (outlineRow.expandable)
												toggleOutlineKey(outlineRow.key);
										}}
										aria-label={
											outlineRow.collapsed ? "Expand row" : "Collapse row"
										}
									>
										{outlineRow.expandable ? (
											<Icon
												icon="ph:caret-right-bold"
												className={cn(
													"size-3 transition-transform",
													!outlineRow.collapsed && "rotate-90",
												)}
											/>
										) : null}
									</button>
									<button
										type="button"
										className="min-w-0 flex-1 text-left"
										onClick={() => handleRowClick(item)}
									>
										<div className="flex min-w-0 items-center gap-2">
											{leadingFields.map((field) => (
												<span key={field} className="shrink-0">
													{renderField(
														tableRow,
														field,
														getValueAtPath(item, field),
													)}
												</span>
											))}
											<span className="text-foreground truncate font-medium">
												{titleField
													? renderField(tableRow, titleField, titleValue)
													: stringifySimpleValue(titleValue)}
											</span>
											{badgeFields.map((field) => (
												<span
													key={field}
													className="bg-muted text-muted-foreground inline-flex h-5 max-w-36 shrink-0 items-center rounded px-1.5 font-mono text-[11px]"
												>
													<span className="truncate">
														{renderField(
															tableRow,
															field,
															getValueAtPath(item, field),
														)}
													</span>
												</span>
											))}
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
										<div className="text-muted-foreground hidden max-w-[42%] shrink-0 items-center justify-end gap-3 overflow-hidden text-right text-xs md:flex">
											{metaFields.map((field) => (
												<span key={field} className="min-w-0 truncate">
													{renderField(
														tableRow,
														field,
														getValueAtPath(item, field),
													)}
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
						})}
					</div>
				)}

				<div className="text-muted-foreground flex flex-col gap-2 text-xs sm:flex-row sm:items-center sm:justify-between">
					<span>
						{isSearching
							? `${items.length} item${items.length === 1 ? "" : "s"}`
							: `${items.length > 0 ? ((viewState.config.pagination?.page ?? 1) - 1) * (viewState.config.pagination?.pageSize ?? 25) + 1 : 0}-${Math.min(((viewState.config.pagination?.page ?? 1) - 1) * (viewState.config.pagination?.pageSize ?? 25) + items.length, listData?.totalDocs ?? items.length)} ${t("table.of")} ${listData?.totalDocs ?? 0}`}
					</span>
					{!isSearching && (listData?.totalPages ?? 1) > 1 && (
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								disabled={(viewState.config.pagination?.page ?? 1) <= 1}
								onClick={() =>
									viewState.setPage(
										Math.max(1, (viewState.config.pagination?.page ?? 1) - 1),
									)
								}
							>
								{t("common.previous")}
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={
									(viewState.config.pagination?.page ?? 1) >=
									(listData?.totalPages ?? 1)
								}
								onClick={() =>
									viewState.setPage(
										(viewState.config.pagination?.page ?? 1) + 1,
									)
								}
							>
								{t("common.next")}
							</Button>
						</div>
					)}
				</div>

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
	return (
		<button
			type="button"
			className="bg-background/95 border-border-subtle sticky top-0 z-10 flex w-full items-center gap-2 border-b px-3 py-2 text-left backdrop-blur"
			style={{ paddingLeft: `${12 + row.depth * 18}px` }}
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
			<span className="font-chrome chrome-meta text-muted-foreground truncate text-[11px] font-semibold tracking-[0.12em] uppercase">
				{row.label}
			</span>
			{showCounts && (
				<span className="font-chrome chrome-meta text-muted-foreground text-[11px] tabular-nums">
					{row.count}
				</span>
			)}
		</button>
	);
}

export default function ListView(props: ListViewProps): React.ReactElement {
	return <ListViewInner {...props} />;
}
