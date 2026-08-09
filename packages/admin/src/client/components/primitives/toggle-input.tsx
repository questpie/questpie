import { cn } from "../../lib/utils";
import { useFieldAriaDescribedBy } from "../ui/field";
import { Switch } from "../ui/switch";
import type { ToggleInputProps } from "./types";

/**
 * Toggle Input Primitive
 *
 * A switch/toggle for boolean values.
 *
 * @example
 * ```tsx
 * <ToggleInput
 *   value={isActive}
 *   onChange={setIsActive}
 * />
 * ```
 */
export function ToggleInput({
	value,
	onChange,
	disabled,
	className,
	id,
	"aria-invalid": ariaInvalid,
	"aria-describedby": ariaDescribedByProp,
}: ToggleInputProps) {
	const ariaDescribedBy = useFieldAriaDescribedBy(ariaDescribedByProp);

	return (
		<Switch
			id={id}
			checked={value}
			onCheckedChange={onChange}
			disabled={disabled}
			aria-invalid={ariaInvalid}
			aria-describedby={ariaDescribedBy}
			className={cn("qa-toggle-input", className)}
		/>
	);
}
