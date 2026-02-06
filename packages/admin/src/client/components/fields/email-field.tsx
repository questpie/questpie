import { Controller } from "react-hook-form";
import { TextInput } from "../primitives/text-input";
import type { BaseFieldProps } from "./field-types";
import { useResolvedControl } from "./field-utils";
import { FieldWrapper } from "./field-wrapper";

export function EmailField({
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
}: BaseFieldProps) {
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
          <TextInput
            id={name}
            value={field.value ?? ""}
            onChange={field.onChange}
            type="email"
            placeholder={placeholder}
            disabled={disabled}
            autoComplete="email"
            aria-invalid={!!fieldState.error}
            className={className}
          />
        </FieldWrapper>
      )}
    />
  );
}
