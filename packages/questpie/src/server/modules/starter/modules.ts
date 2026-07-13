/**
 * Starter module dependencies.
 *
 * The starter bundles the OAuth 2.1 provider + OAuth tables by including
 * `oauthModule`, so every app built on the starter (directly or via
 * `adminModule`) is OAuth-MCP-ready with no extra wiring. A headless/custom-auth
 * app that does NOT use the starter can add `oauthModule` on its own.
 */
import oauthModule from "#questpie/server/modules/oauth/.generated/module.js";

export default [oauthModule] as const;
