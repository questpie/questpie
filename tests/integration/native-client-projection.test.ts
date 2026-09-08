import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

import { renderClientContract } from "../../packages/compiler/src/runtime";
import type { NormalizedResource } from "../../packages/compiler/src/types";
import { readClientScope } from "../../packages/questpie/src/internal/client-projection";

const pageInput = {
	kind: "object",
	properties: {
		first: { kind: "integer" },
		continuation: { kind: "nullable", codec: { kind: "cursor" } },
	},
};
const pageOutput = {
	kind: "object",
	properties: {
		nodes: { kind: "array", items: { kind: "text" } },
		pageInfo: {
			kind: "object",
			properties: {
				hasNextPage: { kind: "boolean" },
				endCursor: { kind: "nullable", codec: { kind: "text" } },
			},
		},
	},
};
function resource(kind: string, name: string): NormalizedResource {
	return {
		kind,
		name,
		identity: `${kind}:${name}`,
		contract: {
			exposure: "network",
			input: pageInput,
			output: pageOutput,
			declaredErrors: {
				rejected: { code: "REJECTED", status: 409, payload: null },
			},
		},
		contributions: [],
		value: {},
		origin: {
			logicalPath: "src/pages.ts",
			exportName: name.replaceAll(".", "_"),
			packageId: null,
			span: null,
			memberSpans: {},
		},
	};
}
const resources = [
	resource("query", "records.page"),
	resource("query", "records.handler"),
	resource("mutation", "records.write"),
	resource("mutation", "records.other"),
];

test("direct rendering supplies renamed forward paging without inferring page-shaped handlers", async () => {
	const directory = await mkdtemp(
		join(import.meta.dir, "native-client-output-"),
	);
	try {
		await Bun.write(
			join(directory, "app.ts"),
			"export type AppContextInput = Readonly<{}>;\n",
		);
		await Bun.write(
			join(directory, "client.ts"),
			renderClientContract(resources, {
				application: "application:native-projection",
				clientContractDigest: "1".repeat(64),
				httpContractDigest: "2".repeat(64),
				queryProjection: {
					queries: [
						{
							identity: "query:records.page",
							template: {
								page: {
									kind: "forwardCursor",
									after: { parameter: "continuation" },
								},
							},
						},
					],
				},
			}),
		);
		const generated = await import(join(directory, "client.ts"));
		const calls: URL[] = [];
		const client = generated.createClient({
			baseUrl: "https://native.invalid",
			fetch: async (request: Request) => {
				calls.push(new URL(request.url));
				return Response.json(
					{
						callId: request.headers.get("Questpie-Call-Id"),
						result: {
							nodes: ["terminal"],
							pageInfo: { endCursor: "last", hasNextPage: false },
						},
					},
					{ headers: { "content-type": "application/json; charset=utf-8" } },
				);
			},
		});
		const scope = client.withContext({});
		const projection = readClientScope(scope);
		expect(readClientScope(scope)).toBe(projection);
		expect(generated.getClientProjection).toBeUndefined();
		expect(projection.queries["records.handler"]!.forward).toBeUndefined();
		const forward = projection.queries["records.page"]!.forward!;
		expect(forward).toBeDefined();
		const captured = forward.capture({ first: 2 } as never);
		expect(calls).toHaveLength(0);
		const result = await captured.call("cursor-value");
		expect(calls[0]!.searchParams.get("continuation")).toBe("cursor-value");
		expect(calls[0]!.searchParams.has("after")).toBe(false);
		expect(forward.next(result)).toBeUndefined();
		// Ordinary page calls must preserve non-null input cursors as well.
		await projection.queries["records.page"]!.capture({
			first: 2,
			continuation: "ordinary-cursor",
		} as never).call();
		expect(calls[1]!.searchParams.get("continuation")).toBe("ordinary-cursor");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("Mutation outcome provenance belongs to the validated decoder and exact operation", async () => {
	const directory = await mkdtemp(
		join(import.meta.dir, "native-client-output-"),
	);
	try {
		await Bun.write(
			join(directory, "app.ts"),
			"export type AppContextInput = Readonly<{}>;\n",
		);
		await Bun.write(
			join(directory, "client.ts"),
			renderClientContract(resources, {
				application: "application:native-projection",
				clientContractDigest: "1".repeat(64),
				httpContractDigest: "2".repeat(64),
			}),
		);
		const generated = await import(join(directory, "client.ts"));
		let mode: "committed" | "declared" | "mismatched" = "committed";
		const callId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131";
		const transactionId = "42";
		const client = generated.createClient({
			baseUrl: "https://native.invalid",
			fetch: async (request: Request) =>
				Response.json(
					{
						callId:
							mode === "mismatched"
								? "018f5f6e-5f2c-7b41-a854-3d9a6b6b7132"
								: request.headers.get("Idempotency-Key"),
						error:
							mode === "declared"
								? { code: "REJECTED", payload: null }
								: {
										code: "COMMITTED_RESULT_UNAVAILABLE",
										retryable: true,
										transactionId,
									},
					},
					{
						status: mode === "declared" ? 409 : 500,
						headers: { "content-type": "application/json; charset=utf-8" },
					},
				),
		});
		const projection = readClientScope(client.withContext({}));
		const mutation = projection.mutations["records.write"]!;
		const invoke = () =>
			mutation
				.invoke({ first: 2, continuation: null } as never, { callId })
				.catch((error: unknown) => error);
		const committed = await invoke();
		expect(mutation.failure(committed)).toEqual({
			kind: "committed",
			callId,
			transactionId,
		});
		expect(
			projection.mutations["records.other"]!.failure(committed),
		).toBeUndefined();
		expect(
			mutation.failure(
				new generated.CommittedResultUnavailable(callId, transactionId),
			),
		).toBeUndefined();
		expect(
			Reflect.set(committed as object, "payload", {
				callId: "forged",
				transactionId: "999",
			}),
		).toBe(false);
		expect(mutation.failure(committed)).toEqual({
			kind: "committed",
			callId,
			transactionId,
		});
		expect(Object.isFrozen(mutation.failure(committed))).toBe(true);
		mode = "declared";
		const rejected = await invoke();
		expect(mutation.failure(rejected)).toEqual({ kind: "rejected", callId });
		expect(mutation.isError(rejected)).toBe(true);
		mode = "mismatched";
		const invalid = await invoke();
		expect((invalid as Error).message).toBe("PROTOCOL_UNSUPPORTED");
		expect(mutation.failure(invalid)).toBeUndefined();
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
