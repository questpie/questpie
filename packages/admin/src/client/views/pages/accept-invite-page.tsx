/**
 * Accept Invite Page
 *
 * Page for new users to complete registration after receiving invitation.
 * Uses Better Auth's admin plugin for invitation acceptance.
 */

import { Icon } from "@iconify/react";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { Alert, AlertDescription } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { useAuthClient } from "../../hooks/use-auth";
import { useTranslation } from "../../i18n/hooks";
import {
	selectBasePath,
	selectNavigate,
	useAdminStore,
} from "../../runtime/provider";
import {
	AcceptInviteForm,
	type AcceptInviteFormValues,
} from "../auth/accept-invite-form";
import { AuthLayout } from "../auth/auth-layout";

interface AcceptInvitePageProps {
	/**
	 * Invitation token from URL
	 */
	token: string;

	/**
	 * Title shown on the page
	 * @default "Complete Registration"
	 */
	title?: string;

	/**
	 * Description shown below the title
	 * @default "Create your account to get started"
	 */
	description?: string;

	/**
	 * Logo component to show above the form
	 */
	logo?: React.ReactNode;

	/**
	 * Path to redirect after successful registration
	 * @default basePath (e.g., "/admin")
	 */
	redirectTo?: string;

	/**
	 * Path to login page (for invalid/expired tokens)
	 * @default "{basePath}/login"
	 */
	loginPath?: string;

	/**
	 * Minimum password length
	 * @default 8
	 */
	minPasswordLength?: number;
}

function AcceptInvitePageSkeleton() {
	return (
		<div className="space-y-4" aria-busy="true">
			<span className="sr-only">Loading invitation</span>
			<div className="space-y-2">
				<Skeleton variant="text" className="h-4 w-20" />
				<Skeleton className="h-10 w-full" />
			</div>
			<div className="space-y-2">
				<Skeleton variant="text" className="h-4 w-24" />
				<Skeleton className="h-10 w-full" />
			</div>
			<Skeleton className="h-10 w-full" />
		</div>
	);
}

/**
 * Accept invite page component.
 *
 * Validates the invitation token and allows new users to complete registration.
 * Uses authClient from AdminProvider.
 *
 * @example
 * ```tsx
 * // In your router
 * function AcceptInviteRoute() {
 *   const { token } = useParams()
 *   return <AcceptInvitePage token={token} />
 * }
 * ```
 */
export function AcceptInvitePage({
	token,
	title,
	description,
	logo,
	redirectTo,
	loginPath,
	minPasswordLength = 8,
}: AcceptInvitePageProps) {
	const { t } = useTranslation();
	const authClient = useAuthClient();
	const navigate = useAdminStore(selectNavigate);
	const basePath = useAdminStore(selectBasePath);

	const {
		data: invitationData,
		isLoading: isValidating,
		error: invitationError,
	} = useQuery({
		queryKey: ["questpie", "invitation", token],
		queryFn: async () => {
			const result = await authClient.admin.getInvitation({ query: { token } });
			if (result.error) {
				throw new Error(
					result.error.message || t("auth.invalidOrExpiredInvitation"),
				);
			}
			if (!result.data) {
				throw new Error(t("auth.invalidOrExpiredInvitation"));
			}
			return { email: result.data.email, role: result.data.role };
		},
		retry: false,
		staleTime: Infinity,
	});
	const [error, setError] = React.useState<string | null>(null);

	const handleSubmit = async (values: AcceptInviteFormValues) => {
		setError(null);

		const successRedirect = redirectTo !== undefined ? redirectTo : basePath;

		try {
			const result = await authClient.admin.acceptInvitation({
				token,
				name: values.name,
				password: values.password,
			});

			if (result.error) {
				if (result.error.message) {
					setError(result.error.message);
				} else {
					setError(t("error.failedToCreateAccount"));
				}
				return;
			}

			// Redirect on success
			navigate(successRedirect);
		} catch (err) {
			if (err instanceof Error) {
				setError(err.message);
			} else {
				setError(t("error.anErrorOccurred"));
			}
		}
	};

	const handleGoToLogin = () => {
		navigate(loginPath ?? `${basePath}/login`);
	};

	if (isValidating) {
		return (
			<AuthLayout
				title={t("auth.validatingInvitation")}
				description={t("auth.pleaseWait")}
				logo={logo}
			>
				<AcceptInvitePageSkeleton />
			</AuthLayout>
		);
	}

	if (invitationError) {
		return (
			<AuthLayout
				title={t("auth.invalidInvitation")}
				description={t("auth.invalidInvitationDescription")}
				logo={logo}
			>
				<div className="space-y-4">
					<Alert variant="destructive">
						<Icon icon="ph:warning-circle" />
						<AlertDescription>
							{invitationError?.message || t("auth.invalidOrExpiredInvitation")}
						</AlertDescription>
					</Alert>
					<p className="text-muted-foreground text-center text-sm">
						{t("auth.invitationExpiredMessage")}
					</p>
					<Button
						variant="outline"
						className="w-full"
						onClick={handleGoToLogin}
					>
						{t("auth.goToLogin")}
					</Button>
				</div>
			</AuthLayout>
		);
	}

	return (
		<AuthLayout
			title={title ?? t("auth.completeRegistration")}
			description={description ?? t("auth.createAccountDescription")}
			logo={logo}
			className="qa-accept-invite-page"
		>
			<AcceptInviteForm
				onSubmit={handleSubmit}
				email={invitationData?.email ?? ""}
				error={error}
				minPasswordLength={minPasswordLength}
			/>
		</AuthLayout>
	);
}
