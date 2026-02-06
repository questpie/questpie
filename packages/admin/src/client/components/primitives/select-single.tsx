"use client";

import { Icon } from "@iconify/react";
import { useQuery } from "@tanstack/react-query";
import type * as React from "react";
import { useCallback, useDeferredValue, useId, useMemo, useState } from "react";
import { useIsMobile } from "../../hooks/use-media-query";
import { useResolveText } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
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

export interface SelectSingleProps<
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
  /** Title for mobile drawer */
  drawerTitle?: string;
}

/**
 * SelectSingle - Single select component with search
 *
 * Features:
 * - Always searchable
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
  options: staticOptions = [],
  loadOptions,
  queryKey,
  prefetchOnMount = false,
  clearable = true,
  loading: externalLoading = false,
  emptyMessage = "No options found",
  placeholder = "Select...",
  disabled,
  className,
  id,
  "aria-invalid": ariaInvalid,
  drawerTitle = "Select option",
}: SelectSingleProps<TValue>) {
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
    () => flattenOptions(staticOptions),
    [staticOptions],
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
  const allOptions = useMemo(() => {
    if (!loadOptions) {
      return flatStaticOptions;
    }
    if (flatStaticOptions.length === 0) {
      return dynamicOptions;
    }
    // Use reduce to build Map immutably - dynamic options override static
    const mergedMap = [...flatStaticOptions, ...dynamicOptions].reduce(
      (map, opt) => new Map(map).set(opt.value, opt),
      new Map<TValue, SelectOption<TValue>>(),
    );
    return Array.from(mergedMap.values());
  }, [loadOptions, dynamicOptions, flatStaticOptions]);

  // Filter options by search (for static options)
  const filteredOptions = useMemo(() => {
    if (loadOptions) {
      return allOptions; // Dynamic options are already filtered by server
    }
    if (!search) {
      return allOptions;
    }
    return allOptions.filter((opt: SelectOption<TValue>) =>
      resolveText(opt.label).toLowerCase().includes(search.toLowerCase()),
    );
  }, [allOptions, search, loadOptions, resolveText]);

  // Get label for a value
  const getLabel = useCallback(
    (val: TValue): string => {
      const option = allOptions.find(
        (opt: SelectOption<TValue>) => opt.value === val,
      );
      return option?.label ? resolveText(option.label) : String(val);
    },
    [allOptions, resolveText],
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
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onChange(null);
    },
    [onChange],
  );

  const showLoading = isFetching || externalLoading;

  const TriggerButton = (
    <Button
      id={id}
      variant="outline"
      role="combobox"
      aria-expanded={open}
      aria-invalid={ariaInvalid}
      disabled={disabled}
      className={cn(
        "w-full justify-between font-normal",
        !value && "text-muted-foreground",
        className,
      )}
    >
      <span className="truncate">
        {value ? getLabel(value) : resolvedPlaceholder}
      </span>
      <div className="flex items-center gap-1 shrink-0">
        {clearable && value && !disabled && (
          <span
            role="button"
            tabIndex={-1}
            onClick={handleClear}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleClear(event as unknown as React.MouseEvent);
              }
            }}
            className="rounded-sm opacity-50 hover:opacity-100 hover:bg-muted p-0.5 -mr-1"
          >
            <Icon icon="ph:x" className="size-3" />
          </span>
        )}
        <Icon icon="ph:caret-up-down" className="size-3.5 opacity-50" />
      </div>
    </Button>
  );

  const CommandContent = (
    <Command shouldFilter={!loadOptions}>
      <CommandInput
        placeholder="Search..."
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        {showLoading && (
          <div className="flex items-center justify-center py-6">
            <Icon
              icon="ph:circle-notch"
              className="size-4 animate-spin text-muted-foreground"
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
