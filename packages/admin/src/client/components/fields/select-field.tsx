import { Controller } from "react-hook-form";

import { cn } from "../../lib/utils";
import { SelectMulti } from "../primitives/select-multi";
import { SelectSingle } from "../primitives/select-single";
import type { SelectFieldProps } from "./field-types";
import { useResolvedControl } from "./field-utils";
import { FieldWrapper } from "./field-wrapper";

export function SelectField<TValue extends string = string>({
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
	options,
	loadOptions,
	multiple,
	clearable,
	maxSelections,
	emptyMessage,
}: SelectFieldProps<TValue>) {
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
					{multiple ? (
						<SelectMulti<TValue>
							id={name}
							value={
								Array.isArray(field.value)
									? field.value
									: field.value != null
										? [field.value]
										: []
							}
							onChange={field.onChange}
							options={options}
							loadOptions={loadOptions}
							maxSelections={maxSelections}
							emptyMessage={emptyMessage}
							placeholder={placeholder}
							disabled={disabled}
							aria-invalid={!!fieldState.error}
							className={cn("qa-select-field", className)}
						/>
					) : (
						<SelectSingle<TValue>
							id={name}
							value={field.value ?? null}
							onChange={field.onChange}
							options={options}
							loadOptions={loadOptions}
							clearable={clearable}
							emptyMessage={emptyMessage}
							placeholder={placeholder}
							disabled={disabled}
							aria-invalid={!!fieldState.error}
							className={cn("qa-select-field", className)}
						/>
					)}
				</FieldWrapper>
			)}
		/>
	);
}
