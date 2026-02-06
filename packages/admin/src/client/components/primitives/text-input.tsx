import { useResolveText } from "../../i18n/hooks";
import { Input } from "../ui/input";
import type { TextInputProps } from "./types";

/**
 * Text Input Primitive
 *
 * A basic text input with value/onChange pattern.
 * Supports different input types: text, email, password, url, tel, search.
 *
 * @example
 * ```tsx
 * <TextInput
 *   value={email}
 *   onChange={setEmail}
 *   type="email"
 *   placeholder="Enter email"
 * />
 * ```
 */
export function TextInput({
  value,
  onChange,
  type = "text",
  placeholder,
  disabled,
  readOnly,
  maxLength,
  autoComplete,
  className,
  id,
  "aria-invalid": ariaInvalid,
}: TextInputProps) {
  const resolveText = useResolveText();

  return (
    <Input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={resolveText(placeholder)}
      disabled={disabled}
      readOnly={readOnly}
      maxLength={maxLength}
      autoComplete={autoComplete}
      aria-invalid={ariaInvalid}
      className={className}
    />
  );
}
