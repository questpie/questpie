/**
 * Color-swatch admin UI for the app-land `f.color()` field type
 * (../../server/fields/color.ts). Discovered from `admin/fields/` and matched
 * to the server field by the shared `"color"` name.
 *
 * Form UI: a row of preset swatches plus a native color input for anything
 * custom. Cell UI: a small color dot + the hex value.
 */

import { Icon } from "@iconify/react";
import { Controller } from "react-hook-form";

import { field, FieldWrapper, useResolvedControl } from "@questpie/admin/client";

/** A small, pleasant default palette; the native picker covers everything else. */
const PRESETS = [
	"#ef4444",
	"#f59e0b",
	"#10b981",
	"#3b82f6",
	"#8b5cf6",
	"#ec4899",
	"#64748b",
	"#111827",
] as const;

type ColorFieldProps = {
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

function ColorSwatchField({
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
}: ColorFieldProps) {
	const resolvedControl = useResolvedControl(control);
	const interactive = !disabled && !readOnly;

	return (
		<Controller
			name={name}
			control={resolvedControl}
			render={({ field: rhfField, fieldState }) => {
				const value = typeof rhfField.value === "string" ? rhfField.value : "";
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
						<div className="flex flex-wrap items-center gap-1.5">
							{PRESETS.map((preset) => {
								const isSelected =
									value.toLowerCase() === preset.toLowerCase();
								return (
									<button
										key={preset}
										type="button"
										aria-label={preset}
										aria-pressed={isSelected}
										disabled={!interactive}
										onClick={() => rhfField.onChange(preset)}
										style={{ backgroundColor: preset }}
										className="focus-visible:ring-ring/50 relative size-7 rounded-full ring-offset-2 ring-offset-[var(--background)] transition-transform focus-visible:ring-2 focus-visible:outline-none enabled:hover:scale-110 disabled:cursor-default"
									>
										{isSelected && (
											<Icon
												icon="ph:check-bold"
												className="absolute inset-0 m-auto size-3.5 text-white mix-blend-difference"
											/>
										)}
									</button>
								);
							})}

							{/* Native picker for any custom color, styled as a swatch. */}
							<label
								className="control-surface relative inline-flex size-7 cursor-pointer items-center justify-center rounded-full"
								style={value ? { backgroundColor: value } : undefined}
								title={value || "Custom"}
							>
								{!value && (
									<Icon
										icon="ph:eyedropper"
										className="text-muted-foreground size-3.5"
									/>
								)}
								<input
									type="color"
									value={value || "#000000"}
									disabled={!interactive}
									onChange={(e) => rhfField.onChange(e.target.value)}
									className="absolute inset-0 cursor-pointer opacity-0"
									aria-label={label ?? name}
								/>
							</label>

							{value && (
								<span className="text-muted-foreground font-chrome ml-1 text-xs tabular-nums uppercase">
									{value}
								</span>
							)}
						</div>
					</FieldWrapper>
				);
			}}
		/>
	);
}

function ColorSwatchCell({ value }: { value: unknown }) {
	if (typeof value !== "string" || !value) {
		return <span className="text-muted-foreground">–</span>;
	}
	return (
		<span className="inline-flex items-center gap-2">
			<span
				className="border-border size-3.5 shrink-0 rounded-full border"
				style={{ backgroundColor: value }}
			/>
			<span className="font-chrome text-xs tabular-nums uppercase">{value}</span>
		</span>
	);
}

export default field("color", {
	component: ColorSwatchField,
	cell: ColorSwatchCell,
});
