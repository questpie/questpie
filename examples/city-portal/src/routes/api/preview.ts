/**
 * Preview API Route
 *
 * Handles preview token verification and sets draft mode cookie.
 *
 * Flow:
 * 1. Admin calls mintPreviewToken RPC -> gets signed token with path
 * 2. Admin iframe loads /api/preview?token=xxx
 * 3. This route verifies token, sets __draft_mode cookie, redirects to path
 * 4. Page route checks cookie and loads drafts if present
 */

import { createPreviewTokenVerifier } from "@questpie/admin/server";
import { createDraftModeCookie } from "@questpie/admin/shared";
import { createFileRoute } from "@tanstack/react-router";

const verifyPreviewToken = createPreviewTokenVerifier();

export const Route = createFileRoute("/api/preview")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const url = new URL(request.url);
				const disable = url.searchParams.get("disable");

				// Handle preview disable (clear cookie)
				if (disable === "true") {
					return new Response(null, {
						status: 302,
						headers: {
							Location: "/",
							"Set-Cookie": createDraftModeCookie(false),
							"Cache-Control": "private, no-store",
						},
					});
				}

				// Handle preview enable
				const token = url.searchParams.get("token");

				if (!token) {
					return new Response("Missing token parameter", { status: 400 });
				}

				const payload = verifyPreviewToken(token);

				if (!payload) {
					return new Response("Invalid or expired preview token", {
						status: 401,
					});
				}

				return new Response(null, {
					status: 302,
					headers: {
						Location: payload.path,
						"Set-Cookie": createDraftModeCookie(true),
						"Cache-Control": "private, no-store",
					},
				});
			},
		},
	},
});
