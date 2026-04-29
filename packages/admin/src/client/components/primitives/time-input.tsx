"use client";

import { Icon } from "@iconify/react";

import { useResolveText } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import type { TimeInputProps } from "./types";

/**
 * Time Input Primitive
 *
 * A time-only input using the native HTML time picker.
 * Returns time as string in "HH:mm" or "HH:mm:ss" format.
 *
 * @example
 * ```tsx
 * <TimeInput
 *   value={selectedTime}
 *   onChange={setSelectedTime}
 *   placeholder="Select time"
 * />
 * ```
 */
export function TimeInput({
	value,
	onChange,
	precision = "minute",
	placeholder = "Select time",
	disabled,
	className,
	id,
	"aria-invalid": ariaInvalid,
}: TimeInputProps) {
	const resolveText = useResolveText();

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const timeValue = e.target.value;
		onChange(timeValue || null);
	};

	const handleClear = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		onChange(null);
	};

	return (
		<div className="qa-time-input relative">
			<div
				className={cn(
					"control-surface font-chrome flex w-full items-center gap-2 px-3 py-2 text-sm",
					"focus-within:border-border-strong focus-within:ring-ring/20 focus-within:ring-3",
					disabled && "cursor-not-allowed opacity-50",
					ariaInvalid && "border-border-strong",
					className,
				)}
			>
				<Icon icon="ph:clock" className="text-muted-foreground size-4" />
				<input
					type="time"
					id={id}
					value={value ?? ""}
					onChange={handleChange}
					step={precision === "second" ? 1 : 60}
					disabled={disabled}
					aria-invalid={ariaInvalid}
					placeholder={resolveText(placeholder)}
					className={cn(
						"flex-1 bg-transparent outline-none",
						"placeholder:text-muted-foreground",
						"disabled:cursor-not-allowed",
						// Hide the native clock icon in some browsers
						"[&::-webkit-calendar-picker-indicator]:hidden",
					)}
				/>
				{value && !disabled && (
					<button
						type="button"
						onClick={handleClear}
						className="text-muted-foreground hover:text-foreground"
						tabIndex={-1}
					>
						<Icon icon="ph:x" className="size-4" />
					</button>
				)}
			</div>
		</div>
	);
}
