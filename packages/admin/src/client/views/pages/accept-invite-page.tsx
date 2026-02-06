/**
 * Accept Invite Page
 *
 * Page for new users to complete registration after receiving invitation.
 * Uses Better Auth's admin plugin for invitation acceptance.
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
  AcceptInviteForm,
  type AcceptInviteFormValues,
} from "../auth/accept-invite-form";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/spinner";
import { Icon } from "@iconify/react";

export interface AcceptInvitePageProps {
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

type InvitationState =
  | { status: "loading" }
  | { status: "valid"; email: string; role?: string }
  | { status: "invalid"; message: string };

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
  title = "Complete Registration",
  description = "Create your account to get started",
  logo,
  redirectTo,
  loginPath,
  minPasswordLength = 8,
}: AcceptInvitePageProps) {
  const authClient = useAuthClient();
  const navigate = useAdminStore(selectNavigate);
  const basePath = useAdminStore(selectBasePath);
  const brandName = useAdminStore(selectBrandName);

  const [invitation, setInvitation] = React.useState<InvitationState>({
    status: "loading",
  });
  const [error, setError] = React.useState<string | null>(null);

  // Validate token on mount
  React.useEffect(() => {
    const validateToken = async () => {
      try {
        const result = await authClient.admin.getInvitation({
          query: { token },
        });

        if (result.error || !result.data) {
          setInvitation({
            status: "invalid",
            message: result.error?.message || "Invalid or expired invitation",
          });
          return;
        }

        setInvitation({
          status: "valid",
          email: result.data.email,
          role: result.data.role,
        });
      } catch (err) {
        setInvitation({
          status: "invalid",
          message: "Invalid or expired invitation",
        });
      }
    };

    validateToken();
  }, [token, authClient]);

  const handleSubmit = async (values: AcceptInviteFormValues) => {
    setError(null);

    try {
      const result = await authClient.admin.acceptInvitation({
        token,
        name: values.name,
        password: values.password,
      });

      if (result.error) {
        setError(result.error.message || "Failed to create account");
        return;
      }

      // Redirect on success
      navigate(redirectTo ?? basePath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    }
  };

  const handleGoToLogin = () => {
    navigate(loginPath ?? `${basePath}/login`);
  };

  // Loading state
  if (invitation.status === "loading") {
    return (
      <AuthLayout
        title="Validating Invitation"
        description="Please wait..."
        logo={logo ?? <DefaultLogo brandName={brandName} />}
      >
        <div className="flex justify-center py-8">
          <Spinner className="size-8" />
        </div>
      </AuthLayout>
    );
  }

  // Invalid token state
  if (invitation.status === "invalid") {
    return (
      <AuthLayout
        title="Invalid Invitation"
        description="This invitation link is no longer valid"
        logo={logo ?? <DefaultLogo brandName={brandName} />}
      >
        <div className="space-y-4">
          <Alert variant="destructive">
            <Icon icon="ph:warning-circle" />
            <AlertDescription>{invitation.message}</AlertDescription>
          </Alert>
          <p className="text-muted-foreground text-center text-sm">
            The invitation may have expired or already been used. Please contact
            your administrator for a new invitation.
          </p>
          <Button
            variant="outline"
            className="w-full"
            onClick={handleGoToLogin}
          >
            Go to Login
          </Button>
        </div>
      </AuthLayout>
    );
  }

  // Valid token - show registration form
  return (
    <AuthLayout
      title={title}
      description={description}
      logo={logo ?? <DefaultLogo brandName={brandName} />}
    >
      <AcceptInviteForm
        onSubmit={handleSubmit}
        email={invitation.email}
        error={error}
        minPasswordLength={minPasswordLength}
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

export default AcceptInvitePage;
