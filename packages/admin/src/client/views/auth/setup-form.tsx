/**
 * Setup Form - create first admin account
 */

import { Icon } from "@iconify/react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { useTranslation } from "../../i18n/hooks";
import { cn } from "../../lib/utils";

export type SetupFormValues = {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
};

export type SetupFormProps = {
  /** Called when form is submitted with valid data */
  onSubmit: (values: SetupFormValues) => Promise<void>;
  /** Default values */
  defaultValues?: Partial<SetupFormValues>;
  /** Additional class name */
  className?: string;
  /** Error message from setup */
  error?: string | null;
  /** Minimum password length (default: 8) */
  minPasswordLength?: number;
};

/**
 * Setup form for creating the first admin account.
 *
 * @example
 * ```tsx
 * function SetupPage() {
 *   const [error, setError] = useState<string | null>(null)
 *
 *   const handleSetup = async (values: SetupFormValues) => {
 *     const result = await client.rpc.createFirstAdmin({
 *       email: values.email,
 *       password: values.password,
 *       name: values.name,
 *     })
 *     if (!result.success) {
 *       setError(result.error)
 *     }
 *   }
 *
 *   return (
 *     <AuthLayout title="Welcome">
 *       <SetupForm onSubmit={handleSetup} error={error} />
 *     </AuthLayout>
 *   )
 * }
 * ```
 */
export function SetupForm({
  onSubmit,
  defaultValues,
  className,
  error,
  minPasswordLength = 8,
}: SetupFormProps) {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SetupFormValues>({
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      ...defaultValues,
    },
  });

  const password = watch("password");

  const handleFormSubmit = handleSubmit(async (values) => {
    await onSubmit(values);
  });

  return (
    <form onSubmit={handleFormSubmit} className={cn("space-y-4", className)}>
      <FieldGroup>
        {/* Name Field */}
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="name">{t("auth.name")}</FieldLabel>
          <FieldContent>
            <div className="relative">
              <Icon
                icon="ph:user-duotone"
                className="text-muted-foreground absolute left-2 top-1/2 size-4 -translate-y-1/2"
              />
              <Input
                id="name"
                type="text"
                placeholder={t("auth.namePlaceholder")}
                className="pl-8"
                autoComplete="name"
                aria-invalid={!!errors.name}
                {...register("name", {
                  required: t("auth.nameRequired"),
                  minLength: {
                    value: 2,
                    message: t("auth.nameMinLength", { min: 2 }),
                  },
                })}
              />
            </div>
            <FieldError>{errors.name?.message}</FieldError>
          </FieldContent>
        </Field>

        {/* Email Field */}
        <Field data-invalid={!!errors.email}>
          <FieldLabel htmlFor="email">{t("auth.email")}</FieldLabel>
          <FieldContent>
            <div className="relative">
              <Icon
                icon="ph:envelope-duotone"
                className="text-muted-foreground absolute left-2 top-1/2 size-4 -translate-y-1/2"
              />
              <Input
                id="email"
                type="email"
                placeholder={t("auth.emailPlaceholder")}
                className="pl-8"
                autoComplete="email"
                aria-invalid={!!errors.email}
                {...register("email", {
                  required: t("auth.emailRequired"),
                  pattern: {
                    value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                    message: t("auth.invalidEmail"),
                  },
                })}
              />
            </div>
            <FieldError>{errors.email?.message}</FieldError>
          </FieldContent>
        </Field>

        {/* Password Field */}
        <Field data-invalid={!!errors.password}>
          <FieldLabel htmlFor="password">{t("auth.password")}</FieldLabel>
          <FieldContent>
            <div className="relative">
              <Icon
                icon="ph:lock-duotone"
                className="text-muted-foreground absolute left-2 top-1/2 size-4 -translate-y-1/2"
              />
              <Input
                id="password"
                type="password"
                placeholder={t("auth.passwordPlaceholder")}
                className="pl-8"
                autoComplete="new-password"
                aria-invalid={!!errors.password}
                {...register("password", {
                  required: t("auth.passwordRequired"),
                  minLength: {
                    value: minPasswordLength,
                    message: t("auth.passwordMinLength", {
                      min: minPasswordLength,
                    }),
                  },
                })}
              />
            </div>
            <FieldError>{errors.password?.message}</FieldError>
          </FieldContent>
        </Field>

        {/* Confirm Password Field */}
        <Field data-invalid={!!errors.confirmPassword}>
          <FieldLabel htmlFor="confirmPassword">
            {t("auth.confirmPassword")}
          </FieldLabel>
          <FieldContent>
            <div className="relative">
              <Icon
                icon="ph:lock-duotone"
                className="text-muted-foreground absolute left-2 top-1/2 size-4 -translate-y-1/2"
              />
              <Input
                id="confirmPassword"
                type="password"
                placeholder={t("auth.confirmPasswordPlaceholder")}
                className="pl-8"
                autoComplete="new-password"
                aria-invalid={!!errors.confirmPassword}
                {...register("confirmPassword", {
                  required: t("auth.passwordRequired"),
                  validate: (value) =>
                    value === password || t("auth.passwordMismatch"),
                })}
              />
            </div>
            <FieldError>{errors.confirmPassword?.message}</FieldError>
          </FieldContent>
        </Field>
      </FieldGroup>

      {/* Error Message */}
      {error && (
        <Alert variant="destructive">
          <Icon icon="ph:warning-circle" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Submit Button */}
      <Button
        type="submit"
        className="w-full"
        size="lg"
        disabled={isSubmitting}
      >
        {isSubmitting ? (
          <>
            <Icon icon="ph:spinner-gap-bold" className="animate-spin" />
            {t("auth.creatingAdmin")}
          </>
        ) : (
          t("auth.createFirstAdmin")
        )}
      </Button>
    </form>
  );
}
