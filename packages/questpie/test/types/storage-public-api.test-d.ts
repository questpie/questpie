import type { Adapter, Files } from "files-sdk";
import { memory } from "files-sdk/memory";

import { runtimeConfig } from "#questpie/server/config/create-app.js";
import type {
	ResolvedRuntimeConfig,
	RuntimeConfig,
	RuntimeConfigInput,
} from "#questpie/server/config/module-types.js";
import type { Questpie } from "#questpie/server/config/questpie.js";
import type {
	DbConfig,
	QuestpieConfig,
	StorageAdapterConfig,
} from "#questpie/server/config/types.js";
import type { JsonRouteHandlerArgs } from "#questpie/server/routes/types.js";

import type { Equal, Expect, HasKey } from "./type-test-utils.js";

const adapter = memory();

const runtime = runtimeConfig({
	app: { url: "http://localhost:3000" },
	db: { url: "postgres://localhost/test" },
	storage: { adapter },
});

const legacyDriverRuntimeConfig = {
	app: { url: "http://localhost:3000" },
	db: { url: "postgres://localhost/test" },
	storage: { driver: {} },
};
// @ts-expect-error Removed storage registration shape must not compile.
runtimeConfig(legacyDriverRuntimeConfig);

const legacyFilesRuntimeConfig = {
	app: { url: "http://localhost:3000" },
	db: { url: "postgres://localhost/test" },
	storage: { files: {} },
};
// @ts-expect-error Removed storage registration shape must not compile.
runtimeConfig(legacyFilesRuntimeConfig);

type RuntimeStorage = typeof runtime.storage;
type _runtimeStorageKeepsAdapter = Expect<
	Equal<RuntimeStorage["adapter"], typeof adapter>
>;

type KnownRuntimeConfig = RuntimeConfig<
	DbConfig,
	StorageAdapterConfig<typeof adapter>
>;
type _runtimeConfigKeepsStaticAdapter = Expect<
	Equal<NonNullable<KnownRuntimeConfig["storage"]>["adapter"], typeof adapter>
>;

const knownRuntimeInput = {
	app: { url: "http://localhost:3000" },
	db: { url: "postgres://localhost/test" },
	storage: { adapter },
} satisfies RuntimeConfigInput<DbConfig, StorageAdapterConfig<typeof adapter>>;

type _runtimeConfigInputKeepsStaticAdapter = Expect<
	Equal<typeof knownRuntimeInput.storage.adapter, typeof adapter>
>;

declare const envAdapter: Adapter;
const envRuntime = runtimeConfig({
	app: { url: "http://localhost:3000" },
	db: { url: "postgres://localhost/test" },
	storage: { adapter: envAdapter },
});

type EnvAppConfig = Omit<
	QuestpieConfig,
	"app" | "db" | "collections" | "storage"
> & {
	app: (typeof envRuntime)["app"];
	db: (typeof envRuntime)["db"];
	collections: {};
	storage: (typeof envRuntime)["storage"];
};

type _runtimeEnvAdapterStorage = Expect<
	Equal<Questpie<EnvAppConfig>["storage"], Files<Adapter>>
>;
type _resolvedRuntimeConfigKeepsStorage = Expect<
	Equal<
		ResolvedRuntimeConfig<typeof knownRuntimeInput>["storage"],
		(typeof knownRuntimeInput)["storage"]
	>
>;

type AppConfig = Omit<
	QuestpieConfig,
	"app" | "db" | "collections" | "storage"
> & {
	app: (typeof runtime)["app"];
	db: (typeof runtime)["db"];
	collections: {};
	storage: (typeof runtime)["storage"];
};

type AppStorage = Questpie<AppConfig>["storage"];
type _appStorageIsFiles = Expect<Equal<AppStorage, Files<typeof adapter>>>;
type _appStorageHasUpload = Expect<Equal<HasKey<AppStorage, "upload">, true>>;
type _appStorageHasDownload = Expect<
	Equal<HasKey<AppStorage, "download">, true>
>;
type _appStorageHasUse = Expect<Equal<HasKey<AppStorage, "use">, false>>;
type _generatedAppConfigHasStorage = Expect<
	Equal<AppConfig["storage"], (typeof runtime)["storage"]>
>;

declare const appStorage: AppStorage;
appStorage.upload("contract.txt", "contract");
appStorage.download("contract.txt");
appStorage.head("contract.txt");
appStorage.exists("contract.txt");
appStorage.delete("contract.txt");
appStorage.copy("from.txt", "to.txt");
appStorage.move("from.txt", "to.txt");
appStorage.list({ prefix: "uploads/" });
appStorage.listAll({ prefix: "uploads/" });
appStorage.url("contract.txt");
appStorage.signedUploadUrl("contract.txt", { expiresIn: 60 });
// @ts-expect-error Direct Files storage has no legacy disk selector.
appStorage.use();

type GeneratedAppContext = {
	storage: AppStorage;
};

type GeneratedRouteContext = GeneratedAppContext & JsonRouteHandlerArgs;
type _routeContextStorageIsFiles = Expect<
	Equal<GeneratedRouteContext["storage"], AppStorage>
>;

declare const routeContext: GeneratedRouteContext;
routeContext.storage.upload("route.txt", "route");
routeContext.storage.exists("route.txt");
// @ts-expect-error Generated route context storage must not expose `.use()`.
routeContext.storage.use();

type GeneratedServiceContext = GeneratedAppContext &
	Questpie.ServiceCreateContext;
type _serviceContextStorageIsFiles = Expect<
	Equal<GeneratedServiceContext["storage"], AppStorage>
>;

declare const serviceContext: GeneratedServiceContext;
serviceContext.storage.download("service.txt");
// @ts-expect-error Generated service context storage must not expose `.use()`.
serviceContext.storage.use();

type GeneratedJobContext = GeneratedAppContext & Questpie.JobHandlerContext;
type _jobContextStorageIsFiles = Expect<
	Equal<GeneratedJobContext["storage"], AppStorage>
>;

declare const jobContext: GeneratedJobContext;
jobContext.storage.head("job.txt");
// @ts-expect-error Generated job context storage must not expose `.use()`.
jobContext.storage.use();
