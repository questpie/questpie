import { join, resolve } from "node:path";

import { compileApplication } from "../../../../packages/compiler/src/index";
import type { NormalizedResource } from "../../../../packages/compiler/src/types";
import { instrumentClient } from "./render-projection";

const directory = join(import.meta.dir, "generated", "support-desk");
const compiled = await compileApplication({
	applicationRoot: resolve(
		import.meta.dir,
		"../../../../fixtures/team-support-desk",
	),
	outputDirectory: directory,
});
const operations = JSON.parse(
	compiled.generatedFiles["operation-contracts.json"]!,
);
const http = JSON.parse(
	compiled.generatedFiles["operation-http-contract.json"]!,
);
const exposed = new Set(
	http.operations.map((operation: { identity: string }) => operation.identity),
);
const resources: Parameters<typeof instrumentClient>[1] = operations.operations
	.filter((operation: { identity: string }) => exposed.has(operation.identity))
	.map((operation: { identity: string } & NormalizedResource["contract"]) => ({
		identity: operation.identity,
		kind: operation.identity.slice(0, operation.identity.indexOf(":")),
		name: operation.identity.slice(operation.identity.indexOf(":") + 1),
		contract: { ...operation, exposure: "network" },
	}));
const queries = JSON.parse(compiled.generatedFiles["query-projection.json"]!);
const pages = queries.queries
	.filter(
		(query: {
			identity: string | null;
			template: { page: { kind: string } };
		}) =>
			query.identity !== null &&
			exposed.has(query.identity) &&
			query.template.page.kind === "forwardCursor",
	)
	.map(
		(query: {
			identity: string;
			template: { page: { after: { parameter: string } } };
		}) => ({
			identity: query.identity,
			after: query.template.page.after.parameter,
		}),
	);
const realtime = JSON.parse(
	compiled.generatedFiles["realtime-wire-contract.json"]!,
);
const watchable = realtime.watchableQueries.map(
	(query: { identity: string }) => query.identity,
);
const source = instrumentClient(
	compiled.generatedFiles["client.ts"]!,
	resources,
	watchable,
	pages,
).replace('from "../projection-contract"', 'from "../../projection-contract"');
await Bun.write(join(directory, "client.ts"), source);
await Bun.write(
	join(directory, "client.react-query.ts"),
	`import { bindProjection, type BindingOptions } from "../../query-adapter";
import { getClientProjection, type GeneratedClientScope } from "./client";
import type { QueryClient } from "@tanstack/query-core";
export function createQueryAdapter(scope: GeneratedClientScope, cache: QueryClient, options?: BindingOptions) { return bindProjection(getClientProjection(scope), cache, options); }
`,
);
console.log("Prepared pagination consumer from full Support Desk compilation");
