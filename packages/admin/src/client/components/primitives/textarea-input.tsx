import { useResolveText } from "../../i18n/hooks";
import { Textarea } from "../ui/textarea";
import type { TextareaInputProps } from "./types";

/**
 * Textarea Input Primitive
 *
 * A multi-line text input.
 *
 * @example
 * ```tsx
 * <TextareaInput
 *   value={description}
 *   onChange={setDescription}
 *   rows={4}
 *   placeholder="Enter description..."
 * />
 * ```
 */
export function TextareaInput({
  value,
  onChange,
  rows = 3,
  maxLength,
  placeholder,
  disabled,
  readOnly,
  className,
  id,
  "aria-invalid": ariaInvalid,
}: TextareaInputProps) {
  const resolveText = useResolveText();

  return (
    <Textarea
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      maxLength={maxLength}
      placeholder={resolveText(placeholder)}
      disabled={disabled}
      readOnly={readOnly}
      aria-invalid={ariaInvalid}
      className={className}
    />
  );
}
