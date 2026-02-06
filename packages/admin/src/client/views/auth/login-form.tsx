/**
 * Login Form - email/password authentication
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

export type LoginFormValues = {
  email: string;
  password: string;
  rememberMe?: boolean;
};

export type LoginFormProps = {
  /** Called when form is submitted with valid data */
  onSubmit: (values: LoginFormValues) => Promise<void>;
  /** Called when sign up link is clicked */
  onSignUpClick?: () => void;
  /** Called when forgot password link is clicked */
  onForgotPasswordClick?: () => void;
  /** Show remember me checkbox */
  showRememberMe?: boolean;
  /** Show sign up link */
  showSignUp?: boolean;
  /** Show forgot password link */
  showForgotPassword?: boolean;
  /** Default values */
  defaultValues?: Partial<LoginFormValues>;
  /** Additional class name */
  className?: string;
  /** Error message from auth */
  error?: string | null;
  /** Minimum password length (default: 8) */
  minPasswordLength?: number;
};

/**
 * Login form with email and password fields
 *
 * @example
 * ```tsx
 * const authClient = createAdminAuthClient<typeof cms>({ baseURL: '...' })
 *
 * function LoginPage() {
 *   const [error, setError] = useState<string | null>(null)
 *
 *   const handleLogin = async (values: LoginFormValues) => {
 *     const result = await authClient.signIn.email({
 *       email: values.email,
 *       password: values.password,
 *     })
 *     if (result.error) {
 *       setError(result.error.message)
 *     }
 *   }
 *
 *   return (
 *     <AuthLayout title="Sign in">
 *       <LoginForm onSubmit={handleLogin} error={error} />
 *     </AuthLayout>
 *   )
 * }
 * ```
 */
export function LoginForm({
  onSubmit,
  onSignUpClick,
  onForgotPasswordClick,
  showRememberMe = false,
  showSignUp = true,
  showForgotPassword = true,
  defaultValues,
  className,
  error,
  minPasswordLength = 8,
}: LoginFormProps) {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    defaultValues: {
      email: "",
      password: "",
      rememberMe: false,
      ...defaultValues,
    },
  });

  const handleFormSubmit = handleSubmit(async (values) => {
    await onSubmit(values);
  });

  return (
    <form onSubmit={handleFormSubmit} className={cn("space-y-4", className)}>
      <FieldGroup>
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
                autoComplete="current-password"
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

        {/* Remember Me & Forgot Password */}
        {(showRememberMe || showForgotPassword) && (
          <div className="flex items-center justify-between">
            {showRememberMe && (
              <label className="text-muted-foreground flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className="rounded border-gray-300"
                  {...register("rememberMe")}
                />
                {t("auth.rememberMe")}
              </label>
            )}
            {showForgotPassword && (
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={onForgotPasswordClick}
                className="h-auto p-0 text-xs"
              >
                {t("auth.forgotPassword")}
              </Button>
            )}
          </div>
        )}
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
            {t("auth.signingIn")}
          </>
        ) : (
          t("auth.signIn")
        )}
      </Button>

      {/* Sign Up Link */}
      {showSignUp && (
        <p className="text-muted-foreground text-center text-xs">
          {t("auth.dontHaveAccount")}{" "}
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={onSignUpClick}
            className="h-auto p-0 text-xs"
          >
            {t("auth.signUp")}
          </Button>
        </p>
      )}
    </form>
  );
}
