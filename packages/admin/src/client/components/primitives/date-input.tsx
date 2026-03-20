"use client";

import { Icon } from "@iconify/react";
import { format } from "date-fns";
import { useState } from "react";
import { DayPicker } from "react-day-picker";

import { useResolveText } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import type {
	DateInputProps,
	DateRangeInputProps,
	DateTimeInputProps,
} from "./types";

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
					"qa-date-input border-border bg-input flex h-9 w-full items-center justify-start gap-2 border px-3 py-2 text-sm",
					"hover:bg-accent hover:text-accent-foreground",
					"focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
					"disabled:cursor-not-allowed disabled:opacity-50",
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
			<PopoverContent className="w-auto p-0" align="start">
				<DayPicker
					mode="single"
					selected={value ?? undefined}
					onSelect={handleSelect}
					disabled={(date) => {
						if (minDate && date < minDate) return true;
						if (maxDate && date > maxDate) return true;
						return false;
					}}
					className="p-3"
					classNames={{
						months: "flex flex-col sm:flex-row gap-2",
						month: "flex flex-col gap-4",
						month_caption: "flex justify-center pt-1 relative items-center h-9",
						caption_label: "text-sm font-medium",
						nav: "absolute inset-x-0 top-0 flex items-center justify-between px-1",
						button_previous: cn(
							"flex size-8 items-center justify-center rounded-md",
							"hover:bg-accent bg-transparent p-0 opacity-50 hover:opacity-100",
						),
						button_next: cn(
							"flex size-8 items-center justify-center rounded-md",
							"hover:bg-accent bg-transparent p-0 opacity-50 hover:opacity-100",
						),
						month_grid: "w-full border-collapse",
						weekdays: "flex",
						weekday:
							"text-muted-foreground w-9 font-normal text-[0.8rem] text-center",
						week: "flex w-full mt-2",
						day: "relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-accent [&:has([aria-selected].day-outside)]:bg-accent",
						day_button: cn(
							"size-9 rounded-md p-0 font-normal",
							"hover:bg-accent hover:text-accent-foreground",
							"focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2",
						),
						selected:
							"bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground rounded-md",
						today: "bg-accent text-accent-foreground",
						outside: "text-muted-foreground opacity-50",
						disabled: "text-muted-foreground opacity-50",
						hidden: "invisible",
					}}
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
					"qa-datetime-input border-border bg-input flex h-9 w-full items-center justify-start gap-2 border px-3 py-2 text-sm",
					"hover:bg-accent hover:text-accent-foreground",
					"focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
					"disabled:cursor-not-allowed disabled:opacity-50",
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
			<PopoverContent className="w-auto p-0" align="start">
				<DayPicker
					mode="single"
					selected={value ?? undefined}
					onSelect={handleDateSelect}
					disabled={(date) => {
						if (minDate && date < minDate) return true;
						if (maxDate && date > maxDate) return true;
						return false;
					}}
					className="p-3"
					classNames={{
						months: "flex flex-col sm:flex-row gap-2",
						month: "flex flex-col gap-4",
						month_caption: "flex justify-center pt-1 relative items-center h-9",
						caption_label: "text-sm font-medium",
						nav: "absolute inset-x-0 top-0 flex items-center justify-between px-1",
						button_previous: cn(
							"flex size-8 items-center justify-center rounded-md",
							"hover:bg-accent bg-transparent p-0 opacity-50 hover:opacity-100",
						),
						button_next: cn(
							"flex size-8 items-center justify-center rounded-md",
							"hover:bg-accent bg-transparent p-0 opacity-50 hover:opacity-100",
						),
						month_grid: "w-full border-collapse",
						weekdays: "flex",
						weekday:
							"text-muted-foreground w-9 font-normal text-[0.8rem] text-center",
						week: "flex w-full mt-2",
						day: "relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-accent [&:has([aria-selected].day-outside)]:bg-accent",
						day_button: cn(
							"size-9 rounded-md p-0 font-normal",
							"hover:bg-accent hover:text-accent-foreground",
							"focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2",
						),
						selected:
							"bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground rounded-md",
						today: "bg-accent text-accent-foreground",
						outside: "text-muted-foreground opacity-50",
						disabled: "text-muted-foreground opacity-50",
						hidden: "invisible",
					}}
				/>
				<div className="border-border border-t p-3">
					<input
						type="time"
						step={precision === "second" ? 1 : 60}
						value={timeValue}
						onChange={handleTimeChange}
						className={cn(
							"border-border bg-input flex h-9 w-full border px-3 py-2 text-sm",
							"focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
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
					"qa-date-range-input border-border bg-input flex h-9 w-full items-center justify-start gap-2 border px-3 py-2 text-sm",
					"hover:bg-accent hover:text-accent-foreground",
					"focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
					"disabled:cursor-not-allowed disabled:opacity-50",
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
			<PopoverContent className="w-auto p-0" align="start">
				<DayPicker
					mode="range"
					selected={
						value.start || value.end
							? { from: value.start ?? undefined, to: value.end ?? undefined }
							: undefined
					}
					onSelect={handleSelect}
					numberOfMonths={2}
					disabled={(date) => {
						if (minDate && date < minDate) return true;
						if (maxDate && date > maxDate) return true;
						return false;
					}}
					className="p-3"
					classNames={{
						months: "flex flex-col sm:flex-row gap-4",
						month: "flex flex-col gap-4",
						month_caption: "flex justify-center pt-1 relative items-center h-9",
						caption_label: "text-sm font-medium",
						nav: "absolute inset-x-0 top-0 flex items-center justify-between px-1",
						button_previous: cn(
							"flex size-8 items-center justify-center rounded-md",
							"hover:bg-accent bg-transparent p-0 opacity-50 hover:opacity-100",
						),
						button_next: cn(
							"flex size-8 items-center justify-center rounded-md",
							"hover:bg-accent bg-transparent p-0 opacity-50 hover:opacity-100",
						),
						month_grid: "w-full border-collapse",
						weekdays: "flex",
						weekday:
							"text-muted-foreground w-9 font-normal text-[0.8rem] text-center",
						week: "flex w-full mt-2",
						day: "relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-accent [&:has([aria-selected].day-outside)]:bg-accent",
						day_button: cn(
							"size-9 rounded-md p-0 font-normal",
							"hover:bg-accent hover:text-accent-foreground",
							"focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2",
						),
						selected:
							"bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground rounded-md",
						range_start: "rounded-l-md",
						range_end: "rounded-r-md",
						range_middle: "bg-accent",
						today: "bg-accent text-accent-foreground",
						outside: "text-muted-foreground opacity-50",
						disabled: "text-muted-foreground opacity-50",
						hidden: "invisible",
					}}
				/>
			</PopoverContent>
		</Popover>
	);
}
