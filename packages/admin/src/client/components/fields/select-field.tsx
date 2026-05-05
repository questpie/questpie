import { useMemo } from "react";
import { Controller } from "react-hook-form";

import { cn } from "../../lib/utils";
import {
	isComponentReference,
	resolveIconElement,
} from "../component-renderer";
import { SelectMulti } from "../primitives/select-multi";
import { SelectSingle } from "../primitives/select-single";
import type { SelectOption as PrimitiveSelectOption } from "../primitives/types";
import type { SelectFieldProps } from "./field-types";
import { useResolvedControl } from "./field-utils";
import { FieldWrapper } from "./field-wrapper";

/**
 * Convert option icons from server-shaped ComponentReference to ReactNode,
 * so primitives receive renderable icon elements.
 *
 * Options authored on the client (e.g. with React elements as icons) pass
 * through unchanged.
 */
function resolveOptionIcons<TValue>(
	options: PrimitiveSelectOption<TValue>[] | undefined,
): PrimitiveSelectOption<TValue>[] | undefined {
	if (!options) return options;
	return options.map((option) =>
		isComponentReference(option.icon)
			? { ...option, icon: resolveIconElement(option.icon) }
			: option,
	);
}

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

	const resolvedOptions = useMemo(
		() => resolveOptionIcons(options),
		[options],
	);

	const resolvedLoadOptions = useMemo(() => {
		if (!loadOptions) return undefined;
		return async (search: string) => {
			const result = await loadOptions(search);
			return resolveOptionIcons(result) ?? [];
		};
	}, [loadOptions]);

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
							options={resolvedOptions}
							loadOptions={resolvedLoadOptions}
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
							options={resolvedOptions}
							loadOptions={resolvedLoadOptions}
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
