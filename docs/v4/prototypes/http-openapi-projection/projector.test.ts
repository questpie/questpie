import { expect, test } from "bun:test";

import type { NormalizedResource } from "../../../../packages/compiler/src/types";
import { projectOpenApi } from "./projector";

const origin = (logicalPath: string, exportName = "definition") =>
	Object.freeze({
		logicalPath,
		exportName,
		packageId: null,
		span: null,
		memberSpans: Object.freeze({}),
	});

function resource(
	kind: string,
	name: string,
	contract: Readonly<Record<string, unknown>>,
): NormalizedResource {
	return {
		identity: `${kind}:${name}`,
		kind,
		name,
		contract,
		contributions: [],
		origin: origin(`src/${name.replaceAll(".", "-")}.ts`),
		value: {},
	};
}

const text = Object.freeze({ kind: "text", minLength: 1, maxLength: 100 });
const output = Object.freeze({
	kind: "object",
	properties: Object.freeze({ accepted: Object.freeze({ kind: "boolean" }) }),
});
const networkContract = Object.freeze({
	exposure: "network",
	input: Object.freeze({
		kind: "object",
		properties: Object.freeze({ message: text }),
	}),
	output,
	declaredErrors: Object.freeze({
		blocked: Object.freeze({ code: "BLOCKED", status: 409, payload: null }),
	}),
	limits: Object.freeze({
		inputBytes: 4_096,
		resultBytes: 4_096,
		durationMilliseconds: 1_000,
	}),
});

test("negative proof: an RPC-envelope document is deterministic but not the public HTTP projection", () => {
	const projection = projectOpenApi({
		application: "application:openapi-test",
		clientContractDigest: "a".repeat(64),
		context: Object.freeze({
			kind: "object",
			properties: Object.freeze({ tenantId: Object.freeze({ kind: "uuid" }) }),
		}),
		mediaType: "application/vnd.questpie.operation+json;version=1",
		path: "/_questpie/operation",
		resources: [
			resource("query", "messages.page", networkContract),
			resource("mutation", "messages.publish", networkContract),
			resource("action", "delivery.send", networkContract),
			resource("action", "delivery.internal", {
				...networkContract,
				exposure: "server",
			}),
			resource("route", "hooks.receive", {
				method: "POST",
				path: "/hooks/receive",
			}),
			resource("job", "reports.digest", {}),
			resource("reaction", "messages.changed", {}),
		],
		wireDigest: "b".repeat(64),
	});

	expect(projection).toMatchObject({
		openapi: "3.1.0",
		info: {
			title: "application:openapi-test",
			version: "a".repeat(64),
		},
		paths: {
			"/_questpie/operation": {
				post: {
					operationId: "questpie.operation",
				},
			},
		},
		"x-questpie-source-artifacts": {
			clientContractDigest: "a".repeat(64),
			wireDigest: "b".repeat(64),
		},
	});
	const post = projection.paths["/_questpie/operation"]!.post;
	const requests =
		post.requestBody.content[
			"application/vnd.questpie.operation+json;version=1"
		].schema.oneOf;
	expect(
		requests.map(
			(branch) =>
				(branch.properties.operation as Readonly<{ const: string }>).const,
		),
	).toEqual([
		"action:delivery.send",
		"mutation:messages.publish",
		"query:messages.page",
	]);
	expect(requests[0]?.required).toContain("effectKey");
	expect(requests[0]?.["x-questpie-operation"]).toMatchObject({
		limits: networkContract.limits,
	});
	expect(requests[1]?.required).not.toContain("effectKey");
	expect(post.responses["409"]).toMatchObject({
		content: {
			"application/vnd.questpie.operation+json;version=1": {},
		},
	});
	expect(JSON.stringify(projection)).not.toContain("delivery.internal");
	expect(JSON.stringify(projection)).not.toContain("reports.digest");
	expect(JSON.stringify(projection)).not.toContain("messages.changed");
	expect(JSON.stringify(projection)).not.toContain("channel:");
	expect(JSON.stringify(projection)).not.toContain("workflow:");
	expect(projection["x-questpie-diagnostics"]).toEqual([
		{
			code: "QP-OPENAPI-001",
			diagnosticClass: "unsupportedContract",
			identity: "route:hooks.receive",
			origin: origin("src/hooks-receive.ts"),
			reason: "rawRequestResponseRoute",
		},
	]);
});

test("proof: the closed codec owner lowers without widening unknown members", () => {
	const projection = projectOpenApi({
		application: "application:codec-test",
		clientContractDigest: "c".repeat(64),
		context: Object.freeze({ kind: "object", properties: Object.freeze({}) }),
		mediaType: "application/vnd.questpie.operation+json;version=1",
		path: "/_questpie/operation",
		resources: [
			resource("query", "codec.all", {
				...networkContract,
				input: Object.freeze({
					kind: "object",
					properties: Object.freeze({
						count: Object.freeze({ kind: "integer", minimum: 1, maximum: 10 }),
						cursor: Object.freeze({
							kind: "nullable",
							codec: Object.freeze({ kind: "cursor" }),
						}),
						tags: Object.freeze({
							kind: "optional",
							codec: Object.freeze({ kind: "array", items: text, maximum: 3 }),
						}),
						when: Object.freeze({ kind: "timestamp", withTimezone: true }),
					}),
				}),
			}),
		],
		wireDigest: "d".repeat(64),
	});
	const request =
		projection.paths["/_questpie/operation"]!.post.requestBody.content[
			"application/vnd.questpie.operation+json;version=1"
		].schema.oneOf[0]!;
	const input = request.properties.input as Readonly<{
		additionalProperties: boolean;
		properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
		required: readonly string[];
	}>;
	expect(input.additionalProperties).toBe(false);
	expect(input.required).toEqual(["count", "cursor", "when"]);
	expect(input.properties.count).toEqual({
		type: "integer",
		minimum: 1,
		maximum: 10,
	});
	expect(input.properties.cursor).toEqual({
		anyOf: [{ type: "string", "x-questpie-codec": "cursor" }, { type: "null" }],
	});
	expect(input.properties.tags).toEqual({
		type: "array",
		items: { type: "string", minLength: 1, maxLength: 100 },
		maxItems: 3,
	});
	expect(input.properties.when).toEqual({
		type: "string",
		format: "date-time",
		"x-questpie-timezone": true,
	});
});
