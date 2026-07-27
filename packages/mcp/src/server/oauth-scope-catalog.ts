import type {
	OAuthScopeCatalogContributor,
	OAuthScopeCatalogContributorApp,
	Questpie,
} from "questpie";

import { getAppMcpRelease } from "./release.js";

export const mcpOAuthScopeCatalog: OAuthScopeCatalogContributor = (
	contributorApp: OAuthScopeCatalogContributorApp,
) => {
	const app = contributorApp as Questpie<any>;
	const oauth = getAppMcpRelease(app).catalog.oauth;
	return {
		scopes: [...oauth.scopes],
		scopesSupported: [...oauth.scopesSupported],
	};
};
