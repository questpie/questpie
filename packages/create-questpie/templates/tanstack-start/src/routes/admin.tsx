import { AdminLayoutProvider } from "@questpie/admin/client";
import {
  createFileRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
  useLocation,
} from "@tanstack/react-router";
import { authClient } from "~/lib/auth-client";
import { client } from "~/lib/client";
import { queryClient } from "~/lib/query-client";
import { admin } from "~/questpie/admin/admin";

import adminCss from "../admin.css?url";

function AdminLink({
  to,
  className,
  children,
  activeProps,
}: {
  to: string;
  className?: string;
  children: React.ReactNode;
  activeProps?: { className?: string };
}) {
  return (
    <Link to={to} className={className} activeProps={activeProps}>
      {children}
    </Link>
  );
}

export const Route = createFileRoute("/admin")({
  head: () => ({
    title: "Admin Panel",
    links: [{ rel: "stylesheet", href: adminCss }],
  }),
  component: AdminLayout,
});

function AdminLayout() {
  const location = useLocation();

  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        <AdminLayoutProvider
          admin={admin}
          client={client}
          queryClient={queryClient}
          authClient={authClient}
          LinkComponent={AdminLink}
          activeRoute={location.pathname}
          basePath="/admin"
          useServerTranslations
        >
          <Outlet />
        </AdminLayoutProvider>
        <Scripts />
      </body>
    </html>
  );
}
