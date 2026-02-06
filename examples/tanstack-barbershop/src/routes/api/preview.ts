/**
 * Preview API Route
 *
 * Handles preview token verification and sets draft mode cookie.
 * The token was minted by the admin via the mintPreviewToken RPC.
 *
 * Flow:
 * 1. Admin calls mintPreviewToken RPC -> gets signed token with path
 * 2. Admin iframe loads /api/preview?token=xxx
 * 3. This route verifies token, sets __draft_mode cookie, redirects to path
 * 4. Page route checks cookie and loads drafts if present
 */

import { createDraftModeCookie } from "@questpie/admin/shared";
import { createPreviewTokenVerifier } from "@questpie/admin/server";
import { createFileRoute } from "@tanstack/react-router";

// Create verifier once (reads secret from env)
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
              "Set-Cookie": createDraftModeCookie(false), // Max-Age=0
              "Cache-Control": "private, no-store",
            },
          });
        }

        // Handle preview enable (normal flow)
        const token = url.searchParams.get("token");

        if (!token) {
          return new Response("Missing token parameter", { status: 400 });
        }

        // Verify the token (checks signature and expiration)
        const payload = verifyPreviewToken(token);

        if (!payload) {
          return new Response("Invalid or expired preview token", {
            status: 401,
          });
        }

        // Set draft mode cookie and redirect to the path from token
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
