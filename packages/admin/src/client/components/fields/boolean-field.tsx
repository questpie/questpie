import { Controller } from "react-hook-form";
import { CheckboxInput } from "../primitives/checkbox-input";
import { ToggleInput } from "../primitives/toggle-input";
import type { BaseFieldProps } from "./field-types";
import { useResolvedControl } from "./field-utils";
import { FieldWrapper } from "./field-wrapper";

export interface BooleanFieldProps extends BaseFieldProps {
  /**
   * Display mode for the boolean field.
   * @default "checkbox"
   */
  displayAs?: "checkbox" | "switch";
}

/**
 * Unified boolean field component.
 * Renders as checkbox (default) or switch based on `displayAs` prop.
 */
export function BooleanField({
  name,
  label,
  description,
  required,
  disabled,
  localized,
  locale,
  control,
  className,
  displayAs = "checkbox",
}: BooleanFieldProps) {
  const resolvedControl = useResolvedControl(control);

  return (
    <Controller
      name={name}
      control={resolvedControl}
      render={({ field, fieldState }) => (
        <FieldWrapper
          name={name}
          label={label}
          description={description}
          required={required}
          disabled={disabled}
          localized={localized}
          locale={locale}
          error={fieldState.error?.message}
        >
          {displayAs === "switch" ? (
            <ToggleInput
              id={name}
              value={!!field.value}
              onChange={field.onChange}
              disabled={disabled}
              aria-invalid={!!fieldState.error}
              className={className}
            />
          ) : (
            <CheckboxInput
              id={name}
              value={!!field.value}
              onChange={field.onChange}
              disabled={disabled}
              aria-invalid={!!fieldState.error}
              className={className}
            />
          )}
        </FieldWrapper>
      )}
    />
  );
}

// Re-export old names for backwards compatibility
export { BooleanField as CheckboxField };
export { BooleanField as SwitchField };
