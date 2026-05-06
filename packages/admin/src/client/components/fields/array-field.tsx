/**
 * ArrayField Component
 *
 * Handles arrays of primitive values or objects with optional ordering.
 * When `item` prop is provided, delegates to ObjectArrayField for object items.
 */

import { Icon } from "@iconify/react";
import * as React from "react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";

import type { FieldComponentProps } from "../../builder";
import { useResolveText, useSafeI18n, useTranslation } from "../../i18n/hooks";
import { resolveOptionLabel } from "../primitives/option-label";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "../ui/select";
import { Textarea } from "../ui/textarea";
import type { ArrayFieldConfig } from "./field-types";
import { FieldCountAccessory, FieldWrapper } from "./field-wrapper";
import { ObjectArrayField } from "./object-array-field";

type ArrayFieldItemType = "text" | "number" | "email" | "textarea" | "select";

interface ArrayFieldProps
	extends
		FieldComponentProps<any[]>,
		Pick<
			ArrayFieldConfig,
			"item" | "mode" | "layout" | "columns" | "itemLabel"
		> {
	itemType?: ArrayFieldItemType;
	options?: Array<{ label: string; value: any }>;
	orderable?: boolean;
	minItems?: number;
	maxItems?: number;
}

// ============================================================================
// Array Item Input
// ============================================================================

interface ArrayItemInputProps {
	name: string;
	index: number;
	itemType: ArrayFieldItemType;
	itemValue: any;
	placeholder?: string;
	disabled?: boolean;
	readOnly?: boolean;
	options?: Array<{ label: string; value: any }>;
}

function ArrayItemInput({
	name,
	index,
	itemType,
	itemValue,
	placeholder,
	disabled,
	readOnly,
	options,
}: ArrayItemInputProps): React.ReactElement {
	const resolveText = useResolveText();
	const i18n = useSafeI18n();
	const locale = i18n?.locale ?? "en";
	const t = (key: string) => i18n?.t(key) ?? key;
	const getOptionLabel = (option: { label: string; value: any }) =>
		resolveOptionLabel({
			value: option.value,
			label: option.label,
			resolveText,
			t,
			locale,
		});
	const form = useFormContext();
	const itemName = `${name}.${index}`;
	const itemPlaceholder = placeholder || `Item ${index + 1}`;

	if (itemType === "textarea") {
		return (
			<Textarea
				id={itemName}
				placeholder={itemPlaceholder}
				disabled={disabled || readOnly}
				defaultValue={itemValue ?? ""}
				{...form.register(itemName)}
			/>
		);
	}

	if (itemType === "select") {
		const selectedOption = options?.find((o) => o.value === itemValue);

		return (
			<Select
				value={itemValue ?? ""}
				onValueChange={(value) =>
					form.setValue(itemName, value, {
						shouldDirty: true,
						shouldTouch: true,
					})
				}
				disabled={disabled || readOnly}
			>
				<SelectTrigger id={itemName}>
					<span className="truncate">
						{selectedOption ? getOptionLabel(selectedOption) : itemPlaceholder}
					</span>
				</SelectTrigger>
				<SelectContent>
					{options?.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{getOptionLabel(option)}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		);
	}

	return (
		<Input
			id={itemName}
			type={itemType === "email" ? "email" : itemType}
			placeholder={itemPlaceholder}
			disabled={disabled || readOnly}
			defaultValue={itemValue ?? ""}
			{...form.register(
				itemName,
				itemType === "number" ? { valueAsNumber: true } : undefined,
			)}
		/>
	);
}

// ============================================================================
// Main Component
// ============================================================================

export function ArrayField(props: ArrayFieldProps): React.ReactElement {
	if (props.item) {
		return (
			<ObjectArrayField
				name={props.name}
				label={props.label}
				description={props.description}
				placeholder={props.placeholder}
				required={props.required}
				disabled={props.disabled}
				readOnly={props.readOnly}
				error={props.error}
				localized={props.localized}
				locale={props.locale}
				item={props.item}
				mode={props.mode}
				layout={props.layout}
				columns={props.columns}
				itemLabel={props.itemLabel}
				orderable={props.orderable}
				minItems={props.minItems}
				maxItems={props.maxItems}
			/>
		);
	}

	return <PrimitiveArrayField {...props} />;
}

function PrimitiveArrayField({
	name,
	value,
	label,
	description,
	placeholder,
	required,
	disabled,
	readOnly,
	error,
	localized,
	locale,
	itemType = "text",
	options,
	orderable = false,
	minItems,
	maxItems,
}: ArrayFieldProps): React.ReactElement {
	const { t } = useTranslation();
	const resolveText = useResolveText();
	const resolvedPlaceholder = placeholder
		? resolveText(placeholder)
		: undefined;
	const resolvedLabel = label ? resolveText(label) : undefined;
	const fallbackLabel = resolvedLabel || "item";
	const emptyLabel = t("array.empty", { name: fallbackLabel });
	const addLabel = t("array.addItem", { name: fallbackLabel });
	const form = useFormContext();
	const { control } = form;
	const { fields, append, remove, move } = useFieldArray({ control, name });
	const values = (useWatch({ control, name }) as any[] | undefined) ?? value;

	const canAddMore = !maxItems || fields.length < maxItems;
	const canRemove = !readOnly && (!minItems || fields.length > minItems);

	const createEmptyItem = React.useCallback(() => {
		if (itemType === "number") return undefined;
		if (itemType === "select") {
			return options?.[0]?.value ?? "";
		}
		return "";
	}, [itemType, options]);

	const handleAdd = () => {
		if (disabled || readOnly || !canAddMore) return;
		append(createEmptyItem());
	};

	const handleRemove = (index: number) => {
		if (!canRemove) return;
		remove(index);
	};

	const handleMove = (from: number, to: number) => {
		if (to < 0 || to >= fields.length) return;
		move(from, to);
	};

	return (
		<FieldWrapper
			name={name}
			label={label}
			description={description}
			required={required}
			disabled={disabled}
			readOnly={readOnly}
			error={error}
			localized={localized}
			locale={locale}
			labelAccessory={
				<FieldCountAccessory count={fields.length} max={maxItems} />
			}
		>
			<div className="qa-array-field space-y-3">
				{fields.length === 0 ? (
					<div className="panel-surface border-border-subtle border-dashed px-3 py-3">
						<p className="text-muted-foreground text-sm text-pretty">
							{resolvedPlaceholder || emptyLabel}
						</p>
					</div>
				) : (
					fields.map((field, index) => {
						const canMoveUp = orderable && index > 0;
						const canMoveDown = orderable && index < fields.length - 1;

						return (
							<div
								key={field.id}
								className="panel-surface flex min-w-0 items-start gap-2 p-2"
							>
								<span className="text-muted-foreground mt-2 min-w-6 shrink-0 text-xs tabular-nums">
									#{index + 1}
								</span>
								<div className="min-w-0 flex-1">
									<ArrayItemInput
										name={name}
										index={index}
										itemType={itemType}
										itemValue={values?.[index]}
										placeholder={resolvedPlaceholder}
										disabled={disabled}
										readOnly={readOnly}
										options={options}
									/>
								</div>
								{!readOnly && (orderable || canRemove) && (
									<div className="flex shrink-0 items-center gap-1">
										{orderable && (
											<>
												<Button
													type="button"
													variant="ghost"
													size="icon-sm"
													className="relative after:absolute after:-inset-1"
													onClick={() => handleMove(index, index - 1)}
													disabled={!canMoveUp || disabled}
													title={t("field.moveUp")}
													aria-label={t("field.moveUp")}
												>
													<Icon icon="ph:caret-up" className="size-3.5" />
												</Button>
												<Button
													type="button"
													variant="ghost"
													size="icon-sm"
													className="relative after:absolute after:-inset-1"
													onClick={() => handleMove(index, index + 1)}
													disabled={!canMoveDown || disabled}
													title={t("field.moveDown")}
													aria-label={t("field.moveDown")}
												>
													<Icon icon="ph:caret-down" className="size-3.5" />
												</Button>
											</>
										)}
										{canRemove && (
											<Button
												type="button"
												variant="ghost"
												size="icon-sm"
												className="relative after:absolute after:-inset-1"
												onClick={() => handleRemove(index)}
												disabled={disabled}
												title={t("common.remove")}
												aria-label={t("field.removeItem")}
											>
												<Icon icon="ph:trash" className="size-3.5" />
											</Button>
										)}
									</div>
								)}
							</div>
						);
					})
				)}
				{!readOnly && canAddMore && (
					<Button
						type="button"
						variant="outline"
						onClick={handleAdd}
						disabled={disabled}
					>
						<Icon icon="ph:plus" className="h-4 w-4" />
						{addLabel}
					</Button>
				)}
			</div>
		</FieldWrapper>
	);
}
