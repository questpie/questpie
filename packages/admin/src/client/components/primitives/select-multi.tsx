"use client";

import { Icon } from "@iconify/react";
import { useQuery } from "@tanstack/react-query";
import type * as React from "react";
import { useCallback, useDeferredValue, useId, useMemo, useState } from "react";

import { useIsMobile } from "../../hooks/use-media-query";
import { useResolveText, useSafeI18n } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "../ui/command";
import {
	Drawer,
	DrawerContent,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from "../ui/drawer";
import { useFieldAriaDescribedBy } from "../ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { resolveOptionLabel } from "./option-label";
import { SelectCreateRow } from "./select-create-row";
import type { BasePrimitiveProps, SelectOption, SelectOptions } from "./types";
import { flattenOptions } from "./types";

// Module-level constants for empty arrays to avoid recreating on each render
const EMPTY_VALUE: string[] = [];
const EMPTY_OPTIONS: SelectOptions<string> = [];

/**
 * Chip text inside the trigger. With `onEdit` it becomes the chip's primary
 * action (open the record editor) — pointer events must not bubble to the
 * combobox trigger, or every tap would also open the menu.
 */
function ChipLabel({
	label,
	editTitle,
	onEdit,
}: {
	label: string;
	editTitle: string;
	onEdit?: () => void;
}) {
	if (!onEdit) {
		return <span className="max-w-32 truncate">{label}</span>;
	}

	const stopAnd = (event: React.SyntheticEvent, action?: () => void) => {
		event.preventDefault();
		event.stopPropagation();
		action?.();
	};

	return (
		<span
			role="button"
			tabIndex={0}
			title={editTitle}
			onPointerDown={(event) => stopAnd(event)}
			onClick={(event) => stopAnd(event, onEdit)}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					stopAnd(event, onEdit);
				}
			}}
			className="max-w-32 cursor-pointer truncate underline-offset-2 hover:underline"
		>
			{label}
		</span>
	);
}

interface SelectMultiProps<
	TValue extends string = string,
> extends BasePrimitiveProps {
	/** Selected values */
	value: TValue[];
	/** Change handler */
	onChange: (value: TValue[]) => void;
	/** Static options */
	options?: SelectOptions<TValue>;
	/** Dynamic options loader */
	loadOptions?: (search: string) => Promise<SelectOption<TValue>[]>;
	/** Query key builder for loadOptions */
	queryKey?: (search: string) => readonly unknown[];
	/** Prefetch options on mount */
	prefetchOnMount?: boolean;
	/** Max selections */
	maxSelections?: number;
	/** External loading state */
	loading?: boolean;
	/** Empty state message */
	emptyMessage?: string;
	/** Title for mobile drawer */
	drawerTitle?: string;
	/** Max visible chips before collapsing */
	maxVisibleChips?: number;
	/**
	 * Labels for selected values that may not be present in the loaded
	 * options (async selects load a windowed option list; the selection can
	 * point outside it). Keyed by value.
	 */
	selectedLabels?: Record<string, string>;
	/**
	 * Renders a pinned "create new" row at the bottom of the menu — visible
	 * even when the search has no results. Closes the menu, then invokes.
	 */
	onCreateNew?: () => void;
	/** Label for the create-new row. */
	createNewLabel?: string;
	/**
	 * Makes chip labels clickable (e.g. open the record editor). The chip's
	 * remove × keeps working independently.
	 */
	onValueClick?: (value: TValue) => void;
}

/**
 * SelectMulti - Multi-select component with chips
 *
 * Features:
 * - Always searchable
 * - Responsive: Popover on desktop, Drawer on mobile
 * - Chip display with remove buttons
 * - Supports static and async options
 * - Keyboard navigation
 *
 * @example
 * ```tsx
 * <SelectMulti
 *   value={selectedTags}
 *   onChange={setSelectedTags}
 *   options={[
 *     { value: "react", label: "React" },
 *     { value: "vue", label: "Vue" },
 *     { value: "angular", label: "Angular" },
 *   ]}
 * />
 * ```
 */
export function SelectMulti<TValue extends string = string>({
	value,
	onChange,
	options: staticOptions,
	loadOptions,
	queryKey,
	prefetchOnMount = false,
	maxSelections,
	loading: externalLoading = false,
	emptyMessage = "No options found",
	placeholder = "Select...",
	disabled,
	className,
	id,
	"aria-invalid": ariaInvalid,
	"aria-describedby": ariaDescribedByProp,
	drawerTitle = "Select options",
	maxVisibleChips = 3,
	selectedLabels,
	onCreateNew,
	createNewLabel,
	onValueClick,
}: SelectMultiProps<TValue>) {
	const resolvedValue = value ?? (EMPTY_VALUE as TValue[]);
	const resolvedStaticOptions = staticOptions ?? EMPTY_OPTIONS;
	const ariaDescribedBy = useFieldAriaDescribedBy(ariaDescribedByProp);
	const resolveText = useResolveText();
	const i18n = useSafeI18n();
	const translate = useCallback((key: string) => i18n?.t(key) ?? key, [i18n]);
	const locale = i18n?.locale ?? "en";
	const t = (key: string, fallback: string) => {
		const message = translate(key);
		return message && message !== key ? message : fallback;
	};
	const resolvedPlaceholder = resolveText(placeholder);
	const resolvedEmptyMessage = resolveText(emptyMessage);
	const resolvedDrawerTitle = resolveText(drawerTitle);
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const instanceId = useId();
	const deferredSearch = useDeferredValue(search);
	const isMobile = useIsMobile();

	// Flatten static options
	const flatStaticOptions = useMemo(
		() => flattenOptions(resolvedStaticOptions),
		[resolvedStaticOptions],
	);

	const loadOptionsKey = useMemo(
		() =>
			queryKey
				? queryKey(deferredSearch)
				: ["select-multi", instanceId, deferredSearch],
		[queryKey, deferredSearch, instanceId],
	);

	const { data: dynamicOptions = [], isFetching } = useQuery({
		queryKey: loadOptionsKey,
		queryFn: () => loadOptions?.(deferredSearch) ?? Promise.resolve([]),
		enabled: !!loadOptions && (open || prefetchOnMount),
		staleTime: 30_000,
		gcTime: 5 * 60_000,
	});

	const allOptions = useMemo<SelectOption<TValue>[]>(() => {
		if (!loadOptions) {
			return flatStaticOptions as SelectOption<TValue>[];
		}
		if (flatStaticOptions.length === 0) {
			return dynamicOptions as SelectOption<TValue>[];
		}
		// Single-pass Map build (dynamic overrides static). The previous
		// `reduce` cloned the whole Map on every option — O(n²) on every
		// keystroke; this is O(n).
		const mergedMap = new Map<TValue, SelectOption<TValue>>();
		for (const opt of flatStaticOptions) {
			mergedMap.set(opt.value as TValue, opt as SelectOption<TValue>);
		}
		for (const opt of dynamicOptions) {
			mergedMap.set(opt.value as TValue, opt as SelectOption<TValue>);
		}
		return Array.from(mergedMap.values());
	}, [loadOptions, dynamicOptions, flatStaticOptions]);
	const getOptionLabel = useCallback(
		(option: SelectOption<TValue>): string =>
			resolveOptionLabel({
				value: option.value,
				label: option.label,
				resolveText,
				t: translate,
				locale,
			}),
		[locale, resolveText, translate],
	);

	const filteredOptions = useMemo(() => {
		if (loadOptions) {
			return allOptions;
		}
		if (!search) {
			return allOptions;
		}
		return allOptions.filter((opt) =>
			getOptionLabel(opt).toLowerCase().includes(search.toLowerCase()),
		);
	}, [allOptions, search, loadOptions, getOptionLabel]);

	// Get label for a value. Selected values may not be in the (windowed)
	// option list — `selectedLabels` covers those; without it an async select
	// would render raw ids in the chips.
	const getLabel = useCallback(
		(val: TValue): string => {
			const option = allOptions.find((opt) => opt.value === val);
			if (!option?.label && selectedLabels?.[String(val)]) {
				return selectedLabels[String(val)];
			}
			return resolveOptionLabel({
				value: val,
				label: option?.label,
				resolveText,
				t: translate,
				locale,
			});
		},
		[allOptions, locale, resolveText, translate, selectedLabels],
	);

	const findOption = useCallback(
		(val: TValue): SelectOption<TValue> | undefined =>
			allOptions.find((opt) => opt.value === val),
		[allOptions],
	);

	const handleToggle = useCallback(
		(selectedValue: string) => {
			const typedValue = selectedValue as TValue;
			const isSelected = resolvedValue.includes(typedValue);

			if (isSelected) {
				onChange(resolvedValue.filter((v) => v !== typedValue));
			} else {
				if (maxSelections && resolvedValue.length >= maxSelections) return;
				onChange([...resolvedValue, typedValue]);
			}
		},
		[resolvedValue, onChange, maxSelections],
	);

	const handleRemove = useCallback(
		(
			removedValue: TValue,
			e?: React.MouseEvent | React.PointerEvent | React.KeyboardEvent,
		) => {
			e?.preventDefault();
			e?.stopPropagation();
			onChange(resolvedValue.filter((v) => v !== removedValue));
		},
		[resolvedValue, onChange],
	);

	const handleClearAll = useCallback(
		(e: React.MouseEvent | React.PointerEvent | React.KeyboardEvent) => {
			e.preventDefault();
			e.stopPropagation();
			onChange([]);
		},
		[onChange],
	);

	const handleTriggerKeyDown = useCallback(
		(event: React.KeyboardEvent) => {
			if (
				resolvedValue.length > 0 &&
				!disabled &&
				(event.key === "Backspace" || event.key === "Delete")
			) {
				handleClearAll(event);
			}
		},
		[disabled, handleClearAll, resolvedValue.length],
	);

	const showLoading = isFetching || externalLoading;
	const canAddMore = !maxSelections || resolvedValue.length < maxSelections;
	// Set lookup: the option list does a per-option "is selected" check —
	// Array.includes would make that quadratic on large lists.
	const selectedValueSet = useMemo(
		() => new Set(resolvedValue as string[]),
		[resolvedValue],
	);

	// Visible and hidden chips
	const visibleChips = resolvedValue.slice(0, maxVisibleChips);
	const hiddenCount = resolvedValue.length - maxVisibleChips;

	const TriggerContent = (
		<div
			id={id}
			role="combobox"
			aria-controls="select-multi-list"
			aria-expanded={open}
			aria-invalid={ariaInvalid}
			aria-describedby={ariaDescribedBy}
			tabIndex={0}
			className={cn(
				"qa-select-multi control-surface font-chrome flex h-auto min-h-[var(--control-height)] w-full flex-wrap items-center gap-1 px-3 py-1.5 text-sm",
				"hover:bg-surface-low focus-within:border-border-strong focus-within:ring-ring/20 aria-expanded:border-border-strong aria-expanded:ring-ring/20 focus-within:ring-3 aria-expanded:ring-3",
				disabled && "cursor-not-allowed opacity-50",
				ariaInvalid && "border-destructive ring-destructive/20",
				className,
			)}
		>
			{resolvedValue.length === 0 ? (
				<span className="text-muted-foreground text-xs">
					{resolvedPlaceholder}
				</span>
			) : (
				<>
					{visibleChips.map((val) => {
						const chipOption = findOption(val);
						return (
							<Badge
								key={String(val)}
								variant="secondary"
								className={cn(
									// Touch: tall enough to host a 44px remove target and let
									// the chip-x tap slop spill out (Badge hard-codes
									// overflow-hidden, which would otherwise clip after:-inset-1).
									// Mirrors the editable chips-display chip; desktop unchanged.
									"min-h-11 overflow-visible pr-1 md:min-h-7 md:overflow-hidden",
									"gap-1",
									chipOption?.className,
								)}
							>
								{chipOption?.icon}
								<ChipLabel
									label={getLabel(val)}
									editTitle={t("field.editItem", "Edit item")}
									onEdit={
										onValueClick && !disabled
											? () => onValueClick(val)
											: undefined
									}
								/>
								{!disabled && (
									<span
										aria-hidden="true"
										title={t("field.removeItem", "Remove option")}
										onPointerDown={(e) => handleRemove(val, e)}
										onClick={(e) => handleRemove(val, e)}
										className={cn(
											"hover:bg-muted-foreground/20 relative inline-flex size-9 items-center justify-center rounded-full transition-colors md:size-5",
											// Touch: 36px visual + un-clipped -inset-1 slop = a real
											// 44px hit target (the chip x is a <span>, so the
											// foundation's button floor doesn't apply). Mirrors the
											// clear-all control below.
											"after:absolute after:-inset-1 md:after:hidden",
										)}
									>
										<Icon icon="ph:x" className="size-3.5 md:size-2.5" />
									</span>
								)}
							</Badge>
						);
					})}
					{hiddenCount > 0 && (
						<Badge variant="outline" className="text-muted-foreground">
							+{hiddenCount} more
						</Badge>
					)}
				</>
			)}
			<div className="ml-auto flex shrink-0 items-center gap-1">
				{resolvedValue.length > 0 && !disabled && (
					<span
						aria-hidden="true"
						title={t("common.clear", "Clear all")}
						onPointerDown={handleClearAll}
						onClick={handleClearAll}
						className={cn(
							"hover:bg-muted relative inline-flex size-9 items-center justify-center rounded-md opacity-60 transition-[background-color,opacity] hover:opacity-100 md:size-6",
							// Touch: full 44px hit area via slop on top of the 36px target.
							"after:absolute after:-inset-1 md:after:hidden",
						)}
					>
						<Icon icon="ph:x" className="size-4 md:size-3" />
					</span>
				)}
				<Icon icon="ph:plus" className="size-3.5 opacity-50" />
			</div>
		</div>
	);

	const CommandContent = (
		<Command shouldFilter={!loadOptions}>
			<CommandInput
				placeholder={t("ui.searchPlaceholder", "Search...")}
				value={search}
				onValueChange={setSearch}
			/>
			<CommandList>
				{showLoading && (
					<div className="flex items-center justify-center py-6">
						<Icon
							icon="ph:circle-notch"
							className="text-muted-foreground size-4 animate-spin"
						/>
					</div>
				)}
				<CommandEmpty>{resolvedEmptyMessage}</CommandEmpty>
				<CommandGroup>
					{filteredOptions.map((option) => {
						const isSelected = selectedValueSet.has(option.value as string);
						const isDisabled = option.disabled || (!isSelected && !canAddMore);
						const description = option.description
							? resolveText(option.description)
							: undefined;

						return (
							<CommandItem
								key={String(option.value)}
								value={String(option.value)}
								onSelect={handleToggle}
								disabled={isDisabled}
								className={cn("items-start", option.className)}
							>
								<div
									className={cn(
										"mt-0.5 flex size-4 shrink-0 items-center justify-center border",
										isSelected
											? "border-foreground bg-foreground text-background"
											: "border-muted-foreground/30",
									)}
								>
									{isSelected && <Icon icon="ph:check" className="size-3" />}
								</div>
								{option.icon}
								<div className="flex min-w-0 flex-1 flex-col">
									<span className="truncate">{getOptionLabel(option)}</span>
									{description && (
										<span className="text-muted-foreground truncate text-xs">
											{description}
										</span>
									)}
								</div>
							</CommandItem>
						);
					})}
				</CommandGroup>
			</CommandList>
			{onCreateNew && (
				<SelectCreateRow
					label={createNewLabel ?? t("relation.createNew", "Create new")}
					onSelect={() => {
						setOpen(false);
						onCreateNew();
					}}
				/>
			)}
			{maxSelections && (
				<div className="text-muted-foreground border-t p-2 text-center text-xs tabular-nums">
					{resolvedValue.length} / {maxSelections} selected
				</div>
			)}
		</Command>
	);

	// Mobile: Drawer
	if (isMobile) {
		return (
			<Drawer open={open} onOpenChange={setOpen}>
				<DrawerTrigger asChild>
					<button
						type="button"
						disabled={disabled}
						onKeyDown={handleTriggerKeyDown}
						className="w-full text-left"
					>
						{TriggerContent}
					</button>
				</DrawerTrigger>
				<DrawerContent>
					<DrawerHeader>
						<DrawerTitle>{resolvedDrawerTitle}</DrawerTitle>
					</DrawerHeader>
					<div className="pb-4">{CommandContent}</div>
				</DrawerContent>
			</Drawer>
		);
	}

	// Desktop: Popover
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				render={
					<button
						type="button"
						disabled={disabled}
						onKeyDown={handleTriggerKeyDown}
						className="w-full text-left"
					>
						{TriggerContent}
					</button>
				}
			/>
			<PopoverContent className="w-(--anchor-width) p-0" align="start">
				{CommandContent}
			</PopoverContent>
		</Popover>
	);
}
