import type { RealtimeConfig } from "#questpie/server/modules/core/integrated/realtime/types.js";

import { runtimeConfig } from "../../src/server/config/create-app.js";
import type { Equal, Expect } from "./type-test-utils.js";

const realtimeEnabled = runtimeConfig({
	db: { url: "postgres://localhost/test" },
	realtime: true,
});

type _realtimeTrueResolvesToConfig = Expect<
	Equal<typeof realtimeEnabled.realtime, RealtimeConfig>
>;

runtimeConfig({
	db: { url: "postgres://localhost/test" },
	realtime: {
		// @ts-expect-error realtime rollout modes were removed in QuestPie 4
		rollout: { mode: "dual" },
	},
});

runtimeConfig({
	db: { url: "postgres://localhost/test" },
	realtime: {
		// @ts-expect-error realtime.adapter was removed in QuestPie 4
		adapter: {},
	},
});
