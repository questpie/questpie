/**
 * OAuth Consent Page
 *
 * The `consentPage` the OAuth 2.1 provider (`@better-auth/oauth-provider`)
 * redirects to when a signed-in user must approve an OAuth client's requested
 * scopes (e.g. an MCP client). Minimal by MO1 decision #5 — a working consent
 * screen for v1; a fully branded page is a follow-up.
 *
 * Contract (verified against `@better-auth/oauth-provider@1.6.23`, which does
 * NOT export `getConsentHTML`):
 * - The provider redirects here with the SIGNED authorization query in the URL
 *   (`client_id`, `scope`, `redirect_uri`, `state`, … plus `sig`/`exp`/`ba_*`).
 *   We read `client_id` + `scope` straight from `window.location.search`.
 * - The client's display name comes from `GET /oauth2/public-client` (session
 *   -gated; consent always has a session).
 * - Allow / Deny POST to `POST /oauth2/consent` with `{ accept, oauth_query }`.
 *   `oauth_query` is the current page's signed search string; the provider's
 *   `before` middleware re-verifies its signature and rebuilds the pending
 *   request, then Allow persists a consent record and returns `{ redirect_uri }`
 *   we send the browser to (back to the client with an authorization code);
 *   Deny returns a `redirect_uri` carrying `error=access_denied`.
 * - Trusted clients (`skip_consent`) never reach this page — the provider skips
 *   consent server-side — so there is nothing to reimplement here.
 */

import { Icon } from "@iconify/react";
import * as React from "react";

import { Alert, AlertDescription } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { useAuthClientSafe } from "../../hooks/use-auth";
import { useTranslation } from "../../i18n/hooks";
import {
	describeScopes,
	type ScopeDescription,
} from "../../lib/oauth-scope-descriptions";
import {
	selectBasePath,
	selectNavigate,
	useAdminStore,
} from "../../runtime/provider";
import { AuthLayout } from "../auth/auth-layout";

/** Minimal shape of the better-auth client fields this page relies on. */
type ConsentAuthClient = {
	$fetch: (
		path: string,
		options?: Record<string, unknown>,
	) => Promise<{ data?: unknown; error?: { message?: string } | null }>;
};

/** Read the current signed OAuth authorization query from the page URL. */
function readOAuthQuery(): {
	clientId: string | null;
	rawScope: string | null;
	oauthQuery: string;
} {
	const search = typeof window !== "undefined" ? window.location.search : "";
	const params = new URLSearchParams(search);
	return {
		clientId: params.get("client_id"),
		rawScope: params.get("scope"),
		// Strip the leading "?" — the provider expects the bare query string.
		oauthQuery: search.startsWith("?") ? search.slice(1) : search,
	};
}

function ScopeList({ scopes }: { scopes: ScopeDescription[] }) {
	return (
		<ul className="qa-oauth-consent__scopes space-y-2">
			{scopes.map((scope) => (
				<li
					key={scope.scope}
					className="flex items-start gap-2 text-sm"
					title={scope.scope}
				>
					<Icon
						icon="ph:check-circle-duotone"
						className="text-primary mt-0.5 size-4 shrink-0"
						aria-hidden
					/>
					<span>{scope.label}</span>
				</li>
			))}
		</ul>
	);
}

export interface OAuthConsentPageProps {
	/** Logo shown above the card. */
	logo?: React.ReactNode;
}

/**
 * Default OAuth consent page component.
 */
export function OAuthConsentPage({ logo }: OAuthConsentPageProps) {
	const { t } = useTranslation();
	const authClient = useAuthClientSafe<ConsentAuthClient>();
	const navigate = useAdminStore(selectNavigate);
	const basePath = useAdminStore(selectBasePath);

	const { clientId, rawScope, oauthQuery } = React.useMemo(readOAuthQuery, []);
	const scopes = React.useMemo(() => describeScopes(rawScope), [rawScope]);

	const [clientName, setClientName] = React.useState<string | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [submitting, setSubmitting] = React.useState<"allow" | "deny" | null>(
		null,
	);

	// Fetch the client's display name (falls back to the client id).
	React.useEffect(() => {
		if (!authClient || !clientId) return;
		let active = true;
		(async () => {
			try {
				const { data } = await authClient.$fetch("/oauth2/public-client", {
					method: "GET",
					query: { client_id: clientId },
				});
				if (!active) return;
				const name = (data as { client_name?: string } | null)?.client_name;
				if (name) setClientName(name);
			} catch {
				// Non-fatal — we render the client id instead of a friendly name.
			}
		})();
		return () => {
			active = false;
		};
	}, [authClient, clientId]);

	const decide = React.useCallback(
		async (accept: boolean) => {
			if (!authClient) {
				setError(t("oauth.consentNoAuthClient"));
				return;
			}
			setError(null);
			setSubmitting(accept ? "allow" : "deny");
			try {
				const { data, error: fetchError } = await authClient.$fetch(
					"/oauth2/consent",
					{
						method: "POST",
						body: { accept, oauth_query: oauthQuery },
					},
				);
				if (fetchError) {
					setError(fetchError.message ?? t("oauth.consentFailed"));
					setSubmitting(null);
					return;
				}
				const redirectUri = (data as { redirect_uri?: string } | null)
					?.redirect_uri;
				if (redirectUri && typeof window !== "undefined") {
					window.location.href = redirectUri;
					return;
				}
				// No redirect target returned — surface a generic error.
				setError(t("oauth.consentFailed"));
				setSubmitting(null);
			} catch (err) {
				setError(err instanceof Error ? err.message : t("oauth.consentFailed"));
				setSubmitting(null);
			}
		},
		[authClient, oauthQuery, t],
	);

	const displayClient = clientName ?? clientId ?? t("oauth.consentUnknownApp");

	// Malformed entry (no client_id in the URL) — nothing to consent to.
	if (!clientId) {
		return (
			<AuthLayout
				title={t("oauth.consentTitle")}
				logo={logo}
				className="qa-oauth-consent-page"
			>
				<div className="space-y-4">
					<Alert variant="destructive">
						<AlertDescription>
							{t("oauth.consentInvalidRequest")}
						</AlertDescription>
					</Alert>
					<Button
						variant="outline"
						className="w-full"
						onClick={() => navigate(basePath)}
					>
						{t("oauth.consentBackToAdmin")}
					</Button>
				</div>
			</AuthLayout>
		);
	}

	return (
		<AuthLayout
			title={t("oauth.consentTitle")}
			logo={logo}
			className="qa-oauth-consent-page"
		>
			<div className="qa-oauth-consent space-y-5">
				<div className="space-y-1">
					<h1 className="text-lg font-semibold">{t("oauth.consentTitle")}</h1>
					<p className="text-muted-foreground text-sm">
						{t("oauth.consentIntro", { app: displayClient })}
					</p>
				</div>

				{scopes.length > 0 ? (
					<div className="space-y-2">
						<p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
							{t("oauth.consentPermissionsLabel")}
						</p>
						<ScopeList scopes={scopes} />
					</div>
				) : (
					<p className="text-muted-foreground text-sm">
						{t("oauth.consentNoScopes")}
					</p>
				)}

				{error && (
					<Alert variant="destructive">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}

				<div className="flex flex-col gap-2 sm:flex-row-reverse">
					<Button
						className="w-full"
						disabled={submitting !== null}
						onClick={() => decide(true)}
					>
						{submitting === "allow" && (
							<Icon
								icon="ph:circle-notch"
								className="size-4 animate-spin"
								aria-hidden
							/>
						)}
						{t("oauth.consentAllow")}
					</Button>
					<Button
						variant="outline"
						className="w-full"
						disabled={submitting !== null}
						onClick={() => decide(false)}
					>
						{t("oauth.consentDeny")}
					</Button>
				</div>
			</div>
		</AuthLayout>
	);
}
