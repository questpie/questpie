import { join } from "node:path";

import {
	renderClientContract,
	renderCodecType,
} from "../../../../packages/compiler/src/runtime/client";
import type { NormalizedResource } from "../../../../packages/compiler/src/types";
import { instrumentClient } from "./render-projection";
import { contextCodec, resources } from "./task-contract.fixture";

function replaceOnce(source: string, before: string, after: string): string {
	if (source.split(before).length !== 2)
		throw new Error("FACTORY_SEAM_RENDERER_CHANGED");
	return source.replace(before, after);
}

/** Isolated scaffolding; production will render directly from compiler inputs. */
export function renderFactoryScope(
	raw: string,
	operations: Parameters<typeof instrumentClient>[1],
	watchable: readonly string[] = [],
	pages: readonly { identity: string; after: string }[] = [],
): string {
	let source = instrumentClient(raw, operations, watchable, pages);
	source = replaceOnce(
		source,
		'from "../projection-contract"',
		`from ${JSON.stringify(join(import.meta.dir, "projection-contract"))}`,
	);
	source = replaceOnce(
		source,
		"export interface ClientProjection",
		"interface ClientProjection",
	);
	source = replaceOnce(
		source,
		"export function getClientProjection",
		"function getClientProjection",
	);
	source = replaceOnce(
		source,
		"export interface GeneratedClientScope {",
		"export interface GeneratedClientScope extends ClientScope<ClientProjection> {",
	);
	source = replaceOnce(
		source,
		"const generatedScope = Object.freeze({ context, queries: Object.freeze({",
		"const generatedScope = { context, queries: Object.freeze({",
	);
	source = replaceOnce(
		source,
		"}), withContext: scope });\n\t\tclientProjections.set(generatedScope, undefined);\n\t\treturn generatedScope;",
		"}), withContext: scope } as GeneratedClientScope;\n\t\tclientProjections.set(generatedScope, undefined);\n\t\tattachClientScope(generatedScope, () => getClientProjection(generatedScope));\n\t\treturn Object.freeze(generatedScope);",
	);
	return `import { attachClientScope, type ClientScope } from ${JSON.stringify(join(import.meta.dir, "factory-seam-contract"))};\n${source}`;
}

export async function prepareFactoryClients(directory: string): Promise<void> {
	await Bun.write(
		join(directory, "app.ts"),
		`export type AppContextInput = ${renderCodecType(contextCodec)};\n`,
	);
	await Bun.write(
		join(directory, "client.ts"),
		renderFactoryScope(
			renderClientContract(resources, {
				application: "application:react-query-proof",
				clientContractDigest: "1".repeat(64),
				httpContractDigest: "2".repeat(64),
				contextCodec,
			}),
			resources,
		),
	);
	// Read-only compiler artifacts from the already compiled parent fixture.
	// Never compile or overwrite the shared generated directory from this lane.
	const compiled = join(import.meta.dir, "generated/support-desk");
	const operations = await Bun.file(
		join(compiled, "operation-contracts.json"),
	).json();
	const http = await Bun.file(
		join(compiled, "operation-http-contract.json"),
	).json();
	const context = await Bun.file(
		join(compiled, "context-projection.json"),
	).json();
	const queries = await Bun.file(
		join(compiled, "query-projection.json"),
	).json();
	const exposed = new Set(
		http.operations.map(
			(operation: { identity: string }) => operation.identity,
		),
	);
	const pageResources: NormalizedResource[] = operations.operations
		.filter((operation: { identity: string }) =>
			exposed.has(operation.identity),
		)
		.map(
			(operation: NormalizedResource["contract"] & { identity: string }) => ({
				...resources[0],
				identity: operation.identity,
				kind: operation.identity.slice(0, operation.identity.indexOf(":")),
				name: operation.identity.slice(operation.identity.indexOf(":") + 1),
				contract: { ...operation, exposure: "network" },
			}),
		);
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
	await Bun.write(
		join(directory, "page-app.ts"),
		`export type AppContextInput = ${renderCodecType(context.context.input)};\n`,
	);
	const pageClient = renderFactoryScope(
		renderClientContract(pageResources, {
			application: http.application,
			clientContractDigest: http.clientContractDigest,
			httpContractDigest: http.digest,
			contextCodec: context.context.input,
		}),
		pageResources,
		[],
		pages,
	);
	await Bun.write(
		join(directory, "page-client.ts"),
		replaceOnce(pageClient, 'from "./app"', 'from "./page-app"'),
	);
}
