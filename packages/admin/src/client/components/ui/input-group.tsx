"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../../lib/utils";
import { Button } from "./button";
import { Input } from "./input";
import { Textarea } from "./textarea";

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="input-group"
			role="group"
			className={cn(
				"qa-input-group control-surface font-chrome has-[[data-slot=input-group-control]:focus-visible]:border-border-strong has-[[data-slot=input-group-control]:focus-visible]:ring-ring/20 has-[[data-slot=input-group-control][aria-expanded=true]]:border-border-strong has-[[data-slot=input-group-control][aria-expanded=true]]:ring-ring/20 has-[[data-slot][aria-invalid=true]]:ring-ring/20 has-[[data-slot][aria-invalid=true]]:border-border-strong group/input-group hover:border-border-strong/70 relative flex w-full min-w-0 items-center overflow-hidden outline-none has-[[data-slot=input-group-control]:focus-visible]:ring-[3px] has-[[data-slot=input-group-control][aria-expanded=true]]:ring-[3px] has-[[data-slot][aria-invalid=true]]:ring-[3px] has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>textarea]:h-auto has-[>[data-align=block-end]]:[&>input]:pt-3 has-[>[data-align=block-start]]:[&>input]:pb-3 has-[>[data-align=inline-end]]:[&>input]:pr-1.5 has-[>[data-align=inline-start]]:[&>input]:pl-1.5 [[data-slot=combobox-content]_&]:focus-within:border-inherit [[data-slot=combobox-content]_&]:focus-within:ring-0",
				className,
			)}
			{...props}
		/>
	);
}

const inputGroupAddonVariants = cva(
	"qa-input-group__addon font-chrome text-muted-foreground **:data-[slot=kbd]:bg-muted-foreground/10 flex h-full cursor-text items-center justify-center gap-1 py-1 text-xs/relaxed font-medium select-none group-data-[disabled=true]/input-group:opacity-50 **:data-[slot=kbd]:px-1 **:data-[slot=kbd]:text-[0.625rem] [&>svg:not([class*='size-'])]:size-3.5",
	{
		variants: {
			align: {
				"inline-start":
					"order-first pl-2 has-[>button]:ml-[-0.275rem] has-[>kbd]:ml-[-0.275rem]",
				"inline-end":
					"order-last pr-2 has-[>button]:mr-[-0.275rem] has-[>kbd]:mr-[-0.275rem]",
				"block-start":
					"order-first w-full justify-start px-2 pt-2 group-has-[>input]/input-group:pt-2 [.border-b]:pb-2",
				"block-end":
					"order-last w-full justify-start px-2 pb-2 group-has-[>input]/input-group:pb-2 [.border-t]:pt-2",
			},
		},
		defaultVariants: {
			align: "inline-start",
		},
	},
);

function InputGroupAddon({
	className,
	align = "inline-start",
	...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>) {
	const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
		if ((e.target as HTMLElement).closest("button")) {
			return;
		}
		e.currentTarget.parentElement?.querySelector("input")?.focus();
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			e.currentTarget.parentElement?.querySelector("input")?.focus();
		}
	};

	return (
		<div
			role="button"
			tabIndex={0}
			data-slot="input-group-addon"
			data-align={align}
			className={cn(inputGroupAddonVariants({ align }), className)}
			onClick={handleClick}
			onKeyDown={handleKeyDown}
			{...props}
		/>
	);
}

const inputGroupButtonVariants = cva(
	"qa-input-group__button flex items-center gap-2 rounded-[var(--control-radius-inner)] text-xs/relaxed shadow-none",
	{
		variants: {
			size: {
				xs: "h-5 gap-1 px-1 [&>svg:not([class*='size-'])]:size-3",
				sm: "",
				"icon-xs": "size-6 p-0 has-[>svg]:p-0",
				"icon-sm": "size-8 p-0 has-[>svg]:p-0",
			},
		},
		defaultVariants: {
			size: "xs",
		},
	},
);

function InputGroupButton({
	className,
	type = "button",
	variant = "ghost",
	size = "xs",
	...props
}: Omit<React.ComponentProps<typeof Button>, "size" | "type"> &
	VariantProps<typeof inputGroupButtonVariants> & {
		type?: "button" | "submit" | "reset";
	}) {
	return (
		<Button
			type={type}
			data-size={size}
			variant={variant}
			className={cn(inputGroupButtonVariants({ size }), className)}
			{...props}
		/>
	);
}

function InputGroupText({ className, ...props }: React.ComponentProps<"span">) {
	return (
		<span
			className={cn(
				"qa-input-group__text font-chrome text-muted-foreground flex items-center gap-2 text-xs/relaxed [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		/>
	);
}

function InputGroupInput({
	className,
	...props
}: React.ComponentProps<"input">) {
	return (
		<Input
			data-slot="input-group-control"
			className={cn(
				"qa-input-group__input flex-1 rounded-none border-0 bg-transparent shadow-none ring-0 focus-visible:ring-0 aria-invalid:ring-0",
				className,
			)}
			{...props}
		/>
	);
}

function InputGroupTextarea({
	className,
	...props
}: React.ComponentProps<"textarea">) {
	return (
		<Textarea
			data-slot="input-group-control"
			className={cn(
				"qa-input-group__textarea flex-1 resize-none rounded-none border-0 bg-transparent py-2 shadow-none ring-0 focus-visible:ring-0 aria-invalid:ring-0 dark:bg-transparent",
				className,
			)}
			{...props}
		/>
	);
}

export { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput };
