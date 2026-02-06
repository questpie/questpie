"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "#questpie/admin/client/lib/utils";
import { useIsMobile } from "#questpie/admin/client/hooks/use-media-query";
import { DialogContent, DialogFooter, DialogHeader } from "./dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "./drawer";

/**
 * ResponsiveDialog - Uses Dialog on desktop, fullscreen Drawer on mobile
 *
 * @example
 * ```tsx
 * <ResponsiveDialog>
 *   <ResponsiveDialogTrigger asChild>
 *     <Button>Open</Button>
 *   </ResponsiveDialogTrigger>
 *   <ResponsiveDialogContent>
 *     <ResponsiveDialogHeader>
 *       <ResponsiveDialogTitle>Title</ResponsiveDialogTitle>
 *       <ResponsiveDialogDescription>Description</ResponsiveDialogDescription>
 *     </ResponsiveDialogHeader>
 *     <div>Content here</div>
 *     <ResponsiveDialogFooter>
 *       <ResponsiveDialogClose asChild>
 *         <Button variant="outline">Cancel</Button>
 *       </ResponsiveDialogClose>
 *       <Button>Save</Button>
 *     </ResponsiveDialogFooter>
 *   </ResponsiveDialogContent>
 * </ResponsiveDialog>
 * ```
 */

interface ResponsiveDialogContextValue {
  isMobile: boolean;
}

const ResponsiveDialogContext =
  React.createContext<ResponsiveDialogContextValue | null>(null);

function useResponsiveDialog() {
  const context = React.useContext(ResponsiveDialogContext);
  if (!context) {
    throw new Error(
      "ResponsiveDialog components must be used within ResponsiveDialog",
    );
  }
  return context;
}

export interface ResponsiveDialogProps {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function ResponsiveDialog({
  children,
  open,
  onOpenChange,
}: ResponsiveDialogProps) {
  const isMobile = useIsMobile();

  const contextValue = React.useMemo(() => ({ isMobile }), [isMobile]);

  if (isMobile) {
    return (
      <ResponsiveDialogContext.Provider value={contextValue}>
        <Drawer open={open} onOpenChange={onOpenChange}>
          {children}
        </Drawer>
      </ResponsiveDialogContext.Provider>
    );
  }

  return (
    <ResponsiveDialogContext.Provider value={contextValue}>
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        {children}
      </DialogPrimitive.Root>
    </ResponsiveDialogContext.Provider>
  );
}

function ResponsiveDialogTrigger({
  children,
  asChild = false,
  className,
  ...props
}: {
  children: React.ReactNode;
  asChild?: boolean;
  className?: string;
} & Omit<React.ComponentProps<"button">, "className">) {
  const { isMobile } = useResponsiveDialog();

  if (isMobile) {
    return (
      <DrawerTrigger asChild={asChild} className={className} {...props}>
        {children}
      </DrawerTrigger>
    );
  }

  return (
    <DialogPrimitive.Trigger
      className={className}
      render={asChild ? (children as React.ReactElement) : undefined}
      {...props}
    >
      {!asChild ? children : undefined}
    </DialogPrimitive.Trigger>
  );
}

export interface ResponsiveDialogContentProps {
  children: React.ReactNode;
  className?: string;
}

function ResponsiveDialogContent({
  children,
  className,
}: ResponsiveDialogContentProps) {
  const { isMobile } = useResponsiveDialog();

  if (isMobile) {
    return (
      <DrawerContent className={cn("max-h-[96vh]", className)}>
        {children}
      </DrawerContent>
    );
  }

  return <DialogContent className={className}>{children}</DialogContent>;
}

function ResponsiveDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const { isMobile } = useResponsiveDialog();

  if (isMobile) {
    return <DrawerHeader className={className} {...props} />;
  }

  return <DialogHeader className={className} {...props} />;
}

function ResponsiveDialogTitle({
  className,
  children,
  ...props
}: React.ComponentProps<"h2">) {
  const { isMobile } = useResponsiveDialog();

  if (isMobile) {
    return (
      <DrawerTitle className={className} {...props}>
        {children}
      </DrawerTitle>
    );
  }

  return (
    <DialogPrimitive.Title
      data-slot="responsive-dialog-title"
      className={cn("text-sm font-medium", className)}
      {...props}
    >
      {children}
    </DialogPrimitive.Title>
  );
}

function ResponsiveDialogDescription({
  className,
  children,
  ...props
}: React.ComponentProps<"p">) {
  const { isMobile } = useResponsiveDialog();

  if (isMobile) {
    return (
      <DrawerDescription className={className} {...props}>
        {children}
      </DrawerDescription>
    );
  }

  return (
    <DialogPrimitive.Description
      data-slot="responsive-dialog-description"
      className={cn("text-muted-foreground text-xs/relaxed", className)}
      {...props}
    >
      {children}
    </DialogPrimitive.Description>
  );
}

function ResponsiveDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const { isMobile } = useResponsiveDialog();

  if (isMobile) {
    return <DrawerFooter className={className} {...props} />;
  }

  return <DialogFooter className={className} {...props} />;
}

function ResponsiveDialogClose({
  children,
  asChild = false,
  className,
  ...props
}: {
  children: React.ReactNode;
  asChild?: boolean;
  className?: string;
} & Omit<React.ComponentProps<"button">, "className">) {
  const { isMobile } = useResponsiveDialog();

  if (isMobile) {
    return (
      <DrawerClose asChild={asChild} className={className} {...props}>
        {children}
      </DrawerClose>
    );
  }

  return (
    <DialogPrimitive.Close
      className={className}
      render={asChild ? (children as React.ReactElement) : undefined}
      {...props}
    >
      {!asChild ? children : undefined}
    </DialogPrimitive.Close>
  );
}

export {
  ResponsiveDialog,
  ResponsiveDialogTrigger,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogClose,
  useResponsiveDialog,
};
