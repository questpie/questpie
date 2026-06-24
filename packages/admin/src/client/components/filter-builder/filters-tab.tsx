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
import type { AvailableField, FilterOperator, FilterRule } from "./types.js";

interface FiltersTabProps {
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

interface FilterValueInputProps {
	field: AvailableField | undefined;
	filter: FilterRule;
	activeOperator: FilterOperator;
	selectOptions: SelectOption[];
	updateFilter: (id: string, updates: Partial<FilterRule>) => void;
	createRelationLoader: (
		targetCollection: string,
	) => (search: string) => Promise<SelectOption[]>;
	resolveText: (text: any) => string;
	t: (key: string, params?: any) => string;
}

function FilterValueInput({
	field,
	filter,
	activeOperator,
	selectOptions,
	updateFilter,
	createRelationLoader,
	resolveText,
	t,
}: FilterValueInputProps) {
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

		const labelText = field.label ? resolveText(field.label) : field.name;

		if (expectsMulti) {
			const selectedValues = Array.isArray(filter.value)
				? filter.value.map((val) => String(val))
				: filter.value
					? [String(filter.value)]
					: [];

			return (
				<SelectMulti
					value={selectedValues}
					onChange={(values) => updateFilter(filter.id, { value: values })}
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
				onChange={(value) => updateFilter(filter.id, { value: value ?? "" })}
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
				onChange={(value) => updateFilter(filter.id, { value: value ?? "" })}
				options={selectOptions}
				placeholder={t("viewOptions.valuePlaceholder")}
				emptyMessage={t("table.noResults")}
				className="h-8 text-xs"
			/>
		);
	}

	if (field.type === "checkbox" || field.type === "switch") {
		const booleanValue: string | null =
			typeof filter.value === "boolean" ? String(filter.value) : null;

		return (
			<SelectSingle<string>
				value={booleanValue}
				onChange={(value) =>
					updateFilter(filter.id, { value: value === "true" })
				}
				options={[
					{ value: "true", label: t("common.yes") },
					{ value: "false", label: t("common.no") },
				]}
				clearable={false}
				placeholder={t("viewOptions.valuePlaceholder")}
				drawerTitle={t("viewOptions.valuePlaceholder")}
				className="h-8 text-xs"
			/>
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
					updateFilter(filter.id, { value: Number.isNaN(next) ? null : next });
				}}
			/>
		);
	}

	if (field.type === "date") {
		const dateValue = typeof filter.value === "string" ? filter.value : "";
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
		const dateTimeValue = typeof filter.value === "string" ? filter.value : "";
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
		const timeValue = typeof filter.value === "string" ? filter.value : "";
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
}

export function FiltersTab({
	fields,
	filters,
	onFiltersChange,
}: FiltersTabProps) {
	"use no memo";
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

	// Field options for the field SelectSingle. SelectSingle resolves the
	// I18nText label internally, so pass the raw label through.
	const filterFieldOptions = React.useMemo(
		() =>
			filterableFields.map((f) => ({
				value: f.name,
				label: f.label,
			})),
		[filterableFields],
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
				let docs: any[];
				if (response) {
					if (response.docs) {
						docs = response.docs;
					} else {
						docs = [];
					}
				} else {
					docs = [];
				}
				return docs.map((item: any) => {
					let label: string;
					if (item._title) {
						label = item._title;
					} else if (item.id) {
						label = item.id;
					} else {
						label = "";
					}
					return {
						value: String(item.id),
						label,
					};
				});
			} catch {
				return [];
			}
		},
		[client, contentLocale],
	);

	return (
		<div className="space-y-4 py-4">
			<p className="text-muted-foreground text-xs">
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

				return (
					<div
						key={filter.id}
						className="bg-muted border-border space-y-2 border p-3"
					>
						<div className="flex items-center justify-between">
							<span className="text-muted-foreground text-xs font-semibold uppercase">
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
						<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
							<SelectSingle
								value={filter.field || null}
								onChange={(value) => {
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
								options={filterFieldOptions}
								selectedLabel={field ? resolveText(field.label) : undefined}
								clearable={false}
								placeholder={t("viewOptions.selectField")}
								drawerTitle={t("viewOptions.selectField")}
								className="h-8 text-xs"
							/>
							<SelectSingle<FilterOperator>
								value={activeOperator || null}
								onChange={(value) => {
									const nextOperator = value ?? "equals";
									updateFilter(filter.id, {
										operator: nextOperator,
										value: normalizeValueForOperator(
											field,
											nextOperator,
											filter.value,
										) as FilterRule["value"],
									});
								}}
								options={availableOperators.map((op) => ({
									value: op,
									label: t(OPERATOR_KEYS[op] ?? op),
								}))}
								clearable={false}
								placeholder={t("viewOptions.selectOperator")}
								drawerTitle={t("viewOptions.selectOperator")}
								className="h-8 text-xs"
							/>
						</div>
						<FilterValueInput
							field={field}
							filter={filter}
							activeOperator={activeOperator}
							selectOptions={selectOptions}
							updateFilter={updateFilter}
							createRelationLoader={createRelationLoader}
							resolveText={resolveText}
							t={t}
						/>
					</div>
				);
			})}

			{filters.length === 0 && (
				<p className="text-muted-foreground py-2 text-sm">
					{t("viewOptions.noActiveFilters")}
				</p>
			)}

			<div className="flex gap-2">
				<Button
					variant="outline"
					size="sm"
					onClick={addFilter}
					className="flex-1 gap-2"
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
						className=""
					>
						{t("viewOptions.clearAll")}
					</Button>
				)}
			</div>
		</div>
	);
}
