/**
 * Setup Page
 *
 * Default setup page for creating the first admin account.
 * Uses AuthLayout and SetupForm, integrates with client from AdminProvider context.
 */

import * as React from "react";

import { useTranslation } from "../../i18n/hooks";
import {
	selectBasePath,
	selectClient,
	selectNavigate,
	useAdminStore,
} from "../../runtime/provider";
import { AuthLayout } from "../auth/auth-layout";
import { SetupForm, type SetupFormValues } from "../auth/setup-form";

export interface SetupPageProps {
	/**
	 * Title shown on the setup page
	 * @default "Welcome"
	 */
	title?: string;

	/**
	 * Description shown below the title
	 * @default "Create your admin account to get started"
	 */
	description?: string;

	/**
	 * Logo component to show above the form
	 */
	logo?: React.ReactNode;

	/**
	 * Path to redirect after successful setup
	 * @default "{basePath}/login"
	 */
	redirectTo?: string;

	/**
	 * Path to login page (shown in footer)
	 * @default "{basePath}/login"
	 */
	loginPath?: string;

	/**
	 * Show "Already have an account?" link
	 * @default true
	 */
	showLoginLink?: boolean;
}

/**
 * Default setup page component.
 *
 * Uses client from AdminProvider to call createFirstAdmin RPC function.
 *
 * @example
 * ```tsx
 * // In your admin config
 * const admin = qa<App>()
 *   .use(coreAdminModule)
 *   .pages({
 *     setup: page("setup", { component: SetupPage }).path("/setup"),
 *   })
 * ```
 */
export function SetupPage({
	title,
	description,
	logo,
	redirectTo,
	loginPath,
	showLoginLink = true,
}: SetupPageProps) {
	const { t } = useTranslation();
	const client = useAdminStore(selectClient);
	const navigate = useAdminStore(selectNavigate);
	const basePath = useAdminStore(selectBasePath);

	const [error, setError] = React.useState<string | null>(null);

	const handleSubmit = async (values: SetupFormValues) => {
		setError(null);

		const successRedirect =
			redirectTo !== undefined ? redirectTo : `${basePath}/login`;

		try {
			const result = await (client as any).routes.createFirstAdmin({
				email: values.email,
				password: values.password,
				name: values.name,
			});

			if (!result.success) {
				if (result.error) {
					setError(result.error);
				} else {
					setError(t("error.failedToCreateAdminAccount"));
				}
				return;
			}

			// Redirect to login on success
			navigate(successRedirect);
		} catch (err) {
			if (err instanceof Error) {
				setError(err.message);
			} else {
				setError(t("error.anErrorOccurred"));
			}
		}
	};

	const handleLoginClick = () => {
		navigate(loginPath ?? `${basePath}/login`);
	};

	return (
		<AuthLayout
			title={title ?? t("auth.createFirstAdmin")}
			description={description ?? t("auth.createAccountDescription")}
			logo={logo}
			className="qa-setup-page"
			footer={
				showLoginLink && (
					<p className="text-muted-foreground text-center text-xs">
						{t("auth.alreadyHaveAccount")}{" "}
						<button
							type="button"
							onClick={handleLoginClick}
							className="text-foreground underline-offset-4 hover:underline"
						>
							{t("auth.signIn")}
						</button>
					</p>
				)
			}
		>
			<SetupForm onSubmit={handleSubmit} error={error} />
		</AuthLayout>
	);
}
