import { Icon } from "@iconify/react";
import * as React from "react";
import { cn } from "../../lib/utils";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "./input-group";
import { Kbd } from "./kbd";

// ============================================================================
// Types
// ============================================================================

export interface SearchInputProps extends Omit<
  React.ComponentProps<"input">,
  "type"
> {
  /**
   * Keyboard shortcut to display (e.g., "⌘K")
   */
  shortcut?: string;

  /**
   * Callback when clear button is clicked
   */
  onClear?: () => void;

  /**
   * Show loading spinner instead of search icon
   */
  isLoading?: boolean;

  /**
   * Additional className for the container
   */
  containerClassName?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * SearchInput - Consistent search input with icon, loading state, clear button, and keyboard shortcut
 *
 * @example
 * ```tsx
 * // Basic usage
 * <SearchInput
 *   value={searchTerm}
 *   onChange={(e) => setSearchTerm(e.target.value)}
 *   onClear={() => setSearchTerm("")}
 *   placeholder="Search..."
 * />
 *
 * // With keyboard shortcut
 * <SearchInput
 *   shortcut="⌘K"
 *   onClick={openSearchDialog}
 *   readOnly
 * />
 *
 * // Loading state
 * <SearchInput isLoading={isSearching} ... />
 * ```
 */
export function SearchInput({
  shortcut,
  onClear,
  isLoading = false,
  containerClassName,
  className,
  value,
  ...props
}: SearchInputProps): React.ReactElement {
  const hasValue = value !== undefined && value !== "";
  const showClearButton = hasValue && onClear;
  const showShortcut = shortcut && !hasValue;

  return (
    <InputGroup className={cn("bg-transparent", containerClassName)}>
      <InputGroupAddon align="inline-start">
        {isLoading ? (
          <Icon
            icon="ph:spinner-gap"
            className="size-4 animate-spin text-muted-foreground"
          />
        ) : (
          <Icon
            icon="ph:magnifying-glass"
            className="size-4 text-muted-foreground"
          />
        )}
      </InputGroupAddon>

      <InputGroupInput
        placeholder="Search..."
        value={value}
        className={className}
        {...props}
      />

      {(showClearButton || showShortcut) && (
        <InputGroupAddon align="inline-end">
          {showClearButton && (
            <InputGroupButton
              onClick={onClear}
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground"
            >
              <Icon icon="ph:x" className="size-3" />
            </InputGroupButton>
          )}
          {showShortcut && <Kbd>{shortcut}</Kbd>}
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}
