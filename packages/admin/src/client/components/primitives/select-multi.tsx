"use client";

import { Icon } from "@iconify/react";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIsMobile } from "../../hooks/use-media-query";
import { useResolveText } from "../../i18n/hooks";
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

export interface SelectMultiProps<
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
  /** Max selections */
  maxSelections?: number;
  /** Debounce delay for loadOptions (ms) */
  debounceMs?: number;
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
  value = [],
  onChange,
  options: staticOptions = [],
  loadOptions,
  maxSelections,
  debounceMs = 300,
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
  const resolveText = useResolveText();
  const resolvedPlaceholder = resolveText(placeholder);
  const resolvedEmptyMessage = resolveText(emptyMessage);
  const resolvedDrawerTitle = resolveText(drawerTitle);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dynamicOptions, setDynamicOptions] = useState<SelectOption<TValue>[]>(
    [],
  );
  const [isLoading, setIsLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const isMobile = useIsMobile();

  // Flatten static options
  const flatStaticOptions = useMemo(
    () => flattenOptions(staticOptions),
    [staticOptions],
  );

  // Merge static and dynamic options
  const allOptions = useMemo(() => {
    if (loadOptions) {
      return dynamicOptions;
    }
    return flatStaticOptions;
  }, [loadOptions, dynamicOptions, flatStaticOptions]);

  // Filter options by search (for static options)
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

  // Load dynamic options
  useEffect(() => {
    if (!loadOptions) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(async () => {
      setIsLoading(true);
      try {
        const results = await loadOptions(search);
        setDynamicOptions(results);
      } catch (error) {
        console.error("Failed to load options:", error);
        setDynamicOptions([]);
      } finally {
        setIsLoading(false);
      }
    }, debounceMs);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [search, loadOptions, debounceMs]);

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
      const isSelected = value.includes(typedValue);

      if (isSelected) {
        onChange(value.filter((v) => v !== typedValue));
      } else {
        if (maxSelections && value.length >= maxSelections) return;
        onChange([...value, typedValue]);
      }
    },
    [value, onChange, maxSelections],
  );

  const handleRemove = useCallback(
    (removedValue: TValue, e?: React.MouseEvent) => {
      e?.stopPropagation();
      onChange(value.filter((v) => v !== removedValue));
    },
    [value, onChange],
  );

  const handleClearAll = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onChange([]);
    },
    [onChange],
  );

  const showLoading = isLoading || externalLoading;
  const canAddMore = !maxSelections || value.length < maxSelections;

  // Visible and hidden chips
  const visibleChips = value.slice(0, maxVisibleChips);
  const hiddenCount = value.length - maxVisibleChips;

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
        "flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input/80 bg-input/20 backdrop-blur-sm px-3 py-1.5 text-sm transition-colors",
        "focus-within:ring-2 focus-within:ring-ring focus-within:border-ring",
        disabled && "cursor-not-allowed opacity-50",
        ariaInvalid && "border-destructive ring-destructive/20",
        className,
      )}
    >
      {value.length === 0 ? (
        <span className="text-muted-foreground text-xs">
          {resolvedPlaceholder}
        </span>
      ) : (
        <>
          {visibleChips.map((val) => (
            <Badge key={String(val)} variant="secondary" className="gap-1 pr-1">
              <span className="truncate max-w-24">{getLabel(val)}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => handleRemove(val, e)}
                  className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                >
                  <Icon icon="ph:x" className="size-2.5" />
                </button>
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
      <div className="ml-auto flex items-center gap-1 shrink-0">
        {value.length > 0 && !disabled && (
          <button
            type="button"
            onClick={handleClearAll}
            className="rounded-sm opacity-50 hover:opacity-100 hover:bg-muted p-0.5"
          >
            <Icon icon="ph:x" className="size-3" />
          </button>
        )}
        <Icon icon="ph:plus" className="size-3.5 opacity-50" />
      </div>
    </div>
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
          {filteredOptions.map((option) => {
            const isSelected = value.includes(option.value);
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
                    "flex size-4 items-center justify-center rounded-sm border",
                    isSelected
                      ? "bg-primary border-primary text-primary-foreground"
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
        <div className="border-t p-2 text-center text-xs text-muted-foreground">
          {value.length} / {maxSelections} selected
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
