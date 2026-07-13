import type {
	RuntimeConfig,
	RuntimeConfigExtensions,
} from "#questpie/server/config/module-types.js";
import type { Questpie } from "#questpie/server/config/questpie.js";
import type { QuestpieConfig } from "#questpie/server/config/types.js";

import type { Equal, Expect } from "./type-test-utils.js";

declare module "#questpie/server/config/module-types.js" {
	interface RuntimeConfigExtensions {
		contractExtension?: {
			enabled: boolean;
			mode: "safe" | "fast";
		};
	}
}

type ExpectedExtension = {
	enabled: boolean;
	mode: "safe" | "fast";
};

type _runtimeConfigExtensionIsAugmentable = Expect<
	Equal<
		RuntimeConfigExtensions["contractExtension"],
		ExpectedExtension | undefined
	>
>;
type _runtimeConfigIncludesExtension = Expect<
	Equal<RuntimeConfig["contractExtension"], ExpectedExtension | undefined>
>;
type AppState = NonNullable<Questpie<QuestpieConfig>["state"]>;
type _appStateIncludesRuntimeExtension = Expect<
	Equal<AppState["contractExtension"], ExpectedExtension | undefined>
>;
