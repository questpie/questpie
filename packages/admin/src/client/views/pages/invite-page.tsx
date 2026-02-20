/**
 * Invite Page
 *
 * Page for admins to invite new users.
 * Uses Better Auth's admin plugin for invitations.
 */

import * as React from "react";
import { useAuthClient } from "../../hooks/use-auth";
import {
  selectBasePath,
  selectBrandName,
  useAdminStore,
} from "../../runtime/provider";
import { AuthLayout } from "../auth/auth-layout";
import { InviteForm, type InviteFormValues } from "../auth/invite-form";

interface InvitePageProps {
  /**
   * Title shown on the invite page
   * @default "Invite User"
   */
  title?: string;

  /**
   * Description shown below the title
   * @default "Send an invitation to add a new user"
   */
  description?: string;

  /**
   * Logo component to show above the form
   */
  logo?: React.ReactNode;

  /**
   * Available roles for selection
   * @default [{ value: "admin", label: "Admin" }, { value: "user", label: "User" }]
   */
  roles?: Array<{ value: string; label: string }>;

  /**
   * Default role for new users
   * @default "user"
   */
  defaultRole?: string;

  /**
   * Show custom message field
   * @default true
   */
  showMessage?: boolean;

  /**
   * Callback when invitation is sent successfully
   */
  onSuccess?: (email: string) => void;
}

/**
 * Default invite page component.
 *
 * Uses authClient from AdminProvider to send invitations.
 * Requires Better Auth admin plugin.
 *
 * @example
 * ```tsx
 * // In your admin config
 * const admin = qa<App>()
 *   .use(adminStarterModule)
 *   .pages({
 *     invite: page("invite", { component: InvitePage }).path("/invite"),
 *   })
 * ```
 */
export function InvitePage({
  title = "Invite User",
  description = "Send an invitation to add a new user",
  logo,
  roles = [
    { value: "admin", label: "Admin" },
    { value: "user", label: "User" },
  ],
  defaultRole = "user",
  showMessage = true,
  onSuccess,
}: InvitePageProps) {
  const authClient = useAuthClient();
  const brandName = useAdminStore(selectBrandName);

  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const handleSubmit = async (values: InviteFormValues) => {
    setError(null);
    setSuccess(null);

    try {
      // Use Better Auth admin plugin to create invitation
      const result = await authClient.admin.createInvitation({
        email: values.email,
        role: values.role,
      });

      if (result.error) {
        if (result.error.message) {
          setError(result.error.message);
        } else {
          setError("Failed to send invitation");
        }
        return;
      }

      setSuccess(`Invitation sent to ${values.email}`);
      if (onSuccess) {
        onSuccess(values.email);
      }
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An error occurred");
      }
    }
  };

  return (
    <AuthLayout
      title={title}
      description={description}
      logo={logo ?? <DefaultLogo brandName={brandName} />}
    >
      <InviteForm
        onSubmit={handleSubmit}
        roles={roles}
        defaultRole={defaultRole}
        showMessage={showMessage}
        error={error}
        success={success}
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

export default InvitePage;

