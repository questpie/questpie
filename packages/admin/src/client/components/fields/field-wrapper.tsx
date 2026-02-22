import type * as React from "react";
import { useResolveText } from "../../i18n/hooks";
import type { I18nText } from "../../i18n/types";
import { useSafeContentLocales, useScopedLocale } from "../../runtime";
import { LocaleSwitcher } from "../locale-switcher";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "../ui/field";

type FieldWrapperProps = {
	name: string;
	label?: I18nText;
	description?: I18nText;
	required?: boolean;
	disabled?: boolean;
	error?: string;
	localized?: boolean;
	locale?: string;
	children: React.ReactNode;
	/** Field path for preview click-to-focus */
	fieldPath?: string;
};

export function FieldWrapper({
	name,
	label,
	description,
	required,
	disabled,
	error,
	localized,
	locale,
	children,
	fieldPath,
}: FieldWrapperProps) {
	const resolveText = useResolveText();
	const { locale: scopedLocale } = useScopedLocale();
	const contentLocales = useSafeContentLocales();
	const resolvedLocale = locale ?? scopedLocale;
	const localeOptions = contentLocales?.locales?.length
		? contentLocales.locales
		: resolvedLocale
			? [{ code: resolvedLocale }]
			: [];

	const resolvedLabel = label ? resolveText(label) : undefined;
	const resolvedDescription = description
		? resolveText(description)
		: undefined;

	return (
		<Field
			data-disabled={disabled}
			data-invalid={!!error}
			data-field-path={fieldPath ?? name}
		>
			<div className="space-y-2">
				{resolvedLabel && (
					<FieldLabel htmlFor={name} className="flex items-center gap-2">
						<span className="flex items-center gap-1">
							{resolvedLabel}
							{required && <span className="text-destructive">*</span>}
						</span>
						{localized && (
							<LocaleSwitcher
								locales={localeOptions}
								value={resolvedLocale}
								showFlag={false}
							/>
						)}
					</FieldLabel>
				)}
				<FieldContent>{children}</FieldContent>
				{resolvedDescription && (
					<FieldDescription>{resolvedDescription}</FieldDescription>
				)}
				{error && <FieldError errors={[{ message: error }]} />}
			</div>
		</Field>
	);
}
