/**
 * Login Page
 *
 * Default login page that uses AuthLayout and LoginForm.
 * Integrates with authClient from AdminProvider context.
 *
 * Automatically redirects to setup page if no users exist.
 */

import * as React from "react";
import { useAuthClient } from "../../hooks/use-auth";
import { useSetupStatus } from "../../hooks/use-setup-status";
import {
  selectBasePath,
  selectBrandName,
  selectNavigate,
  useAdminStore,
} from "../../runtime/provider";
import { AuthLayout } from "../auth/auth-layout";
import { LoginForm, type LoginFormValues } from "../auth/login-form";

export interface LoginPageProps {
  /**
   * Title shown on the login page
   * @default "Sign in"
   */
  title?: string;

  /**
   * Description shown below the title
   * @default "Enter your credentials to access the admin panel"
   */
  description?: string;

  /**
   * Logo component to show above the form
   */
  logo?: React.ReactNode;

  /**
   * Path to redirect after successful login
   * @default basePath (e.g., "/admin")
   */
  redirectTo?: string;

  /**
   * Path to forgot password page
   * @default "{basePath}/forgot-password"
   */
  forgotPasswordPath?: string;

  /**
   * Path to sign up page (if enabled)
   */
  signUpPath?: string;

  /**
   * Show forgot password link
   * @default true
   */
  showForgotPassword?: boolean;

  /**
   * Show sign up link
   * @default false
   */
  showSignUp?: boolean;
}

/**
 * Default login page component.
 *
 * Uses authClient from AdminProvider to handle authentication.
 * Automatically redirects to setup page if no users exist.
 *
 * @example
 * ```tsx
 * // In your admin config
 * const admin = qa<App>()
 *   .use(adminModule)
 *   .pages({
 *     login: page("login", { component: LoginPage }).path("/login"),
 *   })
 * ```
 */
export function LoginPage({
  title = "Sign in",
  description = "Enter your credentials to access the admin panel",
  logo,
  redirectTo,
  forgotPasswordPath,
  signUpPath,
  showForgotPassword = true,
  showSignUp = false,
}: LoginPageProps) {
  const authClient = useAuthClient();
  const navigate = useAdminStore(selectNavigate);
  const basePath = useAdminStore(selectBasePath);
  const brandName = useAdminStore(selectBrandName);

  const [error, setError] = React.useState<string | null>(null);

  // Check if setup is required (no users exist)
  const { data: setupStatus, isLoading: isCheckingSetup } = useSetupStatus();

  // Redirect to setup page if no users exist
  React.useEffect(() => {
    if (!isCheckingSetup && setupStatus && setupStatus.required) {
      navigate(`${basePath}/setup`);
    }
  }, [isCheckingSetup, setupStatus, navigate, basePath]);

  const handleSubmit = async (values: LoginFormValues) => {
    setError(null);

    const successRedirect = redirectTo !== undefined ? redirectTo : basePath;

    try {
      const result = await authClient.signIn.email({
        email: values.email,
        password: values.password,
      });

      if (result.error) {
        if (result.error.message) {
          setError(result.error.message);
        } else {
          setError("Invalid credentials");
        }
        return;
      }

      // Redirect on success
      navigate(successRedirect);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An error occurred");
      }
    }
  };

  const handleForgotPasswordClick = () => {
    navigate(forgotPasswordPath ?? `${basePath}/forgot-password`);
  };

  const handleSignUpClick = () => {
    if (signUpPath) {
      navigate(signUpPath);
    }
  };

  return (
    <AuthLayout
      title={title}
      description={description}
      logo={logo ?? <DefaultLogo brandName={brandName} />}
    >
      <LoginForm
        onSubmit={handleSubmit}
        onForgotPasswordClick={handleForgotPasswordClick}
        onSignUpClick={handleSignUpClick}
        showForgotPassword={showForgotPassword}
        showSignUp={showSignUp}
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

export default LoginPage;

