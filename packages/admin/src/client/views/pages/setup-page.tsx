/**
 * Setup Page
 *
 * Default setup page for creating the first admin account.
 * Uses AuthLayout and SetupForm, integrates with client from AdminProvider context.
 */

import * as React from "react";
import {
  selectBasePath,
  selectBrandName,
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
 * const admin = qa<AppCMS>()
 *   .use(coreAdminModule)
 *   .pages({
 *     setup: page("setup", { component: SetupPage }).path("/setup"),
 *   })
 * ```
 */
export function SetupPage({
  title = "Welcome",
  description = "Create your admin account to get started",
  logo,
  redirectTo,
  loginPath,
  showLoginLink = true,
}: SetupPageProps) {
  const client = useAdminStore(selectClient);
  const navigate = useAdminStore(selectNavigate);
  const basePath = useAdminStore(selectBasePath);
  const brandName = useAdminStore(selectBrandName);

  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async (values: SetupFormValues) => {
    setError(null);

    try {
      const result = await (client as any).rpc.createFirstAdmin({
        email: values.email,
        password: values.password,
        name: values.name,
      });

      if (!result.success) {
        setError(result.error ?? "Failed to create admin account");
        return;
      }

      // Redirect to login on success
      navigate(redirectTo ?? `${basePath}/login`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    }
  };

  const handleLoginClick = () => {
    navigate(loginPath ?? `${basePath}/login`);
  };

  return (
    <AuthLayout
      title={title}
      description={description}
      logo={logo ?? <DefaultLogo brandName={brandName} />}
      footer={
        showLoginLink && (
          <p className="text-muted-foreground text-center text-xs">
            Already have an account?{" "}
            <button
              type="button"
              onClick={handleLoginClick}
              className="text-primary hover:underline"
            >
              Sign in
            </button>
          </p>
        )
      }
    >
      <SetupForm onSubmit={handleSubmit} error={error} />
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

export default SetupPage;
