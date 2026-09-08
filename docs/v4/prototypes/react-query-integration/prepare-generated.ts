import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
	renderClientContract,
	renderCodecType,
} from "../../../../packages/compiler/src/runtime/client";
import { projectRealtimeWireContract } from "../../../../packages/compiler/src/runtime/realtime-wire";
import { instrumentClient } from "./render-projection";
import { contextCodec, resources } from "./task-contract.fixture";

const directory = join(import.meta.dir, "generated");
await mkdir(directory, { recursive: true });
await Bun.write(
	join(directory, "app.ts"),
	`export type AppContextInput = ${renderCodecType(contextCodec)};\n`,
);
const rawClient = renderClientContract(resources, {
	application: "application:react-query-proof",
	clientContractDigest: "1".repeat(64),
	httpContractDigest: "2".repeat(64),
	contextCodec,
});
await Bun.write(join(directory, "raw-client.ts"), rawClient);
await Bun.write(
	join(directory, "client.ts"),
	instrumentClient(rawClient, resources),
);
await Bun.write(
	join(directory, "client.react-query.ts"),
	`import { bindProjection, type BindingOptions } from "../query-adapter";\nimport { getClientProjection, type GeneratedClientScope } from "./client";\nimport type { QueryClient } from "@tanstack/query-core";\nexport function createQueryAdapter(scope: GeneratedClientScope, cache: QueryClient, options?: BindingOptions) { return bindProjection(getClientProjection(scope), cache, options); }\n`,
);
console.log(
	"Generated raw client and proof-instrumented sibling from the same Task IR",
);

const realtime = projectRealtimeWireContract({
	application: "application:react-query-proof",
	clientContractDigest: "1".repeat(64),
	operationHttpContractDigest: "2".repeat(64),
	resources,
	watchableQueries: ["query:tasks.detail"],
});
const liveClient = renderClientContract(resources, {
	application: realtime.application,
	clientContractDigest: realtime.clientContractDigest,
	httpContractDigest: realtime.operationHttpContractDigest,
	contextCodec,
	realtime,
});
await Bun.write(
	join(directory, "live-client.ts"),
	instrumentClient(
		liveClient,
		resources,
		realtime.watchableQueries.map(({ identity }) => identity),
	),
);
await Bun.write(
	join(directory, "live-client.react-query.ts"),
	`import { bindProjection, type BindingOptions } from "../query-adapter";\nimport { getClientProjection, type GeneratedClientScope } from "./live-client";\nimport type { QueryClient } from "@tanstack/query-core";\nexport function createQueryAdapter(scope: GeneratedClientScope, cache: QueryClient, options?: BindingOptions) { return bindProjection(getClientProjection(scope), cache, options); }\n`,
);
