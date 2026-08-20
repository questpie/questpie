import { afterAll, expect, test } from "bun:test";

import { SQL } from "bun";

import baseline from "../../quality/baselines/beta05-runtime-client.json";
import scenario from "../../quality/performance/beta05-runtime-client.json";
import {
	beta05Ids,
	beta05PostgresUrl,
	prepareBeta05PostgresApplication,
} from "../integration/postgres/helpers/beta05-runtime";

const database = process.env.PGHOST ? new SQL({ max: 1 }) : undefined;

function derivedBudget(
	input: Readonly<{
		referenceObservedMs: number;
		multiplier: number;
		roundUpQuantumMs: number;
	}>,
): number {
	return (
		Math.ceil(
			(input.referenceObservedMs * input.multiplier) / input.roundUpQuantumMs,
		) * input.roundUpQuantumMs
	);
}

function derivedSizeBudget(
	input: Readonly<{
		referenceObservedBytes: number;
		multiplier: number;
		roundUpQuantumBytes: number;
	}>,
): number {
	return (
		Math.ceil(
			(input.referenceObservedBytes * input.multiplier) /
				input.roundUpQuantumBytes,
		) * input.roundUpQuantumBytes
	);
}

afterAll(async () => {
	await database?.close({ timeout: 0 });
});

const postgresTest = process.env.PGHOST ? test : test.skip;

postgresTest(
	"measures generated Runtime startup and Query wire calls",
	async () => {
		const prepared = await prepareBeta05PostgresApplication(database!);
		let application: Readonly<{
			fetch(request: Request): Promise<Response>;
			close(): Promise<void>;
		}> | null = null;
		try {
			const started = performance.now();
			application = await prepared.generated.app.createApp({
				postgres: { url: beta05PostgresUrl() },
				realtime: { hmacKey: new Uint8Array(32) },
				maintenance: { authorize: () => true },
			});
			const coldStartMs = performance.now() - started;
			const internal = await prepared.generated.loadInternal();
			const user = prepared.generated.framework.principal.user({
				id: beta05Ids.principal,
			});
			let requestBytes = 0;
			let responseBytes = 0;
			const client = prepared.generated.client.createClient({
				baseUrl: "http://runtime.test",
				fetch: async (request: Request) => {
					requestBytes = Math.max(
						requestBytes,
						Buffer.byteLength(await request.clone().text()),
					);
					const response = await application!.fetch(
						internal.bindIngressPrincipalForRequest(request, user),
					);
					responseBytes = Math.max(
						responseBytes,
						Buffer.byteLength(await response.clone().text()),
					);
					return response;
				},
			});
			const query = () =>
				client
					.withContext({ companyId: beta05Ids.company })
					.queries["messages.page"]({
						channelId: beta05Ids.channel,
						first: 20,
						after: null,
					});
			await query();
			const wireStarted = performance.now();
			for (let index = 0; index < 20; index += 1) await query();
			const wireExecute20Ms = performance.now() - wireStarted;
			const serverBundleBytes = Buffer.byteLength(
				prepared.compilation.generatedFiles["internal/application.js"]!,
			);
			const runtimeBuildBytes = Buffer.byteLength(prepared.runtimeBuildBytes);
			const measurements = {
				coldStartMs,
				wireExecute20Ms,
				requestBytes,
				responseBytes,
				serverBundleBytes,
				runtimeBuildBytes,
			};
			for (const [name, metric] of Object.entries(scenario.metrics)) {
				expect(
					measurements[name as keyof typeof measurements],
				).toBeLessThanOrEqual(metric.budget);
				expect(baseline.budgets[name as keyof typeof baseline.budgets]).toBe(
					metric.budget,
				);
			}
			console.log(
				JSON.stringify({
					scenario: "beta05-runtime-client",
					budgetOwner: "BETA-05",
					evidenceClass:
						process.env.QUESTPIE_PERFORMANCE_EVIDENCE_CLASS ??
						baseline.reference.runnerClass,
					postgresMajor: 17,
					measurements,
					status: "PASS",
				}),
			);
			for (const [name, derivation] of Object.entries(
				baseline.budgetDerivation,
			))
				expect(baseline.budgets[name as keyof typeof baseline.budgets]).toBe(
					derivedBudget(derivation),
				);
			for (const [name, derivation] of Object.entries(
				baseline.sizeBudgetDerivation,
			))
				expect(baseline.budgets[name as keyof typeof baseline.budgets]).toBe(
					derivedSizeBudget(derivation),
				);
		} finally {
			await application?.close();
			await prepared.dispose();
		}
	},
);
