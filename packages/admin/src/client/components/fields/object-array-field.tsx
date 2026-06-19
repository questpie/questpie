/**
 * ObjectArrayField Component
 *
 * Manages arrays of objects with inline, modal, or drawer editing.
 * Similar to EmbeddedCollectionField but with inline field definitions.
 */

import { Icon } from "@iconify/react";
import * as React from "react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";

import type { FieldInstance } from "../../builder/field/field";
import { configureField } from "../../builder/field/field";
import { useIsMobile } from "../../hooks/use-media-query";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import { selectAdmin, useAdminStore } from "../../runtime";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "../ui/sheet";
import type { ArrayFieldConfig, BaseFieldProps } from "./field-types";
import { gridColumnClasses } from "./field-utils";
import { FieldCountAccessory, FieldWrapper } from "./field-wrapper";

// ============================================================================
// Types
// ============================================================================

interface ObjectArrayFieldProps
	extends
		BaseFieldProps,
		Pick<
			ArrayFieldConfig,
			| "item"
			| "mode"
			| "layout"
			| "columns"
			| "itemLabel"
			| "orderable"
			| "minItems"
			| "maxItems"
		> {
	readOnly?: boolean;
	error?: string;
}

// ============================================================================
// Nested Field Renderer (for object items)
// ============================================================================

interface ItemFieldRendererProps {
	fieldName: string;
	fieldDef: FieldInstance;
	parentName: string;
	disabled?: boolean;
}

const ItemFieldRenderer = React.memo(function ItemFieldRenderer({
	fieldName,
	fieldDef,
	parentName,
	disabled,
}: ItemFieldRendererProps): React.ReactElement {
	const resolveText = useResolveText();
	const fullName = `${parentName}.${fieldName}`;
	const options = (fieldDef["~options"] || {}) as Record<string, any>;

	// Get the component from the field definition (registry-based)
	const Component = fieldDef.component as React.ComponentType<any> | undefined;

	if (!Component) {
		return (
			<div className="text-destructive text-sm">
				No component for field type: {fieldDef.name}
			</div>
		);
	}

	// Strip UI-specific options that are handled separately
	const {
		label,
		description,
		placeholder,
		required,
		disabled: optionsDisabled,
		readOnly,
		hidden: _hidden,
		localized,
		locale,
		...fieldSpecificOptions
	} = options;

	return (
		<Component
			name={fullName}
			label={resolveText(label)}
			description={resolveText(description)}
			placeholder={resolveText(placeholder)}
			required={required}
			disabled={disabled || optionsDisabled}
			readOnly={readOnly}
			localized={localized}
			locale={locale}
			{...fieldSpecificOptions}
		/>
	);
});

// ============================================================================
// Item Fields Layout
// ============================================================================

interface ObjectArrayItemFieldsProps {
	fieldEntries: [string, any][];
	layout: string;
	columns: number;
	name: string;
	index: number;
	disabled?: boolean;
}

const ObjectArrayItemFields = React.memo(function ObjectArrayItemFields({
	fieldEntries,
	layout,
	columns,
	name,
	index,
	disabled,
}: ObjectArrayItemFieldsProps): React.ReactElement {
	if (fieldEntries.length === 0) {
		return (
			<div className="py-2">
				<p className="text-muted-foreground text-sm text-pretty">
					No fields configured for items.
				</p>
			</div>
		);
	}

	const fieldElements = fieldEntries.map(([fieldName, fieldDef]) => (
		<ItemFieldRenderer
			key={fieldName}
			fieldName={fieldName}
			fieldDef={fieldDef as FieldInstance}
			parentName={`${name}.${index}`}
			disabled={disabled}
		/>
	));

	if (layout === "inline") {
		return (
			<div className="flex flex-wrap items-end gap-2">{fieldElements}</div>
		);
	}

	if (layout === "grid") {
		return (
			<div
				className={cn(
					"grid gap-4",
					gridColumnClasses[columns] || "grid-cols-2",
				)}
			>
				{fieldElements}
			</div>
		);
	}

	// Default: stack
	return <div className="space-y-4">{fieldElements}</div>;
});

type ObjectArrayItemLabelProps = {
	name: string;
	index: number;
	fallbackLabel?: string;
	resolveItemLabel: (item: any, index: number) => string;
};

function ObjectArrayItemLabel({
	name,
	index,
	fallbackLabel,
	resolveItemLabel,
}: ObjectArrayItemLabelProps): React.ReactElement {
	const { control } = useFormContext();
	const itemValue = useWatch({ control, name: `${name}.${index}` });

	return <>{resolveItemLabel(itemValue, index) || fallbackLabel}</>;
}

type ObjectArrayItemRowProps = {
	index: number;
	totalCount: number;
	fieldEntries: [string, any][];
	layout: string;
	columns: number;
	name: string;
	mode: string;
	orderable: boolean;
	canRemove: boolean;
	disabled?: boolean;
	itemFieldsDisabled?: boolean;
	resolveItemLabel: (item: any, index: number) => string;
	onEdit: (index: number) => void;
	onMove: (from: number, to: number) => void;
	onRemove: (index: number) => void;
	t: ReturnType<typeof useTranslation>["t"];
};

const ObjectArrayItemRow = React.memo(function ObjectArrayItemRow({
	index,
	totalCount,
	fieldEntries,
	layout,
	columns,
	name,
	mode,
	orderable,
	canRemove,
	disabled,
	itemFieldsDisabled,
	resolveItemLabel,
	onEdit,
	onMove,
	onRemove,
	t,
}: ObjectArrayItemRowProps): React.ReactElement {
	const canMoveUp = orderable && index > 0;
	const canMoveDown = orderable && index < totalCount - 1;

	return (
		<div className="panel-surface overflow-hidden">
			<div className="border-border-subtle bg-surface-low flex items-center justify-between border-b px-3 py-2">
				<div className="flex min-w-0 items-center gap-2">
					<span className="text-muted-foreground shrink-0 text-xs tabular-nums">
						#{index + 1}
					</span>
					<span className="min-w-0 truncate text-sm font-medium">
						<ObjectArrayItemLabel
							name={name}
							index={index}
							resolveItemLabel={resolveItemLabel}
						/>
					</span>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					{orderable && (
						<>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								className="relative after:absolute after:-inset-1"
								onClick={() => onMove(index, index - 1)}
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
								onClick={() => onMove(index, index + 1)}
								disabled={!canMoveDown || disabled}
								title={t("field.moveDown")}
								aria-label={t("field.moveDown")}
							>
								<Icon icon="ph:caret-down" className="size-3.5" />
							</Button>
						</>
					)}
					{mode !== "inline" && (
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className="relative after:absolute after:-inset-1"
							onClick={() => onEdit(index)}
							disabled={disabled}
							title={t("common.edit")}
							aria-label={t("common.edit")}
						>
							<Icon icon="ph:pencil" className="size-3.5" />
						</Button>
					)}
					{canRemove && (
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className="relative after:absolute after:-inset-1"
							onClick={() => onRemove(index)}
							disabled={disabled}
							title={t("common.remove")}
							aria-label={t("common.remove")}
						>
							<Icon icon="ph:trash" className="size-3.5" />
						</Button>
					)}
				</div>
			</div>
			{mode === "inline" && (
				<div className="p-3">
					<ObjectArrayItemFields
						fieldEntries={fieldEntries}
						layout={layout}
						columns={columns}
						name={name}
						index={index}
						disabled={itemFieldsDisabled}
					/>
				</div>
			)}
		</div>
	);
});

// ============================================================================
// Main Component
// ============================================================================

export function ObjectArrayField({
	name,
	label,
	description,
	placeholder,
	required,
	disabled,
	readOnly,
	error,
	localized,
	locale,
	item: itemProp,
	mode = "inline",
	layout = "stack",
	columns = 2,
	itemLabel: itemLabelProp,
	orderable = false,
	minItems,
	maxItems,
}: ObjectArrayFieldProps): React.ReactElement {
	const { t } = useTranslation();
	const resolveText = useResolveText();
	const isMobile = useIsMobile();
	const resolvedPlaceholder = placeholder
		? resolveText(placeholder)
		: undefined;
	const resolvedLabel = label ? resolveText(label) : undefined;
	const form = useFormContext();
	const { control } = form;
	const { fields, append, remove, move } = useFieldArray({ control, name });

	const admin = useAdminStore(selectAdmin);
	const [activeIndex, setActiveIndex] = React.useState<number | null>(null);
	const [isOpen, setIsOpen] = React.useState(false);

	// Resolve item field definitions
	const itemFields = React.useMemo(() => {
		if (!itemProp) return {};

		if (typeof itemProp === "function") {
			const registeredFields = admin.getFields();
			const r: Record<
				string,
				(opts?: Record<string, unknown>) => FieldInstance
			> = {};
			for (const key in registeredFields) {
				r[key] = (opts) => configureField(registeredFields[key], opts ?? {});
			}
			return itemProp({ r });
		}

		return itemProp;
	}, [itemProp, admin]);

	const fieldEntries = React.useMemo(
		() => Object.entries(itemFields),
		[itemFields],
	);
	const withinMaxItems = !maxItems || fields.length < maxItems;
	const canAddMore = !readOnly && withinMaxItems;
	const canRemove = !readOnly && (!minItems || fields.length > minItems);
	const fallbackLabel = resolvedLabel || "Item";
	const emptyLabel = t("array.empty", { name: fallbackLabel });
	const addLabel = t("array.addItem", { name: fallbackLabel });

	// Resolve item label
	const resolveItemLabel = React.useCallback(
		(item: any, index: number) => {
			if (typeof itemLabelProp === "function") {
				const labelValue = itemLabelProp(item, index);
				if (labelValue) return labelValue;
			}
			if (typeof itemLabelProp === "string") {
				return resolveText(itemLabelProp);
			}
			// Try common label fields
			if (item?.name) return String(item.name);
			if (item?.title) return String(item.title);
			if (item?.label) return String(item.label);
			return `${fallbackLabel} ${index + 1}`;
		},
		[fallbackLabel, itemLabelProp, resolveText],
	);

	const handleAdd = React.useCallback(() => {
		if (disabled || readOnly || !canAddMore) return;
		// Create empty object with keys from field definitions (immutable pattern)
		const emptyItem = Object.fromEntries(
			fieldEntries.map(([key]) => [key, undefined]),
		);
		append(emptyItem);
		if (mode !== "inline") {
			setActiveIndex(fields.length);
			setIsOpen(true);
		}
	}, [
		append,
		canAddMore,
		disabled,
		readOnly,
		fieldEntries,
		fields.length,
		mode,
	]);

	const handleRemove = React.useCallback(
		(index: number) => {
			if (!canRemove) return;
			remove(index);
			if (activeIndex === null) return;
			if (index === activeIndex) {
				setIsOpen(false);
				setActiveIndex(null);
			} else if (index < activeIndex) {
				setActiveIndex((prev) => (prev !== null ? prev - 1 : null));
			}
		},
		[activeIndex, canRemove, remove],
	);

	const handleMove = React.useCallback(
		(from: number, to: number) => {
			if (to < 0 || to >= fields.length) return;
			move(from, to);
			if (activeIndex === null) return;
			if (activeIndex === from) {
				setActiveIndex(to);
			} else if (activeIndex === to) {
				setActiveIndex(from);
			}
		},
		[activeIndex, fields.length, move],
	);

	const handleEdit = React.useCallback((index: number) => {
		setActiveIndex(index);
		setIsOpen(true);
	}, []);

	const handleOpenChange = React.useCallback((open: boolean) => {
		setIsOpen(open);
		if (!open) {
			setActiveIndex(null);
		}
	}, []);

	const emptyState = (
		<div className="panel-surface border-border-subtle border-dashed p-3">
			<p className="text-muted-foreground text-sm text-pretty">
				{resolvedPlaceholder || emptyLabel}
			</p>
		</div>
	);

	const editorContent =
		activeIndex !== null ? (
			<ObjectArrayItemFields
				fieldEntries={fieldEntries}
				layout={layout}
				columns={columns}
				name={name}
				index={activeIndex}
				disabled={disabled || readOnly}
			/>
		) : null;
	const editorTitle =
		activeIndex !== null ? (
			<ObjectArrayItemLabel
				name={name}
				index={activeIndex}
				fallbackLabel={fallbackLabel}
				resolveItemLabel={resolveItemLabel}
			/>
		) : (
			fallbackLabel
		);

	const showEditor = mode === "modal" || mode === "drawer";
	// On mobile, force the drawer/sheet editor even when configured as a centered
	// "modal" — a full-width bottom/side sheet with a backdrop + scroll-lock is the
	// usable touch pattern (a cramped centered dialog is not). Desktop keeps modal.
	const useSheetEditor = mode === "drawer" || (mode === "modal" && isMobile);

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
			<div className="qa-object-array-field space-y-3">
				{fields.length === 0
					? emptyState
					: fields.map((field, index) => (
							<ObjectArrayItemRow
								key={field.id}
								index={index}
								totalCount={fields.length}
								fieldEntries={fieldEntries}
								layout={layout}
								columns={columns}
								name={name}
								mode={mode}
								orderable={orderable && !readOnly}
								canRemove={canRemove}
								disabled={disabled}
								itemFieldsDisabled={disabled || readOnly}
								resolveItemLabel={resolveItemLabel}
								onEdit={handleEdit}
								onMove={handleMove}
								onRemove={handleRemove}
								t={t}
							/>
						))}
			</div>

			{canAddMore && (
				<Button
					type="button"
					variant="outline"
					onClick={handleAdd}
					disabled={disabled}
				>
					<Icon icon="ph:plus" className="size-4" />
					{addLabel}
				</Button>
			)}

			{showEditor && mode === "modal" && !isMobile && (
				<Dialog open={isOpen} onOpenChange={handleOpenChange}>
					<DialogContent className="sm:max-w-2xl">
						<DialogHeader>
							<DialogTitle>{editorTitle}</DialogTitle>
							{description && (
								<DialogDescription>
									{resolveText(description)}
								</DialogDescription>
							)}
						</DialogHeader>
						<div className="space-y-4">{editorContent}</div>
					</DialogContent>
				</Dialog>
			)}

			{showEditor && useSheetEditor && (
				<Sheet open={isOpen} onOpenChange={handleOpenChange}>
					<SheetContent side="right" className="sm:max-w-lg">
						<SheetHeader>
							<SheetTitle>{editorTitle}</SheetTitle>
							{description && (
								<SheetDescription>{resolveText(description)}</SheetDescription>
							)}
						</SheetHeader>
						<div className="space-y-4 p-4">{editorContent}</div>
					</SheetContent>
				</Sheet>
			)}
		</FieldWrapper>
	);
}
