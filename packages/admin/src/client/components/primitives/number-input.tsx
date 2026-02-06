import { Icon } from "@iconify/react";
import { useResolveText } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import type { NumberInputProps } from "./types";

/**
 * Number Input Primitive
 *
 * A number input with optional increment/decrement buttons.
 *
 * @example
 * ```tsx
 * <NumberInput
 *   value={count}
 *   onChange={setCount}
 *   min={0}
 *   max={100}
 *   step={1}
 *   showButtons
 * />
 * ```
 */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  showButtons = false,
  placeholder,
  disabled,
  readOnly,
  className,
  id,
  "aria-invalid": ariaInvalid,
}: NumberInputProps) {
  const resolveText = useResolveText();

  const handleChange = (newValue: number | null) => {
    if (newValue === null) {
      onChange(null);
      return;
    }

    let clampedValue = newValue;
    if (min !== undefined && clampedValue < min) clampedValue = min;
    if (max !== undefined && clampedValue > max) clampedValue = max;

    onChange(clampedValue);
  };

  const increment = () => {
    const current = value ?? 0;
    handleChange(current + step);
  };

  const decrement = () => {
    const current = value ?? 0;
    handleChange(current - step);
  };

  if (showButtons) {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={decrement}
          disabled={disabled || (min !== undefined && (value ?? 0) <= min)}
          tabIndex={-1}
        >
          <Icon icon="ph:minus" className="size-3" />
        </Button>
        <Input
          id={id}
          type="number"
          value={value ?? ""}
          onChange={(e) => {
            const val = e.target.value;
            if (val === "") {
              handleChange(null);
            } else {
              handleChange(Number(val));
            }
          }}
          placeholder={resolveText(placeholder)}
          disabled={disabled}
          readOnly={readOnly}
          min={min}
          max={max}
          step={step}
          aria-invalid={ariaInvalid}
          className="text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={increment}
          disabled={disabled || (max !== undefined && (value ?? 0) >= max)}
          tabIndex={-1}
        >
          <Icon icon="ph:plus" className="size-3" />
        </Button>
      </div>
    );
  }

  return (
    <Input
      id={id}
      type="number"
      value={value ?? ""}
      onChange={(e) => {
        const val = e.target.value;
        if (val === "") {
          handleChange(null);
        } else {
          handleChange(Number(val));
        }
      }}
      placeholder={resolveText(placeholder)}
      disabled={disabled}
      readOnly={readOnly}
      min={min}
      max={max}
      step={step}
      aria-invalid={ariaInvalid}
      className={className}
    />
  );
}
