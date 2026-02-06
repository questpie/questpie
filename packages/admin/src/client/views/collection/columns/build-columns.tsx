/**
 * Column Builder
 *
 * Generates TanStack Table column definitions from collection config.
 * Simplified version - uses field registry or DefaultCell fallback.
 */

import type { ColumnDef } from "@tanstack/react-table";
import type * as React from "react";
import {
  type ColumnConfig,
  normalizeColumnConfig,
} from "../../../builder/types/collection-types";
import type { FieldDefinition } from "../../../builder/field/field";
import { LocaleSwitcher } from "../../../components/locale-switcher";
import { useResolveText } from "../../../i18n/hooks";
import type { I18nText } from "../../../i18n/types";
import { useSafeContentLocales, useScopedLocale } from "../../../runtime";
import { DefaultCell, TextCell } from "../cells";
import { computeDefaultColumns, formatHeader } from "./column-defaults";
import type { BuildColumnsOptions } from "./types";

// ============================================================================
// Header Component with I18nText Resolution
// ============================================================================

/**
 * Column header component that resolves I18nText labels
 */
function ColumnHeader({
  label,
  fallback,
  localized,
}: {
  label: I18nText | undefined;
  fallback: string;
  localized?: boolean;
}) {
  const resolveText = useResolveText();
  const contentLocales = useSafeContentLocales();
  // Use scoped locale (from LocaleScopeProvider in ResourceSheet) or global locale
  const { locale: contentLocale, setLocale: setContentLocale } =
    useScopedLocale();
  const resolvedLocale =
    contentLocale ??
    contentLocales?.defaultLocale ??
    contentLocales?.locales[0]?.code;
  const localeOptions = contentLocales?.locales?.length
    ? contentLocales.locales
    : resolvedLocale
      ? [{ code: resolvedLocale }]
      : [];
  const showLocaleSwitcher = localized && localeOptions.length > 0;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{resolveText(label, fallback)}</span>
      {showLocaleSwitcher && (
        <LocaleSwitcher
          locales={localeOptions}
          value={resolvedLocale}
          onChange={setContentLocale}
          labelMode="code"
        />
      )}
    </span>
  );
}

// ============================================================================
// Field Types Needing fieldDef
// ============================================================================

/**
 * Field types that need fieldDef passed to their cell component
 * (for nested field definitions, labels, etc.)
 */
const FIELD_TYPES_NEEDING_FIELD_DEF = new Set([
  "object",
  "array",
  "relation",
  "reverseRelation",
]);

// ============================================================================
// Column Builder
// ============================================================================

/**
 * Build column definitions from collection config
 *
 * Simplified cell resolution:
 * 1. Custom from .list() config
 * 2. From field registry (.cell)
 * 3. Ultra-simple DefaultCell fallback
 *
 * NO getCellForFieldType() switch statement needed!
 *
 * @param options - Build options with config and fallbacks
 * @returns Array of TanStack Table column definitions
 *
 * @example
 * ```tsx
 * const columns = buildColumns({
 *   config: collectionsConfig.posts,
 *   fallbackColumns: ['id', 'title', 'createdAt'],
 *   meta: collectionMeta,
 * });
 *
 * <CollectionList collection="posts" columns={columns} />
 * ```
 */
export function buildColumns<TData extends Record<string, unknown>>(
  options: BuildColumnsOptions,
): ColumnDef<TData>[] {
  const {
    config,
    fallbackColumns = ["id"],
    buildAllColumns = false,
    meta,
  } = options;
  const fields = config?.fields ?? {};
  const listConfig = config?.list;

  const isLocalizedField = (
    field: string,
    definition?: FieldDefinition,
  ): boolean => {
    const fieldOptions = definition?.["~options"] ?? {};
    return fieldOptions.localized !== undefined
      ? !!fieldOptions.localized
      : (meta?.localizedFields?.includes(field) ?? false);
  };

  // Determine title column based on meta
  // If meta says title is a real "field", use that field instead of _title
  const titleFieldName = meta?.title?.fieldName;
  const titleType = meta?.title?.type;
  const titleColumn =
    titleType === "field" && titleFieldName ? titleFieldName : "_title";

  // Determine which columns to build
  let columnConfigs: ColumnConfig<string>[];

  if (buildAllColumns) {
    // Build ALL columns for all fields (used when user can toggle visibility)
    // Include title column (real field or _title) first, then all other fields
    const allFields = Object.keys(fields);
    // If title is a real field, don't duplicate it
    const otherFields =
      titleColumn === "_title"
        ? allFields
        : allFields.filter((f) => f !== titleColumn);
    columnConfigs = [titleColumn, ...otherFields];
  } else if (listConfig?.columns && listConfig.columns.length > 0) {
    // Use explicitly defined columns
    columnConfigs = listConfig.columns;
  } else if (Object.keys(fields).length > 0) {
    // Use sane defaults - limited content fields + createdAt
    columnConfigs = computeDefaultColumns(fields, { meta });
  } else {
    // Use fallback - include title column first
    columnConfigs = [
      titleColumn,
      ...fallbackColumns.filter((c) => c !== titleColumn && c !== "_title"),
    ];
  }

  // Build column definitions
  return columnConfigs.map((colConfig) => {
    const normalized = normalizeColumnConfig(colConfig);
    const fieldName = normalized.field;
    const fieldDef = fields[fieldName];

    // Special handling for _title virtual field (computed by backend)
    if (fieldName === "_title") {
      const titleIsLocalized = titleFieldName
        ? isLocalizedField(titleFieldName, fields[titleFieldName])
        : false;
      // Determine the label for _title column
      // For virtual titles, use the virtual field's label instead of generic "Title"
      let titleLabel: I18nText = "Title";
      let titleFallback = "Title";
      if (titleType === "virtual" && titleFieldName && fields[titleFieldName]) {
        const virtualFieldDef = fields[titleFieldName];
        const virtualFieldOptions = virtualFieldDef?.["~options"] ?? {};
        titleLabel = virtualFieldOptions.label;
        titleFallback = formatHeader(titleFieldName);
      }

      const columnDef: ColumnDef<TData> = {
        accessorKey: "_title",
        header: normalized.header
          ? () => <ColumnHeader label={normalized.header} fallback="Title" />
          : () => <ColumnHeader label={titleLabel} fallback={titleFallback} />,
        cell: ({ row }) => {
          const value = row.getValue("_title");
          return <TextCell value={value} />;
        },
        enableSorting: false, // _title is virtual, can't sort on it directly
      };
      return columnDef;
    }

    const fieldType = fieldDef?.name ?? "text";
    const fieldOptions = fieldDef?.["~options"] ?? {};
    const isLocalized = isLocalizedField(fieldName, fieldDef);

    // ========== SIMPLIFIED CELL RESOLUTION ==========
    // Priority chain - just 3 lines!
    let CellComponent: React.ComponentType<{
      value: unknown;
      row?: unknown;
      fieldDef?: FieldDefinition;
    }>;

    if (normalized.cell) {
      // 1. Custom cell from .list() config
      CellComponent = normalized.cell as React.ComponentType<{
        value: unknown;
        row?: unknown;
        fieldDef?: FieldDefinition;
      }>;
    } else if (fieldDef?.cell?.component) {
      // 2. Cell from field registry (most common)
      CellComponent = fieldDef.cell.component as React.ComponentType<{
        value: unknown;
        row?: unknown;
        fieldDef?: FieldDefinition;
      }>;
    } else {
      // 3. Ultra-simple DefaultCell fallback
      CellComponent = DefaultCell;
    }

    // Check if this field type needs fieldDef passed to the cell
    const needsFieldDef = FIELD_TYPES_NEEDING_FIELD_DEF.has(fieldType);

    // For relation fields, use relationName as accessor if specified
    // This allows fetching expanded relation data (e.g., row.customer) instead of FK (row.customerId)
    // If relationName is not specified, we use the field name (which shows the raw FK value)
    const accessorKey: string =
      fieldType === "relation" && fieldOptions.relationName
        ? fieldOptions.relationName
        : fieldName;

    // Build column def
    // Use fieldName as id (for lookup in visibleColumns) and accessorKey for data access
    const headerLabel = normalized.header ?? fieldOptions.label;
    const headerFallback = formatHeader(fieldName);
    // Check if field is computed
    const computeFn = fieldOptions.compute as
      | ((values: Record<string, any>) => any)
      | undefined;
    const isComputed = typeof computeFn === "function";

    const columnDef: ColumnDef<TData> = {
      id: fieldName, // Always use field name as id for consistent lookup
      accessorKey: isComputed ? undefined : accessorKey, // Computed fields don't have accessor
      header: () => (
        <ColumnHeader label={headerLabel} fallback={headerFallback} />
      ),
      cell: ({ row, getValue }) => {
        // For computed fields, compute value from row data
        const value = isComputed
          ? computeFn(row.original as Record<string, any>)
          : getValue();
        // Pass fieldDef for object/array/relation types to enable advanced rendering
        return needsFieldDef ? (
          <CellComponent value={value} row={row} fieldDef={fieldDef} />
        ) : (
          <CellComponent value={value} row={row} />
        );
      },
      // Computed fields are not sortable (no DB column)
      enableSorting: isComputed ? false : normalized.sortable !== false,
    };

    // Add size config if specified
    if (normalized.width) {
      (columnDef as any).size =
        typeof normalized.width === "number"
          ? normalized.width
          : Number.parseInt(normalized.width, 10) || undefined;
    }
    if (normalized.minWidth) {
      (columnDef as any).minSize =
        typeof normalized.minWidth === "number"
          ? normalized.minWidth
          : Number.parseInt(normalized.minWidth, 10) || undefined;
    }
    if (normalized.maxWidth) {
      (columnDef as any).maxSize =
        typeof normalized.maxWidth === "number"
          ? normalized.maxWidth
          : Number.parseInt(normalized.maxWidth, 10) || undefined;
    }

    // Add meta for alignment/className
    if (normalized.align || normalized.className) {
      (columnDef as any).meta = {
        align: normalized.align,
        className: normalized.className,
      };
    }

    return columnDef;
  });
}
