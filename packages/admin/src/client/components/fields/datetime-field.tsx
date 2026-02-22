import { Controller } from "react-hook-form";
import { DateTimeInput } from "../primitives/date-input";
import type { DateTimeFieldProps } from "./field-types";
import { useResolvedControl } from "./field-utils";
import { FieldWrapper } from "./field-wrapper";

export function DatetimeField({
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
	precision,
}: DateTimeFieldProps) {
	const resolvedControl = useResolvedControl(control);

	return (
		<Controller
			name={name}
			control={resolvedControl}
			render={({ field, fieldState }) => {
				// Handle string dates from form (convert to Date object)
				const dateValue =
					field.value instanceof Date
						? field.value
						: field.value
							? new Date(field.value)
							: null;

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
							className={className}
						/>
					</FieldWrapper>
				);
			}}
		/>
	);
}
