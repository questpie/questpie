import { Controller } from "react-hook-form";
import { TextInput } from "../primitives/text-input";
import type { TextFieldProps } from "./field-types";
import { useResolvedControl } from "./field-utils";
import { FieldWrapper } from "./field-wrapper";

export function TextField({
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
	type = "text",
	maxLength,
	autoComplete,
}: TextFieldProps) {
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
					<TextInput
						id={name}
						value={field.value ?? ""}
						onChange={field.onChange}
						type={type}
						placeholder={placeholder}
						disabled={disabled}
						maxLength={maxLength}
						autoComplete={autoComplete}
						aria-invalid={!!fieldState.error}
						className={className}
					/>
				</FieldWrapper>
			)}
		/>
	);
}
