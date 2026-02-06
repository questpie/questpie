/**
 * Invite Form - invite new users to the admin
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { useResolveText } from "../../i18n/hooks";
import { cn } from "../../lib/utils";

export type InviteFormValues = {
  email: string;
  role: string;
  message?: string;
};

export type InviteFormProps = {
  /** Called when form is submitted with valid data */
  onSubmit: (values: InviteFormValues) => Promise<void>;
  /** Available roles for selection */
  roles?: Array<{ value: string; label: string }>;
  /** Default role */
  defaultRole?: string;
  /** Show custom message field */
  showMessage?: boolean;
  /** Additional class name */
  className?: string;
  /** Error message from auth */
  error?: string | null;
  /** Success message after invite sent */
  success?: string | null;
};

/**
 * Invite form for admins to invite new users
 *
 * @example
 * ```tsx
 * function InvitePage() {
 *   const authClient = useAuthClient()
 *   const [error, setError] = useState<string | null>(null)
 *   const [success, setSuccess] = useState<string | null>(null)
 *
 *   const handleInvite = async (values: InviteFormValues) => {
 *     const result = await authClient.admin.createInvitation({
 *       email: values.email,
 *       role: values.role,
 *     })
 *     if (result.error) {
 *       setError(result.error.message)
 *     } else {
 *       setSuccess(`Invitation sent to ${values.email}`)
 *     }
 *   }
 *
 *   return (
 *     <InviteForm
 *       onSubmit={handleInvite}
 *       error={error}
 *       success={success}
 *     />
 *   )
 * }
 * ```
 */
export function InviteForm({
  onSubmit,
  roles = [
    { value: "admin", label: "Admin" },
    { value: "user", label: "User" },
  ],
  defaultRole = "user",
  showMessage = true,
  className,
  error,
  success,
}: InviteFormProps) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteFormValues>({
    defaultValues: {
      email: "",
      role: defaultRole,
      message: "",
    },
  });

  const selectedRole = watch("role");
  const resolveText = useResolveText();

  const handleFormSubmit = handleSubmit(async (values) => {
    await onSubmit(values);
    // Reset form on success
    if (!error) {
      reset();
    }
  });

  return (
    <form onSubmit={handleFormSubmit} className={cn("space-y-4", className)}>
      <FieldGroup>
        {/* Email Field */}
        <Field data-invalid={!!errors.email}>
          <FieldLabel htmlFor="invite-email">Email Address</FieldLabel>
          <FieldContent>
            <div className="relative">
              <Icon
                icon="ph:envelope-duotone"
                className="text-muted-foreground absolute left-2 top-1/2 size-4 -translate-y-1/2"
              />
              <Input
                id="invite-email"
                type="email"
                placeholder="user@example.com"
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
            <FieldDescription>
              An invitation link will be sent to this email
            </FieldDescription>
            <FieldError>{errors.email?.message}</FieldError>
          </FieldContent>
        </Field>

        {/* Role Field */}
        <Field data-invalid={!!errors.role}>
          <FieldLabel htmlFor="invite-role">Role</FieldLabel>
          <FieldContent>
            <Select
              value={selectedRole}
              onValueChange={(value) => value && setValue("role", value)}
            >
              <SelectTrigger id="invite-role">
                <SelectValue>
                  {roles.find((r) => r.value === selectedRole)?.label
                    ? resolveText(
                        roles.find((r) => r.value === selectedRole)?.label,
                      )
                    : "Select a role"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role.value} value={role.value}>
                    {resolveText(role.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              The role determines what permissions the user will have
            </FieldDescription>
            <FieldError>{errors.role?.message}</FieldError>
          </FieldContent>
        </Field>

        {/* Optional Message Field */}
        {showMessage && (
          <Field>
            <FieldLabel htmlFor="invite-message">
              Personal Message (Optional)
            </FieldLabel>
            <FieldContent>
              <Textarea
                id="invite-message"
                placeholder="Add a personal message to the invitation..."
                rows={3}
                {...register("message")}
              />
              <FieldDescription>
                This message will be included in the invitation email
              </FieldDescription>
            </FieldContent>
          </Field>
        )}
      </FieldGroup>

      {/* Error Message */}
      {error && (
        <Alert variant="destructive">
          <Icon icon="ph:warning-circle" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Success Message */}
      {success && (
        <Alert>
          <Icon icon="ph:user-plus" />
          <AlertDescription>{success}</AlertDescription>
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
            Sending invitation...
          </>
        ) : (
          <>
            <Icon icon="ph:user-plus-bold" />
            Send Invitation
          </>
        )}
      </Button>
    </form>
  );
}
