import { Controller } from "react-hook-form";

import { cn } from "../../lib/utils";
import { DateInput } from "../primitives/date-input";
import type { DateFieldProps } from "./field-types";
import { useResolvedControl } from "./field-utils";
import { FieldWrapper } from "./field-wrapper";

function parseDateFieldValue(value: unknown): Date | null {
	if (!value) return null;
	const date = value instanceof Date ? value : new Date(String(value));
	return Number.isNaN(date.getTime()) ? null : date;
}

export function DateField({
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
	minDate,
	maxDate,
	format,
}: DateFieldProps) {
	const resolvedControl = useResolvedControl(control);

	return (
		<Controller
			name={name}
			control={resolvedControl}
			render={({ field, fieldState }) => {
				const dateValue = parseDateFieldValue(field.value);

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
						<DateInput
							id={name}
							value={dateValue}
							onChange={field.onChange}
							minDate={minDate}
							maxDate={maxDate}
							format={format}
							placeholder={placeholder}
							disabled={disabled}
							aria-invalid={!!fieldState.error}
							className={cn("qa-date-field", className)}
						/>
					</FieldWrapper>
				);
			}}
		/>
	);
}
