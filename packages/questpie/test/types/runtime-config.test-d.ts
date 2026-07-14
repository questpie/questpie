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
		rollout: {
			mode: "dual",
			onComparison(result) {
				const seq: number = result.seq;
				const legacy: "accepted" | "rejected" = result.legacy;
				const equivalent: boolean = result.equivalent;
				void [seq, legacy, equivalent];
			},
		},
	},
});

runtimeConfig({
	db: { url: "postgres://localhost/test" },
	realtime: {
		rollout: {
			// @ts-expect-error rollout mode is a closed compatibility contract
			mode: "canary",
		},
	},
});
