import { Controller } from "react-hook-form";
import { TextareaInput } from "../primitives/textarea-input";
import type { TextareaFieldProps } from "./field-types";
import { useResolvedControl } from "./field-utils";
import { FieldWrapper } from "./field-wrapper";

export function TextareaField({
  name,
  label,
  description,
  placeholder,
  required,
  disabled,
  localized,
  locale,
  control,
  className,
  rows,
  maxLength,
  autoResize,
}: TextareaFieldProps) {
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
          <TextareaInput
            id={name}
            value={field.value ?? ""}
            onChange={field.onChange}
            placeholder={placeholder}
            disabled={disabled}
            rows={rows}
            maxLength={maxLength}
            autoResize={autoResize}
            aria-invalid={!!fieldState.error}
            className={className}
          />
        </FieldWrapper>
      )}
    />
  );
}
