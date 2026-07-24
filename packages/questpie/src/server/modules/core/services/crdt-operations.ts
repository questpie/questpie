import type { Questpie } from "#questpie/server/config/questpie.js";
import { QUESTPIE_SCHEMA_INTROSPECTION_ENV } from "#questpie/server/db/postgres-version.js";
import {
	createQuestpieCrdtOperationalService,
	createUnavailableQuestpieCrdtOperationalService,
} from "#questpie/server/modules/core/integrated/crdt/server-service.js";
import { service } from "#questpie/server/services/define-service.js";
import { getEnv } from "#questpie/server/utils/env.js";

export default service({
	lifecycle: "singleton",
	create: async ({ app }) =>
		getEnv(QUESTPIE_SCHEMA_INTROSPECTION_ENV) === "1"
			? createUnavailableQuestpieCrdtOperationalService()
			: await createQuestpieCrdtOperationalService(
					app as unknown as Questpie<any>,
				),
	dispose: (instance) => instance.stop(),
});
