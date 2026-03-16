import { useResolveText } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import { useFieldIds } from "../ui/field";
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
	"aria-describedby": ariaDescribedByProp,
}: TextInputProps) {
	const resolveText = useResolveText();
	const fieldIds = useFieldIds();
	const ariaDescribedBy =
		ariaDescribedByProp ??
		([
			fieldIds?.hasError ? fieldIds.errorId : null,
			fieldIds?.hasDescription ? fieldIds.descriptionId : null,
		]
			.filter(Boolean)
			.join(" ") ||
			undefined);

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
			aria-describedby={ariaDescribedBy}
			className={cn("qa-text-input", className)}
		/>
	);
}
