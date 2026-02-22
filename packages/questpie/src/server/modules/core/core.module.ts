import { assetsCollection } from "#questpie/server/collection/defaults/assets.js";
import {
	accountsCollection,
	apiKeysCollection,
	sessionsCollection,
	usersCollection,
	verificationsCollection,
} from "#questpie/server/collection/defaults/auth.js";
import { QuestpieBuilder } from "#questpie/server/config/builder.js";
import { coreAuthOptions } from "#questpie/server/integrated/auth/index.js";

export const createCoreModule = () =>
	QuestpieBuilder.empty("core")
		.collections({
			assets: assetsCollection,
			user: usersCollection,
			session: sessionsCollection,
			account: accountsCollection,
			verification: verificationsCollection,
			apikey: apiKeysCollection,
		})
		.auth(coreAuthOptions);
