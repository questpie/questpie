import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { compileApplication } from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

test("binds every generated network Query slot to immutable Runtime Build bytes", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-beta05-runtime-"));
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		const first = await compileApplication({ applicationRoot: temporary });
		const runtimeBuild = JSON.parse(
			first.generatedFiles["runtime-build.json"]!,
		);
		const executables = JSON.parse(
			first.generatedFiles["runtime-executables.json"]!,
		);
		const wire = JSON.parse(first.generatedFiles["wire-contract.json"]!);

		expect(runtimeBuild).toMatchObject({
			format: "questpie.runtime-build",
			version: 1,
			application: "application:collaboration",
			runtimeAbi: "questpie.runtime.v1",
			internalProtocol: "questpie.internal.v4",
			compiler: {
				version: "4.0.0-beta.1",
				bunVersion: Bun.version,
				executableFormat: "bun-esm-bundle-v1",
			},
			later: {
				changeLedgerDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
				resumeDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
				durableCompatibilityDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
				reactionDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
			},
		});
		expect(runtimeBuild.inventory).toContainEqual(
			expect.objectContaining({ path: "reaction-projection.json" }),
		);
		expect(runtimeBuild.inventory).toContainEqual(
			expect.objectContaining({ path: "durable-kernel.json" }),
		);
		expect(runtimeBuild.compilerRuntimeBuildDigest).toMatch(/^[0-9a-f]{64}$/);
		expect(runtimeBuild.schemaFingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect(runtimeBuild.serverBundleDigest).toBe(
			createHash("sha256")
				.update(first.generatedFiles["internal/application.js"]!)
				.digest("hex"),
		);
		expect(
			runtimeBuild.inventory.map(({ path }: { path: string }) => path),
		).toEqual(
			runtimeBuild.inventory
				.map(({ path }: { path: string }) => path)
				.toSorted(),
		);
		expect(executables).toMatchObject({
			format: "questpie.runtime-executables",
			version: 1,
		});
		const querySlot = executables.slots.find(
			(slot: { identity: string }) => slot.identity === "query:messages.page",
		);
		expect(querySlot).toMatchObject({
			kind: "query",
			slot: "handler",
			origin: {
				path: "src/consumer.ts",
				exportName: "messagePage",
				packageId: null,
			},
		});
		expect(querySlot.sourceDigest).toMatch(/^[0-9a-f]{64}$/);
		expect(querySlot.sourceDigest).toBe(
			createHash("sha256")
				.update(await readFile(join(temporary, "src/consumer.ts")))
				.digest("hex"),
		);
		expect(querySlot.runtimeGraphDigest).toMatch(/^[0-9a-f]{64}$/);
		expect(querySlot.bundleExport).toMatch(
			/^qp_query_messages_page_handler_[0-9a-f]{12}$/,
		);
		expect(runtimeBuild.executableSlots).toContain(
			"query:messages.page#handler",
		);
		expect(runtimeBuild.executableSlots).toContain(
			"context:app.context#resolve",
		);
		expect(runtimeBuild.executableSlots).toContain(
			"service:audit.connection#create",
		);
		expect(wire).toMatchObject({
			format: "questpie.operation-wire",
			version: 2,
			path: "/_questpie/operation",
			protocol: { name: "questpie.operation", version: 1 },
		});
		expect(wire.operations).toContainEqual(
			expect.objectContaining({
				identity: "query:messages.page",
				input: {
					kind: "object",
					properties: {
						after: { kind: "nullable", codec: { kind: "text" } },
						channelId: { kind: "uuid" },
						first: { kind: "integer" },
					},
				},
				output: expect.objectContaining({
					kind: "object",
					properties: expect.objectContaining({
						nodes: expect.objectContaining({ kind: "array" }),
					}),
				}),
			}),
		);
		expect(first.generatedFiles["app.ts"]).toContain(
			"export const defineQuery: QueryFactory",
		);
		expect(first.generatedFiles["app.ts"]).toContain(
			"export interface CommittedResultUnavailable extends Error",
		);
		expect(first.generatedFiles["client.ts"]).toContain(
			"export function createClient",
		);
		expect(first.generatedFiles["client.ts"]).toContain("withContext");

		const generatedClient = await import(
			pathToFileURL(join(temporary, ".questpie/generated/client.ts")).href
		);
		const call = async (
			reply: (request: Request) => unknown | Promise<unknown>,
		) => {
			const client = generatedClient.createClient({
				baseUrl: "http://runtime.test",
				fetch: async (request: Request) =>
					new Response(JSON.stringify(await reply(request)), {
						status: 200,
						headers: { "content-type": wire.mediaType },
					}),
			});
			return client
				.withContext({
					companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2",
				})
				.queries["messages.page"]({
					channelId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a3",
					first: 1,
					after: null,
				});
		};
		await expect(call(() => ({ kind: "result", payload: [] }))).rejects.toThrow(
			"PROTOCOL_UNSUPPORTED",
		);
		await expect(
			call(() => ({
				kind: "failure",
				error: { code: "CLIENT_OUTDATED", retryable: false },
			})),
		).rejects.toThrow("CLIENT_OUTDATED");
		await expect(
			call(async (request) => {
				const sent = (await request.clone().json()) as Readonly<
					Record<string, unknown>
				>;
				return {
					protocol: { name: "questpie.operation", version: 1 },
					kind: "failure",
					operation: sent.operation,
					callId: sent.callId,
					error: { code: "RUNTIME_UNAVAILABLE", retryable: true },
				};
			}),
		).rejects.toThrow("RUNTIME_UNAVAILABLE");
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 30_000);
