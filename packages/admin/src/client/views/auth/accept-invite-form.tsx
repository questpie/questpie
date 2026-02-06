/**
 * Accept Invite Form - complete registration after receiving invitation
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

export type AcceptInviteFormValues = {
  name: string;
  password: string;
  confirmPassword: string;
};

export type AcceptInviteFormProps = {
  /** Called when form is submitted with valid data */
  onSubmit: (values: AcceptInviteFormValues) => Promise<void>;
  /** Email from the invitation (display only) */
  email?: string;
  /** Additional class name */
  className?: string;
  /** Error message from auth */
  error?: string | null;
  /** Minimum password length */
  minPasswordLength?: number;
};

/**
 * Accept invite form for new users to complete registration
 *
 * @example
 * ```tsx
 * function AcceptInvitePage({ token }: { token: string }) {
 *   const authClient = useAuthClient()
 *   const [error, setError] = useState<string | null>(null)
 *   const [invitation, setInvitation] = useState<any>(null)
 *
 *   // Fetch invitation details on mount
 *   useEffect(() => {
 *     authClient.admin.getInvitation({ token })
 *       .then(setInvitation)
 *       .catch(() => setError('Invalid or expired invitation'))
 *   }, [token])
 *
 *   const handleAccept = async (values: AcceptInviteFormValues) => {
 *     const result = await authClient.admin.acceptInvitation({
 *       token,
 *       name: values.name,
 *       password: values.password,
 *     })
 *     if (result.error) {
 *       setError(result.error.message)
 *     } else {
 *       // Redirect to admin
 *     }
 *   }
 *
 *   return (
 *     <AcceptInviteForm
 *       onSubmit={handleAccept}
 *       email={invitation?.email}
 *       error={error}
 *     />
 *   )
 * }
 * ```
 */
export function AcceptInviteForm({
  onSubmit,
  email,
  className,
  error,
  minPasswordLength = 8,
}: AcceptInviteFormProps) {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<AcceptInviteFormValues>({
    defaultValues: {
      name: "",
      password: "",
      confirmPassword: "",
    },
  });

  const password = watch("password");

  const handleFormSubmit = handleSubmit(async (values) => {
    await onSubmit(values);
  });

  return (
    <form onSubmit={handleFormSubmit} className={cn("space-y-4", className)}>
      <FieldGroup>
        {/* Email Display (read-only) */}
        {email && (
          <Field>
            <FieldLabel>{t("auth.email")}</FieldLabel>
            <FieldContent>
              <Input type="email" value={email} disabled className="bg-muted" />
            </FieldContent>
          </Field>
        )}

        {/* Name Field */}
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="accept-name">{t("auth.name")}</FieldLabel>
          <FieldContent>
            <div className="relative">
              <Icon
                icon="ph:user-duotone"
                className="text-muted-foreground absolute left-2 top-1/2 size-4 -translate-y-1/2"
              />
              <Input
                id="accept-name"
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

        {/* Password Field */}
        <Field data-invalid={!!errors.password}>
          <FieldLabel htmlFor="accept-password">
            {t("auth.password")}
          </FieldLabel>
          <FieldContent>
            <div className="relative">
              <Icon
                icon="ph:lock-duotone"
                className="text-muted-foreground absolute left-2 top-1/2 size-4 -translate-y-1/2"
              />
              <Input
                id="accept-password"
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
            <FieldDescription>
              {t("auth.passwordMinLength", { min: minPasswordLength })}
            </FieldDescription>
            <FieldError>{errors.password?.message}</FieldError>
          </FieldContent>
        </Field>

        {/* Confirm Password Field */}
        <Field data-invalid={!!errors.confirmPassword}>
          <FieldLabel htmlFor="accept-confirm-password">
            {t("auth.confirmPassword")}
          </FieldLabel>
          <FieldContent>
            <div className="relative">
              <Icon
                icon="ph:lock-duotone"
                className="text-muted-foreground absolute left-2 top-1/2 size-4 -translate-y-1/2"
              />
              <Input
                id="accept-confirm-password"
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
            {t("auth.acceptingInvite")}
          </>
        ) : (
          t("auth.acceptInvite")
        )}
      </Button>
    </form>
  );
}
