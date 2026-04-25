"use client";

import { Icon } from "@iconify/react";
import { useQuery } from "@tanstack/react-query";
import type * as React from "react";
import { useCallback, useDeferredValue, useId, useMemo, useState } from "react";

import { useIsMobile } from "../../hooks/use-media-query";
import { useResolveText } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
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
import { FieldSelectTrigger } from "./field-select-control";
import type { BasePrimitiveProps, SelectOption, SelectOptions } from "./types";
import { flattenOptions } from "./types";

// Module-level constant for empty options to avoid recreating on each render
const EMPTY_OPTIONS: SelectOptions<string> = [];
const SEARCH_OPTION_THRESHOLD = 8;

interface SelectSingleProps<
	TValue extends string = string,
> extends BasePrimitiveProps {
	/** Selected value */
	value: TValue | null;
	/** Change handler */
	onChange: (value: TValue | null) => void;
	/** Static options */
	options?: SelectOptions<TValue>;
	/** Dynamic options loader */
	loadOptions?: (search: string) => Promise<SelectOption<TValue>[]>;
	/** Query key builder for loadOptions */
	queryKey?: (search: string) => readonly unknown[];
	/** Prefetch options on mount */
	prefetchOnMount?: boolean;

	/** Allow clearing selection */
	clearable?: boolean;
	/** Debounce delay for loadOptions (ms) */
	debounceMs?: number;
	/** External loading state */
	loading?: boolean;
	/** Empty state message */
	emptyMessage?: string;
	/** Show search input in popup. "auto" shows it for async or larger option lists. */
	searchable?: boolean | "auto";
	/** Title for mobile drawer */
	drawerTitle?: string;
	/**
	 * Label to display for the selected value when it cannot be resolved from options yet.
	 * Used as a fallback during async loading (e.g. relation fields resolving item title).
	 */
	selectedLabel?: string;
	/**
	 * Show a loading spinner in the trigger while the selected value's label is being resolved.
	 * Use this when the selected item is being fetched asynchronously.
	 */
	isLoadingValue?: boolean;
	/**
	 * Render the trigger without its own border/rounded corners for use inside InputGroup.
	 * Adds data-slot="input-group-control" for InputGroup focus-ring support.
	 */
	asInputGroupControl?: boolean;
}

/**
 * SelectSingle - Single select component with search
 *
 * Features:
 * - Searchable when async or option list is large
 * - Responsive: Popover on desktop, Drawer on mobile
 * - Supports static and async options
 * - Keyboard navigation
 *
 * @example
 * ```tsx
 * <SelectSingle
 *   value={status}
 *   onChange={setStatus}
 *   options={[
 *     { value: "active", label: "Active" },
 *     { value: "inactive", label: "Inactive" },
 *   ]}
 * />
 * ```
 */
export function SelectSingle<TValue extends string = string>({
	value,
	onChange,
	options: staticOptions,
	loadOptions,
	queryKey,
	prefetchOnMount = false,
	clearable = true,
	loading: externalLoading = false,
	emptyMessage = "No options found",
	searchable = "auto",
	placeholder = "Select...",
	disabled,
	className,
	id,
	"aria-invalid": ariaInvalid,
	drawerTitle = "Select option",
	selectedLabel,
	isLoadingValue = false,
	asInputGroupControl = false,
}: SelectSingleProps<TValue>) {
	const resolvedStaticOptions = staticOptions ?? EMPTY_OPTIONS;
	const resolveText = useResolveText();
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
				: ["select-single", instanceId, deferredSearch],
		[queryKey, deferredSearch, instanceId],
	);

	const { data: dynamicOptions = [], isFetching } = useQuery({
		queryKey: loadOptionsKey,
		queryFn: () => loadOptions?.(deferredSearch) ?? Promise.resolve([]),
		enabled: !!loadOptions && (open || prefetchOnMount),
		staleTime: 30_000,
		gcTime: 5 * 60_000,
	});

	// Merge static and dynamic options (immutable pattern for React Compiler)
	const allOptions = useMemo<SelectOption<TValue>[]>(() => {
		if (!loadOptions) {
			return flatStaticOptions as SelectOption<TValue>[];
		}
		if (flatStaticOptions.length === 0) {
			return dynamicOptions as SelectOption<TValue>[];
		}
		// Use reduce to build Map immutably - dynamic options override static
		const mergedMap = [...flatStaticOptions, ...dynamicOptions].reduce(
			(map, opt) =>
				new Map(map).set(opt.value as TValue, opt as SelectOption<TValue>),
			new Map<TValue, SelectOption<TValue>>(),
		);
		return Array.from(mergedMap.values());
	}, [loadOptions, dynamicOptions, flatStaticOptions]);
	const showSearchInput =
		searchable === "auto"
			? !!loadOptions || allOptions.length > SEARCH_OPTION_THRESHOLD
			: searchable;

	// Filter options by search (for static options)
	const filteredOptions = useMemo(() => {
		if (!showSearchInput) {
			return allOptions;
		}
		if (loadOptions) {
			return allOptions; // Dynamic options are already filtered by server
		}
		if (!search) {
			return allOptions;
		}
		return allOptions.filter((opt: SelectOption<TValue>) =>
			resolveText(opt.label).toLowerCase().includes(search.toLowerCase()),
		);
	}, [allOptions, search, loadOptions, resolveText, showSearchInput]);

	// Get label for a value — falls back to selectedLabel, then raw value string
	const getLabel = useCallback(
		(val: TValue): string => {
			const option = allOptions.find(
				(opt: SelectOption<TValue>) => opt.value === val,
			);
			if (option?.label) return resolveText(option.label);
			if (selectedLabel) return selectedLabel;
			return String(val);
		},
		[allOptions, resolveText, selectedLabel],
	);

	const handleSelect = useCallback(
		(selectedValue: string) => {
			onChange(selectedValue as TValue);
			setOpen(false);
			setSearch("");
		},
		[onChange],
	);

	const handleClear = useCallback(
		(e: React.MouseEvent | React.PointerEvent | React.KeyboardEvent) => {
			e.preventDefault();
			e.stopPropagation();
			onChange(null);
		},
		[onChange],
	);

	const handleTriggerKeyDown = useCallback(
		(event: React.KeyboardEvent) => {
			if (
				clearable &&
				value &&
				!disabled &&
				!isLoadingValue &&
				(event.key === "Backspace" || event.key === "Delete")
			) {
				handleClear(event);
			}
		},
		[clearable, disabled, handleClear, isLoadingValue, value],
	);

	const showLoading = isFetching || externalLoading;

	const listboxId = `${instanceId}-listbox`;

	const TriggerButton = (
		<FieldSelectTrigger
			id={id}
			role="combobox"
			aria-expanded={open}
			aria-controls={listboxId}
			aria-invalid={ariaInvalid}
			disabled={disabled}
			hasValue={!!value}
			onKeyDown={handleTriggerKeyDown}
			asInputGroupControl={asInputGroupControl}
			className={cn(
				// flex-1 min-w-0: override Button's shrink-0 so the control yields
				// space to sibling InputGroupAddon buttons. The CSS rule in base.css
				// targeting [data-slot="input-group-control"] provides the same fix
				// at the CSS layer as a safety net.
				className,
			)}
		>
			<span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
				{isLoadingValue && value ? (
					<Icon
						icon="ph:circle-notch"
						className="text-muted-foreground size-3 shrink-0 animate-spin"
					/>
				) : null}
				<span
					className={cn(
						"truncate",
						isLoadingValue && value && "text-muted-foreground",
					)}
				>
					{value ? getLabel(value) : resolvedPlaceholder}
				</span>
			</span>
			<div className="flex h-full shrink-0 items-center gap-1">
				{clearable && value && !disabled && !isLoadingValue && (
					<span
						aria-hidden="true"
						title="Clear selection"
						onPointerDown={handleClear}
						onClick={handleClear}
						className="hover:bg-surface-high -mr-1 inline-flex size-6 items-center justify-center rounded-md opacity-60 transition-[background-color,opacity] hover:opacity-100"
					>
						<Icon icon="ph:x" className="size-3" />
					</span>
				)}
				<Icon icon="ph:caret-up-down" className="size-3.5 opacity-50" />
			</div>
		</FieldSelectTrigger>
	);

	const CommandContent = (
		<Command shouldFilter={showSearchInput && !loadOptions}>
			{showSearchInput && (
				<CommandInput
					placeholder="Search..."
					value={search}
					onValueChange={setSearch}
				/>
			)}
			<CommandList id={listboxId}>
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
					{filteredOptions.map((option) => (
						<CommandItem
							key={String(option.value)}
							value={String(option.value)}
							onSelect={handleSelect}
							disabled={option.disabled}
							data-checked={value === option.value}
						>
							{option.icon}
							<span className="truncate">{resolveText(option.label)}</span>
						</CommandItem>
					))}
				</CommandGroup>
			</CommandList>
		</Command>
	);

	// Mobile: Drawer
	if (isMobile) {
		return (
			<Drawer open={open} onOpenChange={setOpen}>
				<DrawerTrigger asChild>{TriggerButton}</DrawerTrigger>
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
			<PopoverTrigger render={TriggerButton} />
			<PopoverContent className="w-(--anchor-width) p-0" align="start">
				{CommandContent}
			</PopoverContent>
		</Popover>
	);
}
