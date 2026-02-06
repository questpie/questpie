/**
 * Forgot Password Form - request password reset email
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
import { cn } from "../../lib/utils";

export type ForgotPasswordFormValues = {
  email: string;
};

export type ForgotPasswordFormProps = {
  /** Called when form is submitted with valid data */
  onSubmit: (values: ForgotPasswordFormValues) => Promise<void>;
  /** Called when back to login link is clicked */
  onBackToLoginClick?: () => void;
  /** Default values */
  defaultValues?: Partial<ForgotPasswordFormValues>;
  /** Additional class name */
  className?: string;
  /** Error message from auth */
  error?: string | null;
};

/**
 * Forgot password form with email field
 *
 * @example
 * ```tsx
 * const authClient = createAdminAuthClient<typeof cms>({ baseURL: '...' })
 *
 * function ForgotPasswordPage() {
 *   const [error, setError] = useState<string | null>(null)
 *
 *   const handleSubmit = async (values: ForgotPasswordFormValues) => {
 *     const result = await authClient.forgetPassword({
 *       email: values.email,
 *       redirectTo: '/reset-password',
 *     })
 *     if (result.error) {
 *       setError(result.error.message)
 *     }
 *   }
 *
 *   return (
 *     <AuthLayout title="Forgot password">
 *       <ForgotPasswordForm onSubmit={handleSubmit} error={error} />
 *     </AuthLayout>
 *   )
 * }
 * ```
 */
export function ForgotPasswordForm({
  onSubmit,
  onBackToLoginClick,
  defaultValues,
  className,
  error,
}: ForgotPasswordFormProps) {
  const [isSuccess, setIsSuccess] = React.useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordFormValues>({
    defaultValues: {
      email: "",
      ...defaultValues,
    },
  });

  const handleFormSubmit = handleSubmit(async (values) => {
    try {
      await onSubmit(values);
      // Only set success if no error was thrown
      // The parent component should throw or not set error prop before this resolves
      setIsSuccess(true);
    } catch {
      // Error will be shown via the error prop from parent
      // Do not set success state on error
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
          <h3 className="text-sm font-medium">Check your email</h3>
          <p className="text-muted-foreground text-xs">
            We've sent a password reset link to your email address. Please check
            your inbox and follow the instructions.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={onBackToLoginClick}
        >
          Back to login
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleFormSubmit} className={cn("space-y-4", className)}>
      <p className="text-muted-foreground text-xs">
        Enter your email address and we'll send you a link to reset your
        password.
      </p>

      <FieldGroup>
        {/* Email Field */}
        <Field data-invalid={!!errors.email}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <FieldContent>
            <div className="relative">
              <Icon
                icon="ph:envelope-duotone"
                className="text-muted-foreground absolute left-2 top-1/2 size-4 -translate-y-1/2"
              />
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                className="pl-8"
                autoComplete="email"
                aria-invalid={!!errors.email}
                {...register("email", {
                  required: "Email is required",
                  pattern: {
                    value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                    message: "Invalid email address",
                  },
                })}
              />
            </div>
            <FieldError>{errors.email?.message}</FieldError>
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
            Sending...
          </>
        ) : (
          "Send reset link"
        )}
      </Button>

      {/* Back to Login Link */}
      <p className="text-muted-foreground text-center text-xs">
        Remember your password?{" "}
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={onBackToLoginClick}
          className="h-auto p-0 text-xs"
        >
          Back to login
        </Button>
      </p>
    </form>
  );
}
