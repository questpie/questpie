import * as React from "react";

import { cn } from "../../lib/utils";

export const adminViewTitleClassName =
	"qa-admin-view-header__title text-foreground min-w-0 truncate text-lg font-semibold tracking-tight text-balance md:text-xl";

export const adminViewDescriptionClassName =
	"text-muted-foreground mt-1 line-clamp-2 text-sm";

export const adminViewMetaClassName =
	"text-muted-foreground mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs tabular-nums";

export interface AdminViewLayoutProps {
	header?: React.ReactNode;
	children: React.ReactNode;
	className?: string;
	contentClassName?: string;
}

export function AdminViewLayout({
	header,
	children,
	className,
	contentClassName,
}: AdminViewLayoutProps): React.ReactElement {
	return (
		<div
			className={cn(
				"qa-admin-view-layout flex h-full min-h-0 flex-col overflow-hidden",
				className,
			)}
		>
			{header && <div className="shrink-0">{header}</div>}
			<div
				className={cn(
					"qa-admin-view-layout__content min-h-0 min-w-0 flex-1 overflow-hidden",
					contentClassName,
				)}
			>
				{children}
			</div>
		</div>
	);
}

export interface AdminViewHeaderProps {
	title: React.ReactNode;
	titleAccessory?: React.ReactNode;
	description?: React.ReactNode;
	meta?: React.ReactNode;
	actions?: React.ReactNode;
	className?: string;
	titleClassName?: string;
}

export function AdminViewHeader({
	title,
	titleAccessory,
	description,
	meta,
	actions,
	className,
	titleClassName,
}: AdminViewHeaderProps): React.ReactElement {
	return (
		<header className={cn("qa-admin-view-header px-0 pt-0 pb-2", className)}>
			<div className="flex min-w-0 flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
				<div className="flex min-w-0 flex-1 items-start gap-3">
					<div className="min-w-0 flex-1">
						<div className="flex min-w-0 flex-wrap items-center gap-2.5">
							<h1 className={cn(adminViewTitleClassName, titleClassName)}>
								{title}
							</h1>
							{titleAccessory}
						</div>

						{meta && (
							<div
								className={cn(
									"qa-admin-view-header__meta",
									adminViewMetaClassName,
								)}
							>
								{meta}
							</div>
						)}

						{description && (
							<div
								className={cn(
									"qa-admin-view-header__description",
									adminViewDescriptionClassName,
								)}
							>
								{description}
							</div>
						)}
					</div>
				</div>

				{actions && (
					<div className="qa-admin-view-header__actions flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
						{actions}
					</div>
				)}
			</div>
		</header>
	);
}
