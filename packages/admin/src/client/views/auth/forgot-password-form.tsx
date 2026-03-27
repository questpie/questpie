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
import { useTranslation } from "../../i18n/hooks";
import { cn } from "../../lib/utils";

export type ForgotPasswordFormValues = {
	email: string;
};

type ForgotPasswordFormProps = {
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
 * const authClient = createAdminAuthClient<typeof app>({ baseURL: '...' })
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
	const { t } = useTranslation();
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
					<h3 className="text-sm font-medium">{t("auth.checkYourEmail")}</h3>
					<p className="text-muted-foreground text-xs">
						{t("auth.resetLinkSentDescription")}
					</p>
				</div>
				<Button
					type="button"
					variant="outline"
					className="w-full"
					onClick={onBackToLoginClick}
				>
					{t("auth.backToLogin")}
				</Button>
			</div>
		);
	}

	return (
		<form
			onSubmit={handleFormSubmit}
			className={cn("qa-forgot-password-form space-y-4", className)}
		>
			<p className="text-muted-foreground text-xs">
				{t("auth.forgotPasswordFormDescription")}
			</p>

			<FieldGroup>
				{/* Email Field */}
				<Field data-invalid={!!errors.email}>
					<FieldLabel htmlFor="email">{t("auth.email")}</FieldLabel>
					<FieldContent>
						<div className="relative">
							<Icon
								icon="ph:envelope-duotone"
								className="text-muted-foreground absolute top-1/2 left-2 size-4 -translate-y-1/2"
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
						{t("auth.sendingResetLink")}
					</>
				) : (
					t("auth.sendResetLink")
				)}
			</Button>

			{/* Back to Login Link */}
			<p className="text-muted-foreground text-center text-xs">
				{t("auth.rememberYourPassword")}{" "}
				<Button
					type="button"
					variant="link"
					size="sm"
					onClick={onBackToLoginClick}
					className="h-auto p-0 text-xs"
				>
					{t("auth.backToLogin")}
				</Button>
			</p>
		</form>
	);
}
