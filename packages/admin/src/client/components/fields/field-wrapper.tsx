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
	labelAccessory?: React.ReactNode;
	required?: boolean;
	disabled?: boolean;
	readOnly?: boolean;
	error?: string;
	localized?: boolean;
	locale?: string;
	/** Suppress the label + description (label is supplied by the surrounding layout). */
	hideLabel?: boolean;
	children: React.ReactNode;
	/** Field path for preview click-to-focus */
	fieldPath?: string;
};

type FieldLocaleIndicatorProps = {
	localized?: boolean;
	locale?: string;
};

type FieldLocaleOption = {
	code: string;
	label?: I18nText;
	flagCountryCode?: string;
};

function getLocaleOptions(
	contentLocales: { locales?: FieldLocaleOption[] } | null | undefined,
	resolvedLocale: string | undefined,
): FieldLocaleOption[] {
	if (contentLocales?.locales?.length) {
		return contentLocales.locales;
	}

	if (resolvedLocale) {
		return [{ code: resolvedLocale }];
	}

	return [];
}

export function FieldCountAccessory({
	count,
	max,
}: {
	count: number;
	max?: number;
}): React.ReactElement | null {
	if (!max) return null;

	return (
		<span className="text-muted-foreground text-xs tabular-nums">
			({count}/{max})
		</span>
	);
}

export function FieldLocaleIndicator({
	localized,
	locale,
}: FieldLocaleIndicatorProps): React.ReactElement | null {
	const { locale: scopedLocale } = useScopedLocale();
	const contentLocales = useSafeContentLocales();
	const resolvedLocale = locale ?? scopedLocale;
	const localeOptions = getLocaleOptions(contentLocales, resolvedLocale);

	if (!localized) return null;

	return (
		<LocaleSwitcher
			locales={localeOptions}
			value={resolvedLocale}
			showFlag={false}
		/>
	);
}

export function FieldWrapper({
	name,
	label,
	description,
	labelAccessory,
	required,
	disabled,
	readOnly,
	error,
	localized,
	locale,
	hideLabel,
	children,
	fieldPath,
}: FieldWrapperProps): React.ReactElement {
	const resolveText = useResolveText();

	const resolvedLabel = hideLabel || !label ? undefined : resolveText(label);
	const resolvedDescription =
		hideLabel || !description ? undefined : resolveText(description);

	return (
		<Field
			data-disabled={disabled}
			data-readonly={!disabled && readOnly}
			data-invalid={!!error}
			data-field-path={fieldPath ?? name}
		>
			<div className="qa-field-wrapper space-y-2">
				{resolvedLabel && (
					<FieldLabel htmlFor={name} className="flex items-center gap-2">
						<span className="flex items-center gap-1">
							{resolvedLabel}
							{required && <span className="text-destructive">*</span>}
						</span>
						{labelAccessory}
						<FieldLocaleIndicator localized={localized} locale={locale} />
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
