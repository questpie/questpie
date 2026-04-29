"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Icon } from "@iconify/react";
import type * as React from "react";

import { cn } from "../../lib/utils";
import { Button } from "./button";

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
	return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
	return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
	return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
	return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
	className,
	...props
}: DialogPrimitive.Backdrop.Props) {
	return (
		<DialogPrimitive.Backdrop
			data-slot="dialog-overlay"
			className={cn(
				"qa-dialog__overlay motion-overlay fixed inset-0 isolate z-50 bg-black/70 backdrop-blur-[2px] data-ending-style:opacity-0 data-starting-style:opacity-0",
				className,
			)}
			{...props}
		/>
	);
}

function DialogContent({
	className,
	children,
	showCloseButton = true,
	...props
}: DialogPrimitive.Popup.Props & {
	showCloseButton?: boolean;
}) {
	return (
		<DialogPortal>
			<DialogOverlay />
			<DialogPrimitive.Popup
				data-slot="dialog-content"
				className={cn(
					"qa-dialog__content floating-surface motion-floating text-popover-foreground fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] origin-center -translate-x-1/2 -translate-y-1/2 gap-4 p-5 text-sm outline-none data-ending-style:scale-[var(--motion-scale-enter)] data-ending-style:opacity-0 data-starting-style:scale-[var(--motion-scale-enter)] data-starting-style:opacity-0 sm:max-w-md",
					className,
				)}
				{...props}
			>
				{children}
				{showCloseButton && (
					<DialogPrimitive.Close
						data-slot="dialog-close"
						nativeButton={false}
						render={
							<Button
								variant="ghost"
								className="absolute top-2 right-2"
								size="icon-sm"
							/>
						}
					>
						<Icon icon="ph:x" />
						<span className="sr-only">Close</span>
					</DialogPrimitive.Close>
				)}
			</DialogPrimitive.Popup>
		</DialogPortal>
	);
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="dialog-header"
			className={cn("qa-dialog__header flex flex-col gap-1", className)}
			{...props}
		/>
	);
}

function DialogFooter({
	className,
	showCloseButton = false,
	children,
	...props
}: React.ComponentProps<"div"> & {
	showCloseButton?: boolean;
}) {
	return (
		<div
			data-slot="dialog-footer"
			className={cn(
				"qa-dialog__footer flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
				className,
			)}
			{...props}
		>
			{children}
			{showCloseButton && (
				<DialogPrimitive.Close
					nativeButton={false}
					render={<Button variant="outline" />}
				>
					Close
				</DialogPrimitive.Close>
			)}
		</div>
	);
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
	return (
		<DialogPrimitive.Title
			data-slot="dialog-title"
			className={cn(
				"qa-dialog__title font-chrome text-sm font-medium",
				className,
			)}
			{...props}
		/>
	);
}

function DialogDescription({
	className,
	...props
}: DialogPrimitive.Description.Props) {
	return (
		<DialogPrimitive.Description
			data-slot="dialog-description"
			className={cn(
				"qa-dialog__description text-muted-foreground *:[a]:hover:text-foreground text-xs/relaxed *:[a]:underline *:[a]:underline-offset-3",
				className,
			)}
			{...props}
		/>
	);
}

export {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
};
