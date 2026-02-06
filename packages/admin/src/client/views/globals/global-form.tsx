/**
 * GlobalForm Component
 *
 * Form wrapper for editing global settings.
 * Globals are singleton records (like site settings, homepage config, etc.)
 */

import type { Questpie } from "questpie";
import { type QuestpieClient, QuestpieClientError } from "questpie/client";
import React from "react";
import { FormProvider, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import { useGlobal, useGlobalUpdate } from "../../hooks/use-global";
import { useGlobalServerValidation } from "../../hooks/use-server-validation";
import { useTranslation } from "../../i18n/hooks";

/**
 * Global data type helper
 */
type GlobalData<
  T extends Questpie<any>,
  K extends keyof QuestpieClient<T>["globals"],
> = Awaited<ReturnType<QuestpieClient<T>["globals"][K]["get"]>>;

/**
 * GlobalForm props
 */
export type GlobalFormProps<
  T extends Questpie<any>,
  K extends keyof QuestpieClient<T>["globals"],
> = {
  /**
   * Global name
   */
  global: K;

  /**
   * Custom field renderer
   */
  children: React.ReactNode;

  /**
   * On submit success callback
   */
  onSuccess?: (data: GlobalData<T, K>) => void;

  /**
   * On error callback
   */
  onError?: (error: Error) => void;

  /**
   * Form title
   */
  title?: string;

  /**
   * Form description
   */
  description?: string;

  /**
   * Header actions (e.g. locale switcher)
   */
  headerActions?: React.ReactNode;

  /**
   * Submit button text
   */
  submitText?: string;

  /**
   * Show loading skeleton
   */
  showSkeleton?: boolean;
};

/**
 * GlobalForm - Form wrapper for CMS globals
 *
 * @example
 * ```tsx
 * import { GlobalForm } from '@questpie/admin/views/globals'
 * import type { cms } from './server/cms'
 *
 * function SiteSettingsForm() {
 *   return (
 *     <GlobalForm<typeof cms, 'siteSettings'>
 *       global="siteSettings"
 *       title="Site Settings"
 *       description="Configure your site settings"
 *       onSuccess={() => toast.success('Settings saved!')}
 *     >
 *       <FormField name="siteName" label="Site Name" />
 *       <FormField name="tagline" label="Tagline" />
 *     </GlobalForm>
 *   )
 * }
 * ```
 */
export function GlobalForm<
  T extends Questpie<any>,
  K extends keyof QuestpieClient<T>["globals"],
>({
  global: globalName,
  children,
  onSuccess,
  onError,
  title,
  description,
  headerActions,
  submitText = "Save Changes",
  showSkeleton = true,
}: GlobalFormProps<T, K>): React.ReactElement {
  const { t } = useTranslation();

  // Fetch global data - cast globalName to satisfy the hook's expected type
  const {
    data: globalData,
    isLoading,
    error: fetchError,
  } = useGlobal(globalName as string, { localeFallback: false });

  // Update mutation
  const updateMutation = useGlobalUpdate(globalName as string, {
    onSuccess: (data) => {
      onSuccess?.(data as unknown as GlobalData<T, K>);
    },
    onError: (error) => {
      onError?.(error);
    },
  });

  // Get validation resolver - uses server JSON Schema for validation
  const { resolver } = useGlobalServerValidation(globalName as string);

  // Form setup
  const form = useForm({
    defaultValues: (globalData ?? {}) as any,
    resolver,
  });

  // Reset form when data loads
  React.useEffect(() => {
    if (globalData) {
      form.reset(globalData as any);
    }
  }, [form, globalData]);

  // Handle submit
  const onSubmit = async (data: any) => {
    try {
      await updateMutation.mutateAsync({ data });
    } catch (error) {
      // Handle field-level validation errors from the API
      if (
        error instanceof QuestpieClientError &&
        error.fieldErrors &&
        error.fieldErrors.length > 0
      ) {
        for (const fieldError of error.fieldErrors) {
          form.setError(fieldError.path as any, {
            type: "server",
            message: fieldError.message,
          });
        }
        toast.error(t("toast.validationFailed"), {
          description: t("toast.validationDescription"),
        });
        return;
      }

      // Handle generic errors
      const message =
        error instanceof Error ? error.message : t("error.unknown");
      toast.error(t("toast.settingsSaveFailed"), {
        description: message,
      });
    }
  };

  // Loading state
  if (isLoading && showSkeleton) {
    return (
      <Card>
        {(title || headerActions) && (
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            {title && <Skeleton className="h-6 w-48" />}
            {headerActions && <Skeleton className="h-9 w-32" />}
          </CardHeader>
        )}
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
        <CardFooter className="flex justify-end">
          <Skeleton className="h-10 w-24" />
        </CardFooter>
      </Card>
    );
  }

  // Error state
  if (fetchError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-destructive">Error</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Failed to load global settings: {fetchError.message}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Card>
          {(title || description || headerActions) && (
            <CardHeader className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                {title && <CardTitle>{title}</CardTitle>}
                {description && (
                  <CardDescription>{description}</CardDescription>
                )}
              </div>
              {headerActions && <div>{headerActions}</div>}
            </CardHeader>
          )}
          <CardContent className="space-y-4">{children}</CardContent>
          <CardFooter className="flex justify-end gap-2">
            <Button
              type="submit"
              disabled={form.formState.isSubmitting || updateMutation.isPending}
            >
              {form.formState.isSubmitting || updateMutation.isPending
                ? "Saving..."
                : submitText}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </FormProvider>
  );
}
