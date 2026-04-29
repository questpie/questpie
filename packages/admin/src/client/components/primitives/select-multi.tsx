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
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import type { BasePrimitiveProps, SelectOption, SelectOptions } from "./types";
import { flattenOptions } from "./types";

// Module-level constants for empty arrays to avoid recreating on each render
const EMPTY_VALUE: string[] = [];
const EMPTY_OPTIONS: SelectOptions<string> = [];

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
	drawerTitle = "Select options",
	maxVisibleChips = 3,
}: SelectMultiProps<TValue>) {
	const resolvedValue = value ?? (EMPTY_VALUE as TValue[]);
	const resolvedStaticOptions = staticOptions ?? EMPTY_OPTIONS;
	const resolveText = useResolveText();
	const i18n = useSafeI18n();
	const t = (key: string, fallback: string) => {
		const message = i18n?.t(key);
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
		const mergedMap = [...flatStaticOptions, ...dynamicOptions].reduce(
			(map, opt) =>
				new Map(map).set(opt.value as TValue, opt as SelectOption<TValue>),
			new Map<TValue, SelectOption<TValue>>(),
		);
		return Array.from(mergedMap.values());
	}, [loadOptions, dynamicOptions, flatStaticOptions]);

	const filteredOptions = useMemo(() => {
		if (loadOptions) {
			return allOptions;
		}
		if (!search) {
			return allOptions;
		}
		return allOptions.filter((opt) =>
			resolveText(opt.label).toLowerCase().includes(search.toLowerCase()),
		);
	}, [allOptions, search, loadOptions, resolveText]);

	// Get label for a value
	const getLabel = useCallback(
		(val: TValue): string => {
			const option = allOptions.find((opt) => opt.value === val);
			return option?.label ? resolveText(option.label) : String(val);
		},
		[allOptions, resolveText],
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

	// Visible and hidden chips
	const visibleChips = resolvedValue.slice(0, maxVisibleChips);
	const hiddenCount = resolvedValue.length - maxVisibleChips;

	const TriggerContent = (
		<div
			id={id}
			role="combobox"
			aria-controls="select-multi-list"
			aria-haspopup="listbox"
			aria-expanded={open}
			aria-invalid={ariaInvalid}
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
					{visibleChips.map((val) => (
						<Badge
							key={String(val)}
							variant="secondary"
							className="min-h-7 gap-1 pr-1"
						>
							<span className="max-w-24 truncate">{getLabel(val)}</span>
							{!disabled && (
								<span
									aria-hidden="true"
									title={t("field.removeItem", "Remove option")}
									onPointerDown={(e) => handleRemove(val, e)}
									onClick={(e) => handleRemove(val, e)}
									className="hover:bg-muted-foreground/20 inline-flex size-5 items-center justify-center rounded-full transition-colors"
								>
									<Icon icon="ph:x" className="size-2.5" />
								</span>
							)}
						</Badge>
					))}
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
						className="hover:bg-muted inline-flex size-6 items-center justify-center rounded-md opacity-60 transition-[background-color,opacity] hover:opacity-100"
					>
						<Icon icon="ph:x" className="size-3" />
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
						const isSelected = (resolvedValue as string[]).includes(
							option.value as string,
						);
						const isDisabled = option.disabled || (!isSelected && !canAddMore);

						return (
							<CommandItem
								key={String(option.value)}
								value={String(option.value)}
								onSelect={handleToggle}
								disabled={isDisabled}
							>
								<div
									className={cn(
										"flex size-4 items-center justify-center border",
										isSelected
											? "border-foreground bg-foreground text-background"
											: "border-muted-foreground/30",
									)}
								>
									{isSelected && <Icon icon="ph:check" className="size-3" />}
								</div>
								{option.icon}
								<span className="truncate">{resolveText(option.label)}</span>
							</CommandItem>
						);
					})}
				</CommandGroup>
			</CommandList>
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
					<div className="px-4 pb-6">{CommandContent}</div>
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
