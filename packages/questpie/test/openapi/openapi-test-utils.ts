/**
 * Shared OpenAPI test utilities.
 *
 * Reusable assertion helpers for the `@questpie/openapi` generator test suite.
 * The full-spec 3.1 validity gate (`assertValidOpenApi31`) plus small
 * operation-level assertions (`getOperation`, `assertHasSummary`,
 * `assertSecurityEmpty`, `assertPathParam`, `assertResponse`, `assertRequestBody`)
 * are consumed by the other generator-hardening task tests (status codes,
 * filter/query DSL, schema/meta responses, route meta, per-op security) so that
 * every one of them can prove "still valid OpenAPI 3.1 + intended content present".
 *
 * The validator is `@seriousme/openapi-schema-validator` — an AJV-backed
 * validator that resolves the real OpenAPI **3.1** meta-schema (it reports the
 * detected version, accepts valid 3.1 documents, and rejects schema violations
 * such as a missing `responses`, a response without `description`, an invalid
 * `components.schemas` key, or a path parameter without `schema`).
 */

import { expect } from "bun:test";
import { Validator } from "@seriousme/openapi-schema-validator";

import type { OpenApiSpec, PathOperation } from "../../../openapi/src/types.js";

/** Any OpenAPI document shape — spec generators emit plain objects. */
export type AnyOpenApiSpec = OpenApiSpec | Record<string, unknown>;

/** HTTP methods that can appear on a path item. */
export type HttpMethod =
	| "get"
	| "put"
	| "post"
	| "delete"
	| "options"
	| "head"
	| "patch"
	| "trace";

/**
 * Validate a document against the OpenAPI **3.1** meta-schema.
 *
 * Returns the parsed result so callers can inspect it; use
 * {@link assertValidOpenApi31} when you just want a passing assertion with a
 * readable failure message.
 */
export async function validateOpenApi31(spec: AnyOpenApiSpec): Promise<{
	valid: boolean;
	version: string;
	errors: string;
}> {
	const validator = new Validator();
	const result = await validator.validate(spec as Record<string, unknown>);
	const errors =
		typeof result.errors === "string"
			? result.errors
			: JSON.stringify(result.errors ?? [], null, 2);
	return { valid: result.valid, version: validator.version, errors };
}

/**
 * Assert a generated document is a VALID OpenAPI 3.1 spec.
 *
 * Fails with the concrete validator errors (and the version the validator
 * detected) so a regression points straight at the offending node.
 *
 * @example
 * ```ts
 * const spec = await generateOpenApiSpec(app, { info: { title: "T", version: "1" } });
 * await assertValidOpenApi31(spec);
 * ```
 */
export async function assertValidOpenApi31(
	spec: AnyOpenApiSpec,
): Promise<void> {
	const { valid, version, errors } = await validateOpenApi31(spec);
	if (!valid) {
		throw new Error(
			`Expected a valid OpenAPI 3.1 spec (validator detected "${version}"), but found schema violations:\n${errors}`,
		);
	}
	// Guard against a validator that silently downgrades to an older meta-schema.
	expect(version).toBe("3.1");
}

/**
 * Look up a single operation by path + method. Throws a helpful error when the
 * path or method is missing so failing assertions read clearly.
 */
export function getOperation(
	spec: AnyOpenApiSpec,
	path: string,
	method: HttpMethod,
): PathOperation {
	const paths = (spec as OpenApiSpec).paths ?? {};
	const pathItem = paths[path];
	if (!pathItem) {
		throw new Error(
			`No path "${path}" in spec. Available paths: ${Object.keys(paths).join(", ")}`,
		);
	}
	const op = (pathItem as Record<string, unknown>)[method] as
		| PathOperation
		| undefined;
	if (!op) {
		throw new Error(
			`No "${method.toUpperCase()}" operation on path "${path}". Available methods: ${Object.keys(
				pathItem,
			).join(", ")}`,
		);
	}
	return op;
}

/**
 * Assert an operation has a non-empty `summary` (optionally an exact value).
 */
export function assertHasSummary(
	op: PathOperation,
	expected?: string,
): void {
	expect(typeof op.summary).toBe("string");
	expect((op.summary ?? "").length).toBeGreaterThan(0);
	if (expected !== undefined) {
		expect(op.summary).toBe(expected);
	}
}

/**
 * Assert an operation opts out of the spec-level security requirement — i.e. it
 * carries an explicit empty `security: []` (the marker for a public route).
 */
export function assertSecurityEmpty(op: PathOperation): void {
	expect(op.security).toEqual([]);
}

/**
 * Assert an operation is protected: it does NOT declare `security: []`, so it
 * inherits the global security scheme.
 */
export function assertSecurityInherited(op: PathOperation): void {
	expect(op.security).not.toEqual([]);
}

/**
 * Assert an operation declares a required `path` parameter with the given name
 * (and, by default, a string schema — matching the generator's path templates).
 */
export function assertPathParam(
	op: PathOperation,
	name: string,
): void {
	const params = (op.parameters ?? []) as Array<Record<string, unknown>>;
	const param = params.find((p) => p.name === name && p.in === "path");
	if (!param) {
		throw new Error(
			`Operation "${op.operationId ?? "?"}" has no path parameter "${name}". Parameters: ${JSON.stringify(
				params,
			)}`,
		);
	}
	expect(param.required).toBe(true);
	expect(param.schema).toBeDefined();
}

/**
 * Assert an operation declares a response for `status`, returning that response
 * object for further inspection (e.g. `content`, `$ref`). Used by the
 * status-code task to prove non-2xx responses are emitted.
 */
export function assertResponse(
	op: PathOperation,
	status: string | number,
): Record<string, unknown> {
	const responses = (op.responses ?? {}) as Record<string, unknown>;
	const key = String(status);
	const response = responses[key];
	if (response === undefined) {
		throw new Error(
			`Operation "${op.operationId ?? "?"}" has no "${key}" response. Statuses: ${Object.keys(
				responses,
			).join(", ")}`,
		);
	}
	return response as Record<string, unknown>;
}

/**
 * Assert an operation has a JSON request body, returning the
 * `content["application/json"].schema` node for further inspection (e.g. to
 * check a `$ref` or the filter/query DSL shape).
 */
export function assertRequestBody(op: PathOperation): Record<string, unknown> {
	const body = op.requestBody as
		| { content?: Record<string, { schema?: unknown }> }
		| undefined;
	const schema = body?.content?.["application/json"]?.schema;
	if (schema === undefined) {
		throw new Error(
			`Operation "${op.operationId ?? "?"}" has no application/json request body schema.`,
		);
	}
	return schema as Record<string, unknown>;
}
