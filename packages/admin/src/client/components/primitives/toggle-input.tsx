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
}: ToggleInputProps) {
	return (
		<Switch
			id={id}
			checked={value}
			onCheckedChange={onChange}
			disabled={disabled}
			aria-invalid={ariaInvalid}
			className={className}
		/>
	);
}
