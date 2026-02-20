/**
 * Confirmation Dialog
 *
 * Reusable confirmation dialog for destructive or important actions.
 * Uses base-ui dialog primitives with responsive design.
 */

"use client";

import { Icon } from "@iconify/react";
import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import type { ConfirmationConfig } from "../../builder/types/action-types";

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
  const [isProcessing, setIsProcessing] = React.useState(false);

  const handleConfirm = async () => {
    setIsProcessing(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setIsProcessing(false);
    }
  };

  const isLoading = loading || isProcessing;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <div className="flex items-start gap-3">
            {config.destructive && (
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                <Icon icon="ph:warning" className="size-5 text-destructive" />
              </div>
            )}
            <div className="space-y-1">
              <DialogTitle>{config.title}</DialogTitle>
              {config.description && (
                <DialogDescription>{config.description}</DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>
        <DialogFooter className="mt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            {config.cancelLabel || "Cancel"}
          </Button>
          <Button
            variant={config.destructive ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={isLoading}
          >
            {isLoading ? "Processing..." : config.confirmLabel || "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
