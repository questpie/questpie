import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { compileApplication } from "@questpie/compiler";

import { runtimeArtifactDigest } from "../../packages/runtime/src/application/artifact-protocol";
import { decodeRuntimeArtifacts } from "../../packages/runtime/src/application/artifacts";

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
		const operationContracts = JSON.parse(
			first.generatedFiles["operation-contracts.json"]!,
		);
		const http = JSON.parse(
			first.generatedFiles["operation-http-contract.json"]!,
		);

		expect(runtimeBuild).toMatchObject({
			format: "questpie.runtime-build",
			version: 1,
			application: "application:collaboration",
			runtimeAbi: "questpie.runtime.v1",
			internalProtocol: "questpie.internal.v7",
			compiler: {
				version: "4.0.0-beta.2",
				bunVersion: Bun.version,
				executableFormat: "bun-esm-bundle-v1",
			},
			later: {
				changeLedgerDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
				resumeDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
				durableCompatibilityDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
				reactionDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
				jobDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
			},
		});
		expect(runtimeBuild.inventory).toContainEqual(
			expect.objectContaining({ path: "reaction-projection.json" }),
		);
		expect(runtimeBuild.inventory).toContainEqual(
			expect.objectContaining({ path: "job-projection.json" }),
		);
		const compatibleBuild = JSON.parse(
			first.generatedFiles["runtime-build.json"]!,
		);
		const {
			digest: _v7Digest,
			mcpProjectionDigest: _mcpProjectionDigest,
			...v4Unsigned
		} = {
			...compatibleBuild,
			internalProtocol: "questpie.internal.v4",
			later: (({ jobDigest: _jobDigest, ...later }) => later)(
				compatibleBuild.later,
			),
		};
		const v4RuntimeBuild = {
			...v4Unsigned,
			digest: runtimeArtifactDigest("questpie-runtime-build-v1", v4Unsigned),
		};
		expect(
			decodeRuntimeArtifacts({
				runtimeBuild: v4RuntimeBuild,
				runtimeExecutables: executables,
				operationContracts,
				httpContract: http,
			}).runtimeBuild.internalProtocol,
		).toBe("questpie.internal.v4");
		expect(() =>
			decodeRuntimeArtifacts({
				runtimeBuild: {
					...v4RuntimeBuild,
					internalProtocol: "questpie.internal.v8",
				},
				runtimeExecutables: executables,
				operationContracts,
				httpContract: http,
			}),
		).toThrow();
		expect(runtimeBuild.inventory).toContainEqual(
			expect.objectContaining({ path: "durable-kernel.json" }),
		);
		const durableKernel = JSON.parse(
			first.generatedFiles["durable-kernel.json"]!,
		);
		expect(durableKernel.failureCodes).toContain("CHECKPOINT_INVALID");
		expect(durableKernel.permanentFailureCodes).toContain("CHECKPOINT_INVALID");
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
		expect(http).toMatchObject({
			format: "questpie.operation-http",
			version: 1,
		});
		expect(http).not.toHaveProperty("compatibility");
		expect(http.operations).toContainEqual(
			expect.objectContaining({
				identity: "query:messages.page",
				input: {
					kind: "object",
					properties: {
						after: { kind: "nullable", codec: { kind: "cursor" } },
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
			reply: (request: Request) => Response | Promise<Response>,
		) => {
			const client = generatedClient.createClient({
				baseUrl: "http://runtime.test",
				fetch: reply,
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
		const response = (body: unknown, status = 200) =>
			new Response(JSON.stringify(body), {
				status,
				headers: { "content-type": "application/json; charset=utf-8" },
			});
		await expect(
			call(() => response({ kind: "result", payload: [] })),
		).rejects.toThrow("PROTOCOL_UNSUPPORTED");
		await expect(
			call(() =>
				response(
					{ error: { code: "PROTOCOL_UNSUPPORTED", retryable: false } },
					400,
				),
			),
		).rejects.toThrow("PROTOCOL_UNSUPPORTED");
		await expect(
			call(async (request) => {
				return response(
					{
						callId: request.headers.get("Questpie-Call-Id"),
						error: { code: "RUNTIME_UNAVAILABLE", retryable: true },
					},
					503,
				);
			}),
		).rejects.toThrow("RUNTIME_UNAVAILABLE");
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 30_000);
