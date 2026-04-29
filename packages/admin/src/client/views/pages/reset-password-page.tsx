/**
 * Reset Password Page
 *
 * Default reset password page that uses AuthLayout and ResetPasswordForm.
 * Integrates with authClient from AdminProvider context.
 */

import * as React from "react";

import { Button } from "../../components/ui/button";
import { useAuthClient } from "../../hooks/use-auth";
import { useTranslation } from "../../i18n/hooks";
import {
	selectBasePath,
	selectNavigate,
	useAdminStore,
} from "../../runtime/provider";
import { AuthLayout } from "../auth/auth-layout";
import {
	ResetPasswordForm,
	type ResetPasswordFormValues,
} from "../auth/reset-password-form";

export interface ResetPasswordPageProps {
	/**
	 * Title shown on the page
	 * @default "Reset password"
	 */
	title?: string;

	/**
	 * Description shown below the title
	 * @default "Enter your new password"
	 */
	description?: string;

	/**
	 * Logo component to show above the form
	 */
	logo?: React.ReactNode;

	/**
	 * Path to login page
	 * @default "{basePath}/login"
	 */
	loginPath?: string;

	/**
	 * Minimum password length
	 * @default 8
	 */
	minPasswordLength?: number;

	/**
	 * Function to get token from URL.
	 * By default, reads from URL search params (?token=...)
	 */
	getToken?: () => string | null;
}

/**
 * Default reset password page component.
 *
 * Uses authClient from AdminProvider to handle password reset.
 * Expects a token in the URL query params (?token=...).
 *
 * @example
 * ```tsx
 * // In your admin config
 * const admin = qa<App>()
 *   .use(coreAdminModule)
 *   .pages({
 *     resetPassword: page("reset-password", { component: ResetPasswordPage })
 *       .path("/reset-password"),
 *   })
 * ```
 */
export function ResetPasswordPage({
	title,
	description,
	logo,
	loginPath,
	minPasswordLength = 8,
	getToken,
}: ResetPasswordPageProps) {
	const { t } = useTranslation();
	const authClient = useAuthClient();
	const navigate = useAdminStore(selectNavigate);
	const basePath = useAdminStore(selectBasePath);

	const [error, setError] = React.useState<string | null>(null);

	// Get token from URL
	const token = React.useMemo(() => {
		if (getToken) {
			return getToken();
		}
		if (typeof window !== "undefined") {
			const params = new URLSearchParams(window.location.search);
			return params.get("token");
		}
		return null;
	}, [getToken]);

	const handleSubmit = async (
		values: ResetPasswordFormValues & { token: string },
	) => {
		setError(null);

		try {
			const result = await authClient.resetPassword({
				token: values.token,
				newPassword: values.password,
			});

			if (result.error) {
				if (result.error.message) {
					setError(result.error.message);
				} else {
					setError(t("error.failedToResetPassword"));
				}
				return;
			}

			// Success is handled by the form (shows success message)
		} catch (err) {
			if (err instanceof Error) {
				setError(err.message);
			} else {
				setError(t("error.anErrorOccurred"));
			}
		}
	};

	const handleBackToLoginClick = () => {
		navigate(loginPath ?? `${basePath}/login`);
	};

	// Show error if no token
	if (!token) {
		return (
			<AuthLayout
				title={t("auth.invalidLink")}
				description={t("auth.invalidLinkDescription")}
				logo={logo}
			>
				<div className="space-y-4 text-center">
					<p className="text-muted-foreground text-sm">
						{t("auth.requestNewResetLink")}
					</p>
					<Button type="button" variant="link" onClick={handleBackToLoginClick}>
						{t("auth.backToLogin")}
					</Button>
				</div>
			</AuthLayout>
		);
	}

	return (
		<AuthLayout
			title={title ?? t("auth.resetPassword")}
			description={description ?? t("auth.enterNewPassword")}
			logo={logo}
			className="qa-reset-password-page"
		>
			<ResetPasswordForm
				token={token}
				onSubmit={handleSubmit}
				onBackToLoginClick={handleBackToLoginClick}
				minPasswordLength={minPasswordLength}
				error={error}
			/>
		</AuthLayout>
	);
}
