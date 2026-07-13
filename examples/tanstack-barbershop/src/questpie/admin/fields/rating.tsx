/**
 * Star-rating admin UI for the app-land `f.rating()` field type
 * (../../server/fields/rating.ts). Discovered from `admin/fields/` and
 * matched to the server field by the shared `"rating"` name.
 */

import { Icon } from "@iconify/react";
import { Controller } from "react-hook-form";

import {
	field,
	FieldWrapper,
	useResolvedControl,
} from "@questpie/admin/client";

const RATING_VALUES = ["1", "2", "3", "4", "5"] as const;

type RatingFieldProps = {
	name: string;
	label?: string;
	description?: string;
	required?: boolean;
	disabled?: boolean;
	readOnly?: boolean;
	localized?: boolean;
	locale?: string;
	hideLabel?: boolean;
	control?: never;
};

function StarRatingField({
	name,
	label,
	description,
	required,
	disabled,
	readOnly,
	localized,
	locale,
	hideLabel,
	control,
}: RatingFieldProps) {
	const resolvedControl = useResolvedControl(control);
	const interactive = !disabled && !readOnly;

	return (
		<Controller
			name={name}
			control={resolvedControl}
			render={({ field: rhfField, fieldState }) => {
				const current = Number(rhfField.value) || 0;
				return (
					<FieldWrapper
						name={name}
						label={label}
						description={description}
						required={required}
						disabled={disabled}
						readOnly={readOnly}
						localized={localized}
						locale={locale}
						hideLabel={hideLabel}
						error={fieldState.error?.message}
					>
						<div
							role="radiogroup"
							aria-label={label ?? name}
							className="flex items-center gap-1"
						>
							{RATING_VALUES.map((value) => {
								const starNumber = Number(value);
								const isFilled = starNumber <= current;
								return (
									<button
										key={value}
										type="button"
										role="radio"
										aria-checked={rhfField.value === value}
										aria-label={`${value}/5`}
										disabled={!interactive}
										onClick={() => rhfField.onChange(value)}
										className="text-warning focus-visible:ring-ring/40 rounded-xs p-0.5 transition-transform focus-visible:ring-2 focus-visible:outline-none enabled:hover:scale-110 disabled:cursor-default"
									>
										<Icon
											icon={isFilled ? "ph:star-fill" : "ph:star"}
											className="size-5"
										/>
									</button>
								);
							})}
						</div>
					</FieldWrapper>
				);
			}}
		/>
	);
}

function StarRatingCell({ value }: { value: unknown }) {
	const current = Number(value) || 0;
	if (current <= 0) {
		return <span className="text-muted-foreground">–</span>;
	}
	return (
		<span
			className="text-warning inline-flex items-center gap-0.5"
			aria-label={`${current}/5`}
		>
			{RATING_VALUES.map((v) => (
				<Icon
					key={v}
					icon={Number(v) <= current ? "ph:star-fill" : "ph:star"}
					className="size-3.5"
				/>
			))}
		</span>
	);
}

export default field("rating", {
	component: StarRatingField,
	cell: StarRatingCell,
});
