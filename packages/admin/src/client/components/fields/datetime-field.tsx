import { Controller } from "react-hook-form";

import { cn } from "../../lib/utils";
import { DateTimeInput } from "../primitives/date-input";
import type { DateTimeFieldProps } from "./field-types";
import { useResolvedControl } from "./field-utils";
import { FieldWrapper } from "./field-wrapper";

function parseDateTimeFieldValue(value: unknown): Date | null {
	if (!value) return null;
	const date = value instanceof Date ? value : new Date(String(value));
	return Number.isNaN(date.getTime()) ? null : date;
}

export function DatetimeField({
	name,
	label,
	description,
	placeholder,
	required,
	disabled,
	localized,
	locale,
	hideLabel,
	control,
	className,
	minDate,
	maxDate,
	format,
	precision,
}: DateTimeFieldProps) {
	const resolvedControl = useResolvedControl(control);

	return (
		<Controller
			name={name}
			control={resolvedControl}
			render={({ field, fieldState }) => {
				const dateValue = parseDateTimeFieldValue(field.value);

				return (
					<FieldWrapper
						name={name}
						label={label}
						description={description}
						required={required}
						disabled={disabled}
						localized={localized}
						locale={locale}
						hideLabel={hideLabel}
						error={fieldState.error?.message}
					>
						<DateTimeInput
							id={name}
							value={dateValue}
							onChange={field.onChange}
							minDate={minDate}
							maxDate={maxDate}
							format={format}
							precision={precision}
							placeholder={placeholder}
							disabled={disabled}
							aria-invalid={!!fieldState.error}
							className={cn("qa-datetime-field", className)}
						/>
					</FieldWrapper>
				);
			}}
		/>
	);
}
