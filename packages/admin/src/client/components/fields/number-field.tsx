import { Controller } from "react-hook-form";

import { cn } from "../../lib/utils";
import { NumberInput } from "../primitives/number-input";
import type { NumberFieldProps } from "./field-types";
import { useResolvedControl } from "./field-utils";
import { FieldWrapper } from "./field-wrapper";

export function NumberField({
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
	min,
	max,
	step,
	showButtons,
}: NumberFieldProps) {
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
					<NumberInput
						id={name}
						value={field.value ?? null}
						onChange={field.onChange}
						placeholder={placeholder}
						disabled={disabled}
						min={min}
						max={max}
						step={step}
						showButtons={showButtons}
						aria-invalid={!!fieldState.error}
						className={cn("qa-number-field", className)}
					/>
				</FieldWrapper>
			)}
		/>
	);
}
