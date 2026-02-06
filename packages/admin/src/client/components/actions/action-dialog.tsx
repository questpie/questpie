/**
 * Action Dialog
 *
 * Renders dialog-type and form-type actions.
 * Supports lazy-loaded components and inline form definitions.
 * Form actions use AutoFormFields for full field system support.
 */

"use client";

import { Icon } from "@iconify/react";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import {
  type FieldErrors,
  FormProvider,
  type Resolver,
  useForm,
} from "react-hook-form";
import { toast } from "sonner";
import type {
  ActionContext,
  ActionDefinition,
  ActionHelpers,
  DialogHandler,
  FormHandler,
} from "../../builder/types/action-types";
import type { FieldDefinition } from "../../builder/field/field";
import { buildValidationSchema } from "../../builder/validation";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import { selectAdmin, useAdminStore } from "../../runtime/provider";
import { AutoFormFields } from "../../views/collection/auto-form-fields";
import { Button } from "../ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "../ui/responsive-dialog";

export interface ActionDialogProps<TItem = any> {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog should close */
  onOpenChange: (open: boolean) => void;
  /** The action being rendered */
  action: ActionDefinition<TItem>;
  /** Collection name */
  collection: string;
  /** Item for row actions */
  item?: TItem;
  /** Items for bulk actions */
  items?: TItem[];
  /** Action helpers */
  helpers: ActionHelpers;
}

/**
 * Create a custom resolver for action form validation
 * Uses buildValidationSchema and handles Zod v4 compatibility
 */
function createActionFormResolver(
  fields: Record<string, FieldDefinition>,
  registry: Record<string, FieldDefinition>,
): Resolver<Record<string, any>> {
  const schema = buildValidationSchema(fields, registry);

  return async (values) => {
    const result = schema.safeParse(values);

    if (result.success) {
      return {
        values: result.data,
        errors: {},
      };
    }

    const errors: FieldErrors = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join(".");
      if (path && !errors[path]) {
        errors[path] = {
          type: issue.code,
          message: issue.message,
        };
      }
    }

    return {
      values: {},
      errors,
    };
  };
}

/**
 * Form Dialog content - renders form fields using AutoFormFields
 *
 * Uses buildValidationSchema for automatic Zod schema generation
 * from field definitions, providing full field system support.
 */
function FormDialogContent<TItem>({
  action,
  ctx,
  onClose,
}: {
  action: ActionDefinition<TItem>;
  ctx: ActionContext<TItem>;
  onClose: () => void;
}) {
  const handler = action.handler as FormHandler<TItem>;
  const { config } = handler;
  const resolveText = useResolveText();
  const { t } = useTranslation();
  const admin = useAdminStore(selectAdmin);

  // Create resolver from field definitions
  const resolver = React.useMemo(() => {
    if (!admin) return undefined;
    return createActionFormResolver(config.fields, admin.getFields());
  }, [admin, config.fields]);

  const form = useForm({
    defaultValues: config.defaultValues || {},
    resolver,
  });

  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const handleSubmit = form.handleSubmit(async (data) => {
    setIsSubmitting(true);

    const submitPromise = async () => {
      await config.onSubmit(data, ctx);
      return data;
    };

    toast.promise(submitPromise(), {
      loading: t("toast.processing"),
      success: () => {
        onClose();
        return t("toast.actionSuccess");
      },
      error: (error) => {
        return error instanceof Error ? error.message : t("toast.actionFailed");
      },
      finally: () => {
        setIsSubmitting(false);
      },
    });
  });

  // Build collection config for AutoFormFields
  const collectionConfig = React.useMemo(
    () => ({
      fields: config.fields,
    }),
    [config.fields],
  );

  return (
    <FormProvider {...form}>
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>
          {resolveText(config.title)}
        </ResponsiveDialogTitle>
        {config.description && (
          <ResponsiveDialogDescription>
            {resolveText(config.description)}
          </ResponsiveDialogDescription>
        )}
      </ResponsiveDialogHeader>

      <form onSubmit={handleSubmit} className="space-y-4">
        <AutoFormFields collection="__action__" config={collectionConfig} />

        <ResponsiveDialogFooter className="mt-6">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
          >
            {resolveText(config.cancelLabel, t("common.cancel"))}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? t("common.loading")
              : resolveText(config.submitLabel, t("common.submit"))}
          </Button>
        </ResponsiveDialogFooter>
      </form>
    </FormProvider>
  );
}

/**
 * Custom Dialog content - renders lazy-loaded component
 */
function CustomDialogContent<TItem>({
  action,
  ctx,
  onClose,
}: {
  action: ActionDefinition<TItem>;
  ctx: ActionContext<TItem>;
  onClose: () => void;
}) {
  const handler = action.handler as DialogHandler<TItem>;
  const [Component, setComponent] =
    React.useState<React.ComponentType<any> | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    let mounted = true;

    async function loadComponent() {
      try {
        const comp = handler.component;

        // Handle lazy-loaded components
        if (typeof comp === "function") {
          // Check if it's a React.lazy component by looking for _payload
          const lazyComp = comp as any;
          if (lazyComp._payload !== undefined) {
            // It's a lazy component, resolve it
            const resolved = await lazyComp._payload();
            if (mounted) {
              setComponent(() => resolved.default || resolved);
            }
          } else {
            // It's a direct component function or import
            const result = (comp as () => any)();
            if (result?.then) {
              const mod = await result;
              if (mounted) {
                setComponent(() => mod.default || mod);
              }
            } else {
              // Direct component
              if (mounted) {
                setComponent(() => comp as React.ComponentType<any>);
              }
            }
          }
        } else {
          // Direct component
          if (mounted) {
            setComponent(() => comp as React.ComponentType<any>);
          }
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error("Failed to load"));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadComponent();
    return () => {
      mounted = false;
    };
  }, [handler.component]);

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Icon
          icon="ph:spinner-gap"
          className="size-6 animate-spin text-muted-foreground"
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center">
        <p className="text-destructive">{error.message}</p>
        <Button variant="outline" onClick={onClose} className="mt-4">
          Close
        </Button>
      </div>
    );
  }

  if (!Component) {
    return (
      <div className="p-4 text-center">
        <p className="text-muted-foreground">Component not found</p>
        <Button variant="outline" onClick={onClose} className="mt-4">
          Close
        </Button>
      </div>
    );
  }

  return (
    <Component
      item={ctx.item}
      items={ctx.items}
      collection={ctx.collection}
      onClose={onClose}
      onSuccess={() => {
        ctx.helpers.refresh();
        onClose();
      }}
    />
  );
}

/**
 * ActionDialog - Renders dialog-type and form-type actions
 *
 * @example
 * ```tsx
 * <ActionDialog
 *   open={!!activeAction}
 *   onOpenChange={(open) => !open && setActiveAction(null)}
 *   action={activeAction}
 *   collection="users"
 *   item={selectedUser}
 *   helpers={actionHelpers}
 * />
 * ```
 */
export function ActionDialog<TItem = any>({
  open,
  onOpenChange,
  action,
  collection,
  item,
  items,
  helpers,
}: ActionDialogProps<TItem>): React.ReactElement | null {
  const queryClient = useQueryClient();

  // Build action context
  const ctx: ActionContext<TItem> = React.useMemo(
    () => ({
      item,
      items,
      collection,
      helpers: {
        ...helpers,
        closeDialog: () => onOpenChange(false),
      },
      queryClient: {
        invalidateQueries: (filters) => queryClient.invalidateQueries(filters),
        resetQueries: (filters) => queryClient.resetQueries(filters),
        refetchQueries: (filters) => queryClient.refetchQueries(filters),
      },
    }),
    [item, items, collection, helpers, onOpenChange, queryClient],
  );

  const handleClose = () => onOpenChange(false);

  // Determine dialog size based on handler type and config
  const getDialogClassName = () => {
    if (action.handler.type === "form") {
      const width = (action.handler as FormHandler).config.width || "md";
      const widthMap = {
        sm: "sm:max-w-sm",
        md: "sm:max-w-md",
        lg: "sm:max-w-lg",
        xl: "sm:max-w-xl",
      };
      return widthMap[width];
    }
    if (action.handler.type === "dialog") {
      return "sm:max-w-lg";
    }
    return "sm:max-w-md";
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className={getDialogClassName()}>
        {action.handler.type === "form" && (
          <FormDialogContent action={action} ctx={ctx} onClose={handleClose} />
        )}
        {action.handler.type === "dialog" && (
          <CustomDialogContent
            action={action}
            ctx={ctx}
            onClose={handleClose}
          />
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
