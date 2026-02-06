/**
 * Reset Password Form - set new password with token
 */

import { Icon } from "@iconify/react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { useTranslation } from "../../i18n/hooks";
import { cn } from "../../lib/utils";

export type ResetPasswordFormValues = {
  password: string;
  confirmPassword: string;
};

export type ResetPasswordFormProps = {
  /** Reset token from URL */
  token: string;
  /** Called when form is submitted with valid data */
  onSubmit: (
    values: ResetPasswordFormValues & { token: string },
  ) => Promise<void>;
  /** Called when back to login link is clicked */
  onBackToLoginClick?: () => void;
  /** Minimum password length */
  minPasswordLength?: number;
  /** Additional class name */
  className?: string;
  /** Error message from auth */
  error?: string | null;
};

/**
 * Reset password form with password confirmation
 *
 * @example
 * ```tsx
 * const authClient = createAdminAuthClient<typeof cms>({ baseURL: '...' })
 *
 * function ResetPasswordPage() {
 *   const token = useSearchParams().get('token')
 *   const [error, setError] = useState<string | null>(null)
 *
 *   const handleSubmit = async (values) => {
 *     const result = await authClient.resetPassword({
 *       token: values.token,
 *       newPassword: values.password,
 *     })
 *     if (result.error) {
 *       setError(result.error.message)
 *     }
 *   }
 *
 *   return (
 *     <AuthLayout title="Reset password">
 *       <ResetPasswordForm token={token} onSubmit={handleSubmit} error={error} />
 *     </AuthLayout>
 *   )
 * }
 * ```
 */
export function ResetPasswordForm({
  token,
  onSubmit,
  onBackToLoginClick,
  minPasswordLength = 8,
  className,
  error,
}: ResetPasswordFormProps) {
  const { t } = useTranslation();
  const [isSuccess, setIsSuccess] = React.useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordFormValues>({
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  const password = watch("password");

  const handleFormSubmit = handleSubmit(async (values) => {
    try {
      await onSubmit({ ...values, token });
      setIsSuccess(true);
    } catch {
      // Error will be shown via the error prop from parent
    }
  });

  // Success state
  if (isSuccess) {
    return (
      <div className={cn("space-y-4 text-center", className)}>
        <div className="bg-primary/10 mx-auto flex size-12 items-center justify-center">
          <Icon
            icon="ph:check-circle-duotone"
            className="text-primary size-6"
          />
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Password reset successful</h3>
          <p className="text-muted-foreground text-xs">
            Your password has been reset successfully. You can now sign in with
            your new password.
          </p>
        </div>
        <Button
          type="button"
          className="w-full"
          size="lg"
          onClick={onBackToLoginClick}
        >
          Sign in
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleFormSubmit} className={cn("space-y-4", className)}>
      <p className="text-muted-foreground text-xs">
        Enter your new password below.
      </p>

      <FieldGroup>
        {/* Password Field */}
        <Field data-invalid={!!errors.password}>
          <FieldLabel htmlFor="password">{t("auth.newPassword")}</FieldLabel>
          <FieldContent>
            <div className="relative">
              <Icon
                icon="ph:lock-duotone"
                className="text-muted-foreground absolute left-2 top-1/2 size-4 -translate-y-1/2"
              />
              <Input
                id="password"
                type="password"
                placeholder={t("auth.newPasswordPlaceholder")}
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
            <FieldDescription>
              {t("auth.passwordMinLength", { min: minPasswordLength })}
            </FieldDescription>
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
            {t("auth.resettingPassword")}
          </>
        ) : (
          t("auth.resetPassword")
        )}
      </Button>

      {/* Back to Login Link */}
      <p className="text-muted-foreground text-center text-xs">
        {t("auth.alreadyHaveAccount")}{" "}
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={onBackToLoginClick}
          className="h-auto p-0 text-xs"
        >
          {t("auth.signIn")}
        </Button>
      </p>
    </form>
  );
}
