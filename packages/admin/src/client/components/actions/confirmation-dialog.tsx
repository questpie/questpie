/**
 * Confirmation Dialog
 *
 * Reusable confirmation dialog for destructive or important actions.
 * Uses base-ui dialog primitives with responsive design.
 */

"use client";

import { Icon } from "@iconify/react";
import * as React from "react";

import type { ConfirmationConfig } from "../../builder/types/action-types";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import { Button } from "../ui/button";
import {
	ResponsiveDialog,
	ResponsiveDialogContent,
	ResponsiveDialogDescription,
	ResponsiveDialogFooter,
	ResponsiveDialogHeader,
	ResponsiveDialogTitle,
} from "../ui/responsive-dialog";

interface ConfirmationDialogProps {
	/** Whether the dialog is open */
	open: boolean;
	/** Callback when dialog should close */
	onOpenChange: (open: boolean) => void;
	/** Confirmation configuration */
	config: ConfirmationConfig;
	/** Callback when user confirms */
	onConfirm: () => void | Promise<void>;
	/** Whether the action is currently loading */
	loading?: boolean;
}

/**
 * ConfirmationDialog - Prompts user to confirm an action
 *
 * @example
 * ```tsx
 * <ConfirmationDialog
 *   open={showConfirm}
 *   onOpenChange={setShowConfirm}
 *   config={{
 *     title: "Delete item?",
 *     description: "This action cannot be undone.",
 *     destructive: true,
 *   }}
 *   onConfirm={handleDelete}
 * />
 * ```
 */
export function ConfirmationDialog({
	open,
	onOpenChange,
	config,
	onConfirm,
	loading = false,
}: ConfirmationDialogProps): React.ReactElement {
	const { t } = useTranslation();
	const resolveText = useResolveText();
	const [isProcessing, setIsProcessing] = React.useState(false);

	const handleConfirm = async () => {
		setIsProcessing(true);
		try {
			await onConfirm();
			onOpenChange(false);
			setIsProcessing(false);
		} catch (_err) {
			setIsProcessing(false);
			throw _err;
		}
	};

	const isLoading = loading || isProcessing;

	return (
		<ResponsiveDialog open={open} onOpenChange={onOpenChange}>
			<ResponsiveDialogContent className="qa-confirmation-dialog sm:max-w-[425px]">
				<ResponsiveDialogHeader>
					<div className="flex items-start gap-3">
						{config.destructive && (
							<div className="border-border-subtle bg-surface-low text-foreground-subtle flex size-10 shrink-0 items-center justify-center rounded-full border">
								<Icon icon="ph:warning" className="size-5" />
							</div>
						)}
						<div className="min-w-0 space-y-1">
							<ResponsiveDialogTitle>
								{resolveText(config.title)}
							</ResponsiveDialogTitle>
							{config.description && (
								<ResponsiveDialogDescription>
									{resolveText(config.description)}
								</ResponsiveDialogDescription>
							)}
						</div>
					</div>
				</ResponsiveDialogHeader>
				<ResponsiveDialogFooter className="mt-4">
					<Button
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={isLoading}
						className="w-full md:w-auto"
					>
						{resolveText(config.cancelLabel) || t("common.cancel")}
					</Button>
					<Button
						variant={config.destructive ? "destructive" : "default"}
						onClick={handleConfirm}
						disabled={isLoading}
						className="w-full md:w-auto"
					>
						{isLoading
							? t("ui.processing")
							: resolveText(config.confirmLabel) || t("common.confirm")}
					</Button>
				</ResponsiveDialogFooter>
			</ResponsiveDialogContent>
		</ResponsiveDialog>
	);
}
