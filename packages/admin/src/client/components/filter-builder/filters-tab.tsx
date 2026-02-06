import { Icon } from "@iconify/react";
import * as React from "react";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import { selectClient, useAdminStore, useScopedLocale } from "../../runtime";
import { SelectMulti } from "../primitives/select-multi";
import { SelectSingle } from "../primitives/select-single";
import {
  isOptionGroup,
  type SelectOption,
  type SelectOptions,
} from "../primitives/types";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.js";
import type { AvailableField, FilterOperator, FilterRule } from "./types.js";

export interface FiltersTabProps {
  fields: AvailableField[];
  filters: FilterRule[];
  onFiltersChange: (filters: FilterRule[]) => void;
}

const OPERATOR_KEYS: Record<string, string> = {
  contains: "filter.contains",
  not_contains: "filter.notContains",
  equals: "filter.equals",
  not_equals: "filter.notEquals",
  starts_with: "filter.startsWith",
  ends_with: "filter.endsWith",
  greater_than: "filter.greaterThan",
  less_than: "filter.lessThan",
  greater_than_or_equal: "filter.greaterThanOrEqual",
  less_than_or_equal: "filter.lessThanOrEqual",
  in: "filter.in",
  not_in: "filter.notIn",
  some: "filter.some",
  every: "filter.every",
  none: "filter.none",
  is_empty: "filter.isEmpty",
  is_not_empty: "filter.isNotEmpty",
};

const TEXT_OPERATORS: FilterOperator[] = [
  "contains",
  "not_contains",
  "equals",
  "not_equals",
  "starts_with",
  "ends_with",
  "is_empty",
  "is_not_empty",
];

const NUMBER_OPERATORS: FilterOperator[] = [
  "equals",
  "not_equals",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
  "is_empty",
  "is_not_empty",
];

const DATE_OPERATORS: FilterOperator[] = [...NUMBER_OPERATORS];

const BOOLEAN_OPERATORS: FilterOperator[] = [
  "equals",
  "not_equals",
  "is_empty",
  "is_not_empty",
];

const SELECT_OPERATORS: FilterOperator[] = [
  "equals",
  "not_equals",
  "is_empty",
  "is_not_empty",
];

const RELATION_SINGLE_OPERATORS: FilterOperator[] = [
  "equals",
  "not_equals",
  "in",
  "not_in",
  "is_empty",
  "is_not_empty",
];

const RELATION_MULTI_OPERATORS: FilterOperator[] = [
  "some",
  "every",
  "none",
  "is_empty",
  "is_not_empty",
];

const PRESENCE_OPERATORS: FilterOperator[] = ["is_empty", "is_not_empty"];

function isValuelessOperator(operator: FilterOperator) {
  return operator === "is_empty" || operator === "is_not_empty";
}

function isMultiValueOperator(operator: FilterOperator) {
  return (
    operator === "in" ||
    operator === "not_in" ||
    operator === "some" ||
    operator === "every" ||
    operator === "none"
  );
}

function normalizeSelectOptions(
  options?: SelectOptions<unknown>,
): SelectOption<string>[] {
  if (!options || options.length === 0) return [];
  const flattened = options.flatMap((option) =>
    isOptionGroup(option) ? option.options : [option],
  );
  return flattened.map((option) => ({
    ...option,
    value: String(option.value),
  }));
}

function getOperatorsForField(field?: AvailableField): FilterOperator[] {
  if (!field) return TEXT_OPERATORS;
  const fieldType = field.type;
  const fieldOptions = field.options ?? {};

  const isTextType =
    fieldType === "text" || fieldType === "email" || fieldType === "textarea";

  if (fieldType === "relation") {
    return fieldOptions.type === "multiple"
      ? RELATION_MULTI_OPERATORS
      : RELATION_SINGLE_OPERATORS;
  }
  if (isTextType) return TEXT_OPERATORS;
  if (fieldType === "number") return NUMBER_OPERATORS;
  if (
    fieldType === "date" ||
    fieldType === "datetime" ||
    fieldType === "time"
  ) {
    return DATE_OPERATORS;
  }
  if (fieldType === "checkbox" || fieldType === "switch") {
    return BOOLEAN_OPERATORS;
  }
  if (fieldType === "select") return SELECT_OPERATORS;

  return PRESENCE_OPERATORS;
}

function getDefaultValue(field: AvailableField, operator: FilterOperator) {
  if (isValuelessOperator(operator)) return null;

  if (field.type === "relation") {
    const expectsMulti =
      field.options?.type === "multiple" || isMultiValueOperator(operator);
    return expectsMulti ? [] : "";
  }

  if (field.type === "number") return null;
  if (field.type === "checkbox" || field.type === "switch") return null;
  if (field.type === "select") return "";
  if (
    field.type === "date" ||
    field.type === "datetime" ||
    field.type === "time"
  ) {
    return "";
  }

  return "";
}

function normalizeValueForOperator(
  field: AvailableField | undefined,
  operator: FilterOperator,
  value: FilterRule["value"],
): FilterRule["value"] {
  if (isValuelessOperator(operator)) return null;
  if (!field) return value;

  if (field.type === "relation") {
    const expectsMulti =
      field.options?.type === "multiple" || isMultiValueOperator(operator);
    if (expectsMulti) {
      return Array.isArray(value)
        ? value.map((item) => String(item))
        : value
          ? [String(value)]
          : [];
    }
    if (Array.isArray(value)) {
      return value[0] ?? "";
    }
    return value ?? "";
  }

  if (isMultiValueOperator(operator)) {
    if (Array.isArray(value)) return value.map((item) => String(item));
    return value ? [String(value)] : [];
  }

  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

export function FiltersTab({
  fields,
  filters,
  onFiltersChange,
}: FiltersTabProps) {
  const { t } = useTranslation();
  const resolveText = useResolveText();
  const client = useAdminStore(selectClient);
  const { locale: contentLocale } = useScopedLocale();

  const filterableFields = React.useMemo(
    () =>
      fields.filter((field) => {
        if (!field?.name) return false;
        if (field.name === "_title") return false;
        if (field.type === "reverseRelation") return false;
        if (field.options?.compute) return false;
        return true;
      }),
    [fields],
  );

  const addFilter = () => {
    const defaultField = filterableFields[0];
    if (!defaultField) return;
    const operators = getOperatorsForField(defaultField);
    const defaultOperator = operators[0] ?? "equals";
    const newFilter: FilterRule = {
      id: crypto.randomUUID(),
      field: defaultField.name,
      operator: defaultOperator,
      value: getDefaultValue(defaultField, defaultOperator),
    };
    onFiltersChange([...filters, newFilter]);
  };

  const updateFilter = (id: string, updates: Partial<FilterRule>) => {
    onFiltersChange(
      filters.map((f) => (f.id === id ? { ...f, ...updates } : f)),
    );
  };

  const removeFilter = (id: string) => {
    onFiltersChange(filters.filter((f) => f.id !== id));
  };

  const clearAllFilters = () => {
    onFiltersChange([]);
  };

  const createRelationLoader = React.useCallback(
    (targetCollection: string) => async (search: string) => {
      if (!client) return [];
      try {
        const response = await (client as any).collections[
          targetCollection
        ].find({
          limit: 50,
          search,
          locale: contentLocale,
        });
        const docs = response?.docs ?? [];
        return docs.map((item: any) => ({
          value: String(item.id),
          label: item._title || item.id || "",
        }));
      } catch (_error) {
        return [];
      }
    },
    [client, contentLocale],
  );

  return (
    <div className="space-y-4 py-4">
      <p className="text-xs text-muted-foreground">
        {t("viewOptions.filtersDescription")}
      </p>

      {filters.map((filter, idx) => {
        const field = fields.find((f) => f.name === filter.field);
        const availableOperators = getOperatorsForField(field);
        const activeOperator = availableOperators.includes(filter.operator)
          ? filter.operator
          : (availableOperators[0] ?? "equals");
        const selectOptions =
          field?.type === "select"
            ? normalizeSelectOptions(field.options?.options)
            : [];

        const renderValueInput = () => {
          if (!field || isValuelessOperator(activeOperator)) return null;

          if (field.type === "relation") {
            const targetCollection = field.options?.targetCollection as
              | string
              | undefined;
            const expectsMulti =
              field.options?.type === "multiple" ||
              isMultiValueOperator(activeOperator);

            if (!targetCollection) {
              return (
                <Input
                  disabled
                  className="h-8 text-xs"
                  placeholder={t("viewOptions.valuePlaceholder")}
                />
              );
            }

            const labelText = field.label
              ? resolveText(field.label)
              : field.name;

            if (expectsMulti) {
              const selectedValues = Array.isArray(filter.value)
                ? filter.value.map((val) => String(val))
                : filter.value
                  ? [String(filter.value)]
                  : [];

              return (
                <SelectMulti
                  value={selectedValues}
                  onChange={(values) =>
                    updateFilter(filter.id, { value: values })
                  }
                  loadOptions={createRelationLoader(targetCollection)}
                  placeholder={t("viewOptions.valuePlaceholder")}
                  emptyMessage={t("relation.noResults", { name: labelText })}
                  drawerTitle={t("relation.select", { name: labelText })}
                  className="h-8 text-xs"
                />
              );
            }

            const selectedValue =
              filter.value === null || filter.value === undefined
                ? null
                : String(filter.value);

            return (
              <SelectSingle
                value={selectedValue}
                onChange={(value) =>
                  updateFilter(filter.id, { value: value ?? "" })
                }
                loadOptions={createRelationLoader(targetCollection)}
                placeholder={t("viewOptions.valuePlaceholder")}
                emptyMessage={t("relation.noResults", { name: labelText })}
                drawerTitle={t("relation.select", { name: labelText })}
                className="h-8 text-xs"
              />
            );
          }

          if (field.type === "select") {
            const selectedValue =
              filter.value === null || filter.value === undefined
                ? null
                : String(filter.value);

            return (
              <SelectSingle
                value={selectedValue}
                onChange={(value) =>
                  updateFilter(filter.id, { value: value ?? "" })
                }
                options={selectOptions}
                placeholder={t("viewOptions.valuePlaceholder")}
                emptyMessage={t("table.noResults")}
                className="h-8 text-xs"
              />
            );
          }

          if (field.type === "checkbox" || field.type === "switch") {
            const booleanValue =
              typeof filter.value === "boolean"
                ? String(filter.value)
                : undefined;

            return (
              <Select
                value={booleanValue}
                onValueChange={(value) =>
                  updateFilter(filter.id, { value: value === "true" })
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue
                    placeholder={t("viewOptions.valuePlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">True</SelectItem>
                  <SelectItem value="false">False</SelectItem>
                </SelectContent>
              </Select>
            );
          }

          if (field.type === "number") {
            const numberValue =
              filter.value === null || filter.value === undefined
                ? ""
                : String(filter.value);
            return (
              <Input
                type="number"
                className="h-8 text-xs"
                placeholder={t("viewOptions.valuePlaceholder")}
                value={numberValue}
                onChange={(event) => {
                  const raw = event.target.value;
                  const next = raw.trim().length ? Number(raw) : null;
                  updateFilter(filter.id, {
                    value: Number.isNaN(next) ? null : next,
                  });
                }}
              />
            );
          }

          if (field.type === "date") {
            const dateValue =
              typeof filter.value === "string" ? filter.value : "";
            return (
              <Input
                type="date"
                className="h-8 text-xs"
                value={dateValue}
                onChange={(event) =>
                  updateFilter(filter.id, { value: event.target.value })
                }
              />
            );
          }

          if (field.type === "datetime") {
            const dateTimeValue =
              typeof filter.value === "string" ? filter.value : "";
            return (
              <Input
                type="datetime-local"
                className="h-8 text-xs"
                value={dateTimeValue}
                onChange={(event) =>
                  updateFilter(filter.id, { value: event.target.value })
                }
              />
            );
          }

          if (field.type === "time") {
            const timeValue =
              typeof filter.value === "string" ? filter.value : "";
            return (
              <Input
                type="time"
                className="h-8 text-xs"
                value={timeValue}
                onChange={(event) =>
                  updateFilter(filter.id, { value: event.target.value })
                }
              />
            );
          }

          return (
            <Input
              className="h-8 text-xs"
              placeholder={t("viewOptions.valuePlaceholder")}
              value={typeof filter.value === "string" ? filter.value : ""}
              onChange={(event) =>
                updateFilter(filter.id, { value: event.target.value })
              }
            />
          );
        };

        return (
          <div
            key={filter.id}
            className="p-3 bg-muted/30 border border-border rounded-lg space-y-2"
          >
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold text-muted-foreground uppercase">
                {t("viewOptions.filterNumber", { number: idx + 1 })}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => removeFilter(filter.id)}
                className="text-muted-foreground hover:text-destructive"
              >
                <Icon icon="ph:trash" width={14} height={14} />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Select
                value={filter.field || undefined}
                onValueChange={(value) => {
                  const selectedField = fields.find((f) => f.name === value);
                  const operators = getOperatorsForField(selectedField);
                  const nextOperator = operators[0] ?? "equals";
                  updateFilter(filter.id, {
                    field: value ?? "",
                    operator: nextOperator,
                    value: selectedField
                      ? getDefaultValue(selectedField, nextOperator)
                      : "",
                  });
                }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue>
                    {filter.field
                      ? resolveText(
                          fields.find((f) => f.name === filter.field)?.label ??
                            filter.field,
                        )
                      : t("viewOptions.selectField")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {filterableFields.map((f) => (
                    <SelectItem key={f.name} value={f.name}>
                      {resolveText(f.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={activeOperator || undefined}
                onValueChange={(value) => {
                  const nextOperator = value as FilterOperator;
                  updateFilter(filter.id, {
                    operator: nextOperator,
                    value: normalizeValueForOperator(
                      field,
                      nextOperator,
                      filter.value,
                    ) as FilterRule["value"],
                  });
                }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue>
                    {activeOperator
                      ? t(OPERATOR_KEYS[activeOperator] || activeOperator)
                      : t("viewOptions.selectOperator")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {availableOperators.map((op) => (
                    <SelectItem key={op} value={op}>
                      {t(OPERATOR_KEYS[op])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {renderValueInput()}
          </div>
        );
      })}

      {filters.length === 0 && (
        <div className="text-center p-8 border border-dashed border-border rounded-lg text-muted-foreground text-sm">
          {t("viewOptions.noActiveFilters")}
        </div>
      )}

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={addFilter}
          className="flex-1 gap-2 rounded-md"
          disabled={filterableFields.length === 0}
        >
          <Icon icon="ph:plus" width={14} height={14} />
          {t("viewOptions.addFilter")}
        </Button>
        {filters.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAllFilters}
            className="rounded-md"
          >
            {t("viewOptions.clearAll")}
          </Button>
        )}
      </div>
    </div>
  );
}
