"use client";

import { Icon } from "@iconify/react";
import { type KeyboardEvent, useCallback, useState } from "react";
import { useResolveText } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import type { TagInputProps } from "./types";

/**
 * Tag Input Primitive
 *
 * An input for creating and managing tags/chips.
 * Supports validation patterns, max tags, and autocomplete suggestions.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <TagInput
 *   value={tags}
 *   onChange={setTags}
 *   placeholder="Add tags..."
 * />
 *
 * // With suggestions and validation
 * <TagInput
 *   value={emails}
 *   onChange={setEmails}
 *   suggestions={["user@example.com", "admin@example.com"]}
 *   pattern={/^[^\s@]+@[^\s@]+\.[^\s@]+$/}
 *   maxTags={5}
 * />
 * ```
 */
export function TagInput({
  value,
  onChange,
  suggestions = [],
  maxTags,
  allowDuplicates = false,
  pattern,
  placeholder = "Type and press Enter...",
  disabled,
  className,
  id,
  "aria-invalid": ariaInvalid,
}: TagInputProps) {
  const resolveText = useResolveText();
  const [inputValue, setInputValue] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const addTag = useCallback(
    (tag: string) => {
      const trimmed = tag.trim();
      if (!trimmed) return;

      // Check max tags
      if (maxTags && value.length >= maxTags) return;

      // Check duplicates
      if (!allowDuplicates && value.includes(trimmed)) return;

      // Check pattern
      if (pattern && !pattern.test(trimmed)) return;

      onChange([...value, trimmed]);
      setInputValue("");
      setShowSuggestions(false);
    },
    [value, onChange, maxTags, allowDuplicates, pattern],
  );

  const removeTag = useCallback(
    (index: number) => {
      if (disabled) return;
      const newTags = value.filter((_, i) => i !== index);
      onChange(newTags);
    },
    [value, onChange, disabled],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addTag(inputValue);
      } else if (e.key === "Backspace" && !inputValue && value.length > 0) {
        removeTag(value.length - 1);
      } else if (e.key === "Escape") {
        setShowSuggestions(false);
      }
    },
    [inputValue, value, addTag, removeTag],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      setInputValue(newValue);
      setShowSuggestions(newValue.length > 0 && suggestions.length > 0);
    },
    [suggestions],
  );

  const filteredSuggestions = suggestions.filter(
    (suggestion) =>
      suggestion.toLowerCase().includes(inputValue.toLowerCase()) &&
      (allowDuplicates || !value.includes(suggestion)),
  );

  const canAddMore = !maxTags || value.length < maxTags;

  return (
    <div className={cn("relative", className)}>
      <div
        className={cn(
          "flex flex-wrap gap-1.5 min-h-9 w-full border border-input/80 bg-input/20 backdrop-blur-sm px-3 py-2",
          "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
          ariaInvalid && "border-destructive ring-destructive/20",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        {value.map((tag, index) => (
          <Badge
            key={`${tag}-${index}`}
            variant="secondary"
            className="gap-1 pr-1"
          >
            {tag}
            {!disabled && (
              <button
                type="button"
                onClick={() => removeTag(index)}
                className="ml-1 rounded-full p-0.5 hover:bg-muted-foreground/20"
                aria-label={`Remove ${tag}`}
              >
                <Icon icon="ph:x" className="size-3" />
              </button>
            )}
          </Badge>
        ))}
        {canAddMore && (
          <input
            id={id}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() =>
              setShowSuggestions(
                inputValue.length > 0 && suggestions.length > 0,
              )
            }
            onBlur={() => {
              // Delay to allow click on suggestion
              setTimeout(() => setShowSuggestions(false), 150);
            }}
            placeholder={
              value.length === 0 ? resolveText(placeholder) : undefined
            }
            disabled={disabled}
            aria-invalid={ariaInvalid}
            className={cn(
              "flex-1 min-w-[120px] bg-transparent text-sm outline-none placeholder:text-muted-foreground",
              "disabled:cursor-not-allowed",
            )}
          />
        )}
      </div>

      {/* Suggestions dropdown */}
      {showSuggestions && filteredSuggestions.length > 0 && (
        <div
          className={cn(
            "absolute z-50 mt-1 w-full border border-input bg-popover shadow-md",
            "max-h-[200px] overflow-auto",
          )}
        >
          {filteredSuggestions.map((suggestion, index) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => addTag(suggestion)}
              className={cn(
                "w-full px-3 py-2 text-left text-sm",
                "hover:bg-accent hover:text-accent-foreground",
                "focus:bg-accent focus:text-accent-foreground focus:outline-none",
              )}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {/* Helper text for max tags */}
      {maxTags && (
        <p className="mt-1 text-xs text-muted-foreground">
          {value.length} / {maxTags} tags
        </p>
      )}
    </div>
  );
}
