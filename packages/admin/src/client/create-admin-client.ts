/**
 * createAdminClient — typed CMS client preconfigured for admin SPA usage.
 *
 * Wraps `createClient` from `questpie/client` and auto-injects the
 * `X-Questpie-Admin` request header on every outbound call. Server-side
 * `isAdminRequest()` (and any access rule that uses it) can then branch
 * on the header instead of relying on URL prefix matching.
 *
 * Use this for the client passed to `<AdminLayoutProvider client={...}>`.
 * Keep your public/frontend client as plain `createClient` — that one
 * MUST NOT inject the admin header.
 */

import {
	createClient,
	type QuestpieApp,
	type QuestpieClient,
	type QuestpieClientConfig,
} from "questpie/client";

import { withAdminRequestHeader } from "../shared/preview-utils.js";

export function createAdminClient<TApp extends QuestpieApp>(
	config: QuestpieClientConfig,
): QuestpieClient<TApp> {
	return createClient<TApp>({
		...config,
		fetch: withAdminRequestHeader(config.fetch),
	});
}
