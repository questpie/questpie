import type { PgDatabase } from "drizzle-orm/pg-core";

import { runtimeConfig } from "../../src/server/config/create-app.js";
import type {
	DrizzleClientFromQuestpieConfig,
	QuestpieConfig,
} from "../../src/server/config/types.js";
import type { Equal, Expect } from "./type-test-utils.js";

type CustomDb = PgDatabase<any, Record<string, never>, any> & {
	customMethod: () => "custom";
};

declare const customDb: CustomDb;

const prebuiltConfig = runtimeConfig({
	db: {
		drizzle: customDb,
		connectionString: "postgres://direct.example/db",
	},
});

type _prebuiltConfigPreservesDb = Expect<
	Equal<(typeof prebuiltConfig)["db"]["drizzle"], CustomDb>
>;

type PrebuiltAppConfig = Omit<
	QuestpieConfig,
	"db" | "collections" | "globals"
> & {
	db: (typeof prebuiltConfig)["db"];
	collections: {};
	globals: {};
};

type _prebuiltAppDbPreservesCustomClient = Expect<
	Equal<DrizzleClientFromQuestpieConfig<PrebuiltAppConfig>, CustomDb>
>;

const factoryConfig = runtimeConfig({
	db: {
		create: () => ({
			drizzle: customDb,
			connectionString: "postgres://direct.example/db",
			close: () => {},
		}),
	},
});

type FactoryAppConfig = Omit<
	QuestpieConfig,
	"db" | "collections" | "globals"
> & {
	db: (typeof factoryConfig)["db"];
	collections: {};
	globals: {};
};

type _factoryAppDbPreservesCustomClient = Expect<
	Equal<DrizzleClientFromQuestpieConfig<FactoryAppConfig>, CustomDb>
>;
