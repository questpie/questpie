import { Controller } from "react-hook-form";
import { TimeInput } from "../primitives/time-input";
import type { TimeFieldProps } from "./field-types";
import { useResolvedControl } from "./field-utils";
import { FieldWrapper } from "./field-wrapper";

export function TimeField({
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
  precision,
}: TimeFieldProps) {
  const resolvedControl = useResolvedControl(control);

  return (
    <Controller
      name={name}
      control={resolvedControl}
      render={({ field, fieldState }) => {
        return (
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
            <TimeInput
              id={name}
              value={field.value ?? null}
              onChange={field.onChange}
              precision={precision}
              placeholder={placeholder}
              disabled={disabled}
              aria-invalid={!!fieldState.error}
              className={className}
            />
          </FieldWrapper>
        );
      }}
    />
  );
}
