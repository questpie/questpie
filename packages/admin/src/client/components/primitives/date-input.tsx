"use client";

import { Icon } from "@iconify/react";
import { format } from "date-fns";
import { useState } from "react";
import { DayPicker } from "react-day-picker";

import { useDateFnsLocale, useResolveText } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import type {
	DateInputProps,
	DateRangeInputProps,
	DateTimeInputProps,
} from "./types";

const datePickerClassNames = {
	months: "flex flex-col sm:flex-row gap-2",
	month: "flex flex-col gap-3",
	month_caption: "relative flex h-9 items-center justify-center px-9",
	caption_label: "text-foreground text-sm font-medium",
	nav: "absolute inset-x-0 top-0 flex items-center justify-between px-1",
	button_previous: cn(
		"text-muted-foreground flex size-8 items-center justify-center rounded-md bg-transparent p-0 transition-[background-color,color,opacity] duration-150 ease-out",
		"hover:bg-surface-high hover:text-foreground",
	),
	button_next: cn(
		"text-muted-foreground flex size-8 items-center justify-center rounded-md bg-transparent p-0 transition-[background-color,color,opacity] duration-150 ease-out",
		"hover:bg-surface-high hover:text-foreground",
	),
	month_grid: "w-full border-separate border-spacing-y-1",
	weekdays: "flex",
	weekday:
		"text-muted-foreground flex size-9 items-center justify-center text-[0.7rem] font-medium",
	week: "flex w-full",
	day: "relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-transparent [&:has([aria-selected].day-outside)]:bg-transparent",
	day_button: cn(
		"size-9 rounded-[var(--control-radius-inner)] p-0 text-sm font-normal transition-[background-color,color,box-shadow,transform] duration-150 ease-out",
		"hover:bg-surface-high hover:text-foreground active:scale-[0.96]",
		"focus-visible:ring-ring/20 focus-visible:ring-3 focus-visible:outline-none",
	),
	selected:
		"bg-foreground text-background shadow-[var(--control-shadow)] hover:bg-foreground hover:text-background focus:bg-foreground focus:text-background",
	today:
		"bg-surface-mid text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)]",
	outside: "text-muted-foreground opacity-45",
	disabled: "text-muted-foreground opacity-30",
	hidden: "invisible",
};

const dateTriggerClassName = cn(
	"control-surface font-chrome flex w-full items-center justify-start gap-2 px-3 py-2 text-sm",
	"hover:bg-surface-low hover:text-foreground",
	"focus-visible:border-border-strong focus-visible:ring-ring/20 aria-expanded:border-border-strong aria-expanded:ring-ring/20 focus-visible:ring-3 focus-visible:outline-none aria-expanded:ring-3",
	"disabled:cursor-not-allowed disabled:opacity-50",
);

const openTriggerClassName = "border-border-strong ring-ring/20 ring-3";

const datePopoverClassName = "floating-surface w-auto p-1";

/**
 * Date Input Primitive
 *
 * A date picker with popover calendar.
 * Uses react-day-picker under the hood.
 *
 * @example
 * ```tsx
 * <DateInput
 *   value={selectedDate}
 *   onChange={setSelectedDate}
 *   placeholder="Select date"
 * />
 * ```
 */
export function DateInput({
	value,
	onChange,
	minDate,
	maxDate,
	format: dateFormat = "PP",
	placeholder = "Select date",
	disabled,
	className,
	id,
	"aria-invalid": ariaInvalid,
}: DateInputProps) {
	const resolveText = useResolveText();
	const dateFnsLocale = useDateFnsLocale();
	const [open, setOpen] = useState(false);

	const handleSelect = (date: Date | undefined) => {
		onChange(date ?? null);
		setOpen(false);
	};

	const handleClear = (e: React.MouseEvent) => {
		e.stopPropagation();
		onChange(null);
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				id={id}
				disabled={disabled}
				aria-invalid={ariaInvalid}
				className={cn(
					"qa-date-input",
					dateTriggerClassName,
					open && openTriggerClassName,
					!value && "text-muted-foreground",
					className,
				)}
			>
				<Icon icon="ph:calendar-blank" className="size-4" />
				<span className="flex-1 text-left">
					{value ? format(value, dateFormat) : resolveText(placeholder)}
				</span>
				{value && !disabled && (
					<Icon
						icon="ph:x"
						className="size-4 opacity-50 hover:opacity-100"
						onClick={handleClear}
					/>
				)}
			</PopoverTrigger>
			<PopoverContent className={datePopoverClassName} align="start">
				<DayPicker
					mode="single"
					selected={value ?? undefined}
					onSelect={handleSelect}
					locale={dateFnsLocale}
					disabled={(date) => {
						if (minDate && date < minDate) return true;
						if (maxDate && date > maxDate) return true;
						return false;
					}}
					className="qa-date-picker font-chrome p-2"
					classNames={datePickerClassNames}
				/>
			</PopoverContent>
		</Popover>
	);
}

/**
 * DateTime Input Primitive
 *
 * A date and time picker.
 *
 * @example
 * ```tsx
 * <DateTimeInput
 *   value={scheduledAt}
 *   onChange={setScheduledAt}
 *   precision="minute"
 * />
 * ```
 */
export function DateTimeInput({
	value,
	onChange,
	minDate,
	maxDate,
	format: dateFormat = "PPp",
	precision = "minute",
	placeholder = "Select date and time",
	disabled,
	className,
	id,
	"aria-invalid": ariaInvalid,
}: DateTimeInputProps) {
	const resolveText = useResolveText();
	const dateFnsLocale = useDateFnsLocale();
	const [open, setOpen] = useState(false);
	const [timeValue, setTimeValue] = useState(() => {
		if (!value) return "";
		return precision === "second"
			? format(value, "HH:mm:ss")
			: format(value, "HH:mm");
	});

	const handleDateSelect = (date: Date | undefined) => {
		if (!date) {
			onChange(null);
			return;
		}

		// Preserve existing time if available
		if (timeValue) {
			const [hours, minutes, seconds] = timeValue.split(":").map(Number);
			date.setHours(hours || 0, minutes || 0, seconds || 0);
		}
		onChange(date);
	};

	const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const time = e.target.value;
		setTimeValue(time);

		if (value && time) {
			const [hours, minutes, seconds] = time.split(":").map(Number);
			const newDate = new Date(value);
			newDate.setHours(hours || 0, minutes || 0, seconds || 0);
			onChange(newDate);
		}
	};

	const handleClear = (e: React.MouseEvent) => {
		e.stopPropagation();
		onChange(null);
		setTimeValue("");
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				id={id}
				disabled={disabled}
				aria-invalid={ariaInvalid}
				className={cn(
					"qa-datetime-input",
					dateTriggerClassName,
					open && openTriggerClassName,
					!value && "text-muted-foreground",
					className,
				)}
			>
				<Icon icon="ph:calendar-blank" className="size-4" />
				<span className="flex-1 text-left">
					{value ? format(value, dateFormat) : resolveText(placeholder)}
				</span>
				{value && !disabled && (
					<Icon
						icon="ph:x"
						className="size-4 opacity-50 hover:opacity-100"
						onClick={handleClear}
					/>
				)}
			</PopoverTrigger>
			<PopoverContent className={datePopoverClassName} align="start">
				<DayPicker
					mode="single"
					selected={value ?? undefined}
					onSelect={handleDateSelect}
					locale={dateFnsLocale}
					disabled={(date) => {
						if (minDate && date < minDate) return true;
						if (maxDate && date > maxDate) return true;
						return false;
					}}
					className="qa-date-picker font-chrome p-2"
					classNames={datePickerClassNames}
				/>
				<div className="border-border-subtle bg-surface-low/60 border-t p-3">
					<input
						type="time"
						step={precision === "second" ? 1 : 60}
						value={timeValue}
						onChange={handleTimeChange}
						className={cn(
							"qa-time-input control-surface flex w-full px-3 py-2 text-sm",
							"focus-visible:border-border-strong focus-visible:ring-ring/20 focus-visible:ring-3 focus-visible:outline-none",
						)}
					/>
				</div>
			</PopoverContent>
		</Popover>
	);
}

/**
 * Date Range Input Primitive
 *
 * A date range picker for selecting start and end dates.
 *
 * @example
 * ```tsx
 * <DateRangeInput
 *   value={{ start: startDate, end: endDate }}
 *   onChange={setDateRange}
 * />
 * ```
 */
function DateRangeInput({
	value,
	onChange,
	minDate,
	maxDate,
	placeholder = "Select date range",
	disabled,
	className,
	id,
	"aria-invalid": ariaInvalid,
}: DateRangeInputProps) {
	const resolveText = useResolveText();
	const dateFnsLocale = useDateFnsLocale();
	const [open, setOpen] = useState(false);

	const handleSelect = (range: { from?: Date; to?: Date } | undefined) => {
		onChange({
			start: range?.from ?? null,
			end: range?.to ?? null,
		});
	};

	const handleClear = (e: React.MouseEvent) => {
		e.stopPropagation();
		onChange({ start: null, end: null });
	};

	const displayValue = () => {
		if (!value.start && !value.end) return resolveText(placeholder);
		if (value.start && value.end) {
			return `${format(value.start, "PP")} - ${format(value.end, "PP")}`;
		}
		if (value.start) return `${format(value.start, "PP")} - ...`;
		return resolveText(placeholder);
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				id={id}
				disabled={disabled}
				aria-invalid={ariaInvalid}
				className={cn(
					"qa-date-range-input",
					dateTriggerClassName,
					open && openTriggerClassName,
					!value.start && !value.end && "text-muted-foreground",
					className,
				)}
			>
				<Icon icon="ph:calendar-blank" className="size-4" />
				<span className="flex-1 text-left">{displayValue()}</span>
				{(value.start || value.end) && !disabled && (
					<Icon
						icon="ph:x"
						className="size-4 opacity-50 hover:opacity-100"
						onClick={handleClear}
					/>
				)}
			</PopoverTrigger>
			<PopoverContent className={datePopoverClassName} align="start">
				<DayPicker
					mode="range"
					selected={
						value.start || value.end
							? { from: value.start ?? undefined, to: value.end ?? undefined }
							: undefined
					}
					onSelect={handleSelect}
					locale={dateFnsLocale}
					numberOfMonths={2}
					disabled={(date) => {
						if (minDate && date < minDate) return true;
						if (maxDate && date > maxDate) return true;
						return false;
					}}
					className="qa-date-picker font-chrome p-2"
					classNames={{
						...datePickerClassNames,
						months: "flex flex-col sm:flex-row gap-3",
						day: "relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-surface-high/55 [&:has([aria-selected].day-outside)]:bg-surface-high/35",
						range_start: "rounded-l-md",
						range_end: "rounded-r-md",
						range_middle: "bg-surface-high/55 text-foreground",
					}}
				/>
			</PopoverContent>
		</Popover>
	);
}
