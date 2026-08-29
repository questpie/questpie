import { expect, test } from "bun:test";

import { renderAppContract } from "../../packages/compiler/src/generate";
import {
	renderJobAcceptances,
	renderJobDeclarations,
} from "../../packages/compiler/src/job";
import { renderClientContract } from "../../packages/compiler/src/runtime/client";
import type { NormalizedResource } from "../../packages/compiler/src/types";

const job = Object.freeze({
	identity: "job:reports.companyDigest",
	kind: "job",
	name: "reports.companyDigest",
	contract: Object.freeze({
		input: Object.freeze({
			kind: "object",
			properties: Object.freeze({ companyId: Object.freeze({ kind: "uuid" }) }),
		}),
		output: Object.freeze({
			kind: "object",
			properties: Object.freeze({ digest: Object.freeze({ kind: "text" }) }),
		}),
	}),
	contributions: Object.freeze([]),
	origin: Object.freeze({
		logicalPath: "src/company-digest.ts",
		exportName: "companyDigest",
		packageId: null,
		span: null,
		memberSpans: Object.freeze({}),
	}),
	value: Object.freeze({}),
}) satisfies NormalizedResource;

const resources = Object.freeze([job]);

function between(source: string, start: string, end: string): string {
	const startIndex = source.indexOf(start);
	const endIndex = source.indexOf(end, startIndex + start.length);
	if (startIndex < 0 || endIndex < 0)
		throw new TypeError(`missing generated declaration range ${start}..${end}`);
	return source.slice(startIndex, endIndex);
}

test("renders the final server-only Job acceptance contract", () => {
	expect(renderJobAcceptances(resources)).toBe(
		'Readonly<{ readonly "reports": Readonly<{ readonly "companyDigest": Readonly<{ accept(input: Readonly<{ readonly "companyId": string; }>, options: JobAcceptanceOptions): Promise<JobRunReceipt<"reports.companyDigest">>; }>; }>; }>',
	);

	const declarations = renderJobDeclarations(resources);
	expect(declarations).toContain(`export interface JobAcceptanceOptions {
\treadonly idempotencyKey: string;
\treadonly notBefore?: Date;
}`);
	expect(declarations).toContain(
		"export type JobRunReceipt<Name extends keyof GeneratedJobs> = Readonly<{ readonly runId: string; readonly resource: `job:${Name & string}` }>;",
	);
	expect(declarations).not.toContain("dispatch(");
	expect(declarations).not.toMatch(/delay|timeoutMilliseconds/);
});

test("keeps Job acceptance on the Mutation Job map and out of shared contexts", () => {
	const app = renderAppContract(
		resources,
		{ collections: [] },
		{ collections: [] },
		"src",
		{ queries: [] },
		{
			operations: [],
			issueBearingTargets: [],
			admittedIssueBearingTargets: {},
		},
		false,
	);

	const mutation = between(
		app,
		"export interface MutationContext",
		"type ApplicationContextDefinition",
	);
	expect(mutation).toContain(
		"readonly jobs: Readonly<GeneratedJobAcceptances>;",
	);
	expect(mutation).not.toContain("dispatch(input:");
	expect(app).toContain(
		'export type GeneratedJobAcceptances = Readonly<{ readonly "reports": Readonly<{ readonly "companyDigest": Readonly<{ accept(input:',
	);
	expect(app).not.toContain(
		'export interface GeneratedJobAcceptances {\n\t"reports.companyDigest"',
	);
	expect(app).toMatch(
		/RouteContext[\s\S]*execution<Result>[\s\S]*jobs: GeneratedJobAcceptances/,
	);
	expect(app).toMatch(
		/GeneratedApp[\s\S]*execution<Result>[\s\S]*jobs: GeneratedJobAcceptances/,
	);

	for (const context of [
		between(
			app,
			"export interface QueryContext",
			"export interface MutationContext",
		),
		between(app, "export type RootExecution", "export interface ActionContext"),
		between(
			app,
			"export interface ActionContext",
			"type EmptyDefinitionFactory",
		),
		between(app, "export type RouteContext", "export type RouteDefinition"),
		between(
			app,
			"export type ReactionContext",
			"export type ReactionDefinition",
		),
		between(app, "export type JobContext", "export type JobDefinition"),
	]) {
		expect(context).not.toContain("\n\treadonly jobs:");
		expect(context).not.toContain("\n\taccept(");
	}
});

test("does not project Job acceptance into the browser client", () => {
	const client = renderClientContract(resources, {
		application: "application:test",
		clientContractDigest: "1".repeat(64),
		wireDigest: "2".repeat(64),
		path: "/_questpie/operation",
		mediaType: "application/vnd.questpie.operation+json;version=1",
	});

	expect(client).not.toContain("reports.companyDigest");
	expect(client).not.toContain("JobAcceptanceOptions");
	expect(client).not.toContain("accept(");
});
