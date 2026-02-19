/**
 * Reset Password Page
 *
 * Default reset password page that uses AuthLayout and ResetPasswordForm.
 * Integrates with authClient from AdminProvider context.
 */

import * as React from "react";
import { Button } from "../../components/ui/button";
import { useAuthClient } from "../../hooks/use-auth";
import {
  selectBasePath,
  selectBrandName,
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
  title = "Reset password",
  description = "Enter your new password",
  logo,
  loginPath,
  minPasswordLength = 8,
  getToken,
}: ResetPasswordPageProps) {
  const authClient = useAuthClient();
  const navigate = useAdminStore(selectNavigate);
  const basePath = useAdminStore(selectBasePath);
  const brandName = useAdminStore(selectBrandName);

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
        setError(result.error.message || "Failed to reset password");
        return;
      }

      // Success is handled by the form (shows success message)
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    }
  };

  const handleBackToLoginClick = () => {
    navigate(loginPath ?? `${basePath}/login`);
  };

  // Show error if no token
  if (!token) {
    return (
      <AuthLayout
        title="Invalid Link"
        description="The password reset link is invalid or has expired."
        logo={logo ?? <DefaultLogo brandName={brandName} />}
      >
        <div className="space-y-4 text-center">
          <p className="text-muted-foreground text-sm">
            Please request a new password reset link.
          </p>
          <Button type="button" variant="link" onClick={handleBackToLoginClick}>
            Back to login
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={title}
      description={description}
      logo={logo ?? <DefaultLogo brandName={brandName} />}
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

function DefaultLogo({ brandName }: { brandName: string }) {
  return (
    <div className="text-center">
      <h1 className="text-xl font-bold">{brandName}</h1>
    </div>
  );
}

export default ResetPasswordPage;
