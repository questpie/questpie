"use client";

import { Icon } from "@iconify/react";
import type * as React from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

export interface AdminToasterProps extends ToasterProps {
	/**
	 * Theme can be provided by parent app's theme context
	 * Falls back to "system" if not provided
	 */
	theme?: "light" | "dark" | "system";
}

// Custom icons using Phosphor iconify icons
const toastIcons = {
	success: <Icon icon="ph:check-circle-fill" className="size-5" />,
	info: <Icon icon="ph:info-fill" className="size-5" />,
	warning: <Icon icon="ph:warning-fill" className="size-5" />,
	error: <Icon icon="ph:x-circle-fill" className="size-5" />,
	loading: <Icon icon="ph:spinner" className="size-5 animate-spin" />,
};

const Toaster = ({ theme = "system", ...props }: AdminToasterProps) => {
	return (
		<Sonner
			theme={theme}
			className="qa-toaster toaster group"
			icons={toastIcons}
			style={
				{
					"--normal-bg": "var(--popover)",
					"--normal-text": "var(--popover-foreground)",
					"--normal-border": "var(--border)",
					"--border-radius": "var(--radius)",
				} as React.CSSProperties
			}
			toastOptions={{
				classNames: {
					toast: "!!border !gap-3",
					description: "!text-muted-foreground",
					success: "!bg-success/10 !text-success !border-success/20",
					error: "!bg-destructive/10 !text-destructive !border-destructive/20",
					warning: "!bg-warning/10 !text-warning !border-warning/20",
					info: "!bg-info/10 !text-info !border-info/20",
				},
			}}
			{...props}
		/>
	);
};

export { Toaster };
