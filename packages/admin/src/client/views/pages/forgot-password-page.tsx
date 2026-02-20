/**
 * Forgot Password Page
 *
 * Default forgot password page that uses AuthLayout and ForgotPasswordForm.
 * Integrates with authClient from AdminProvider context.
 */

import * as React from "react";
import { useAuthClient } from "../../hooks/use-auth";
import {
  selectBasePath,
  selectBrandName,
  selectNavigate,
  useAdminStore,
} from "../../runtime/provider";
import { AuthLayout } from "../auth/auth-layout";
import {
  ForgotPasswordForm,
  type ForgotPasswordFormValues,
} from "../auth/forgot-password-form";

export interface ForgotPasswordPageProps {
  /**
   * Title shown on the page
   * @default "Forgot password"
   */
  title?: string;

  /**
   * Description shown below the title
   * @default "Enter your email to receive a password reset link"
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
   * URL to redirect to after password reset (included in email)
   * @default "{window.origin}{basePath}/reset-password"
   */
  resetPasswordRedirectUrl?: string;
}

/**
 * Default forgot password page component.
 *
 * Uses authClient from AdminProvider to handle password reset requests.
 *
 * @example
 * ```tsx
 * // In your admin config
 * const admin = qa<App>()
 *   .use(coreAdminModule)
 *   .pages({
 *     forgotPassword: page("forgot-password", { component: ForgotPasswordPage })
 *       .path("/forgot-password"),
 *   })
 * ```
 */
export function ForgotPasswordPage({
  title = "Forgot password",
  description = "Enter your email to receive a password reset link",
  logo,
  loginPath,
  resetPasswordRedirectUrl,
}: ForgotPasswordPageProps) {
  const authClient = useAuthClient();
  const navigate = useAdminStore(selectNavigate);
  const basePath = useAdminStore(selectBasePath);
  const brandName = useAdminStore(selectBrandName);

  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async (values: ForgotPasswordFormValues) => {
    setError(null);

    let redirectUrl: string;
    if (resetPasswordRedirectUrl !== undefined) {
      redirectUrl = resetPasswordRedirectUrl;
    } else {
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      redirectUrl = `${origin}${basePath}/reset-password`;
    }

    try {
      const result = await authClient.forgetPassword({
        email: values.email,
        redirectTo: redirectUrl,
      });

      if (result.error) {
        if (result.error.message) {
          setError(result.error.message);
        } else {
          setError("Failed to send reset email");
        }
        return;
      }

      // Success is handled by the form (shows success message)
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An error occurred");
      }
    }
  };

  const handleBackToLoginClick = () => {
    navigate(loginPath ?? `${basePath}/login`);
  };

  return (
    <AuthLayout
      title={title}
      description={description}
      logo={logo ?? <DefaultLogo brandName={brandName} />}
    >
      <ForgotPasswordForm
        onSubmit={handleSubmit}
        onBackToLoginClick={handleBackToLoginClick}
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


