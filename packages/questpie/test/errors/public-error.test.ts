import { describe, expect, it } from "bun:test";

import { z } from "zod";

import { handleError } from "../../src/server/adapters/utils/response.js";
import { ApiError } from "../../src/server/errors/base.js";

describe("safe public error wire contract", () => {
	it("keeps explicit product details but never cause, invalid values or runtime context", async () => {
		const error = new ApiError({
			code: "CONFLICT",
			message: "Version changed",
			fieldErrors: [
				{
					path: "version",
					message: "Try the current version",
					value: "secret-input",
				},
			],
			context: {
				custom: { currentVersion: 2 },
				db: { table: "private", operation: "insert" },
			},
			cause: new Error("SELECT secret FROM private"),
		});
		const response = handleError(error, { isDev: false });
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: {
				code: "CONFLICT",
				message: "Version changed",
				fieldErrors: [{ path: "version", message: "Try the current version" }],
				context: { custom: { currentVersion: 2 } },
			},
		});
	});
	it("keeps unknown failures opaque without executing getters or proxies", async () => {
		let calls = 0;
		const hostile = Object.defineProperty({}, "cause", {
			get() {
				calls++;
				throw new Error("secret");
			},
		});
		const proxy = new Proxy(
			{},
			{
				getPrototypeOf() {
					calls++;
					throw new Error("secret");
				},
				get() {
					calls++;
					throw new Error("secret");
				},
			},
		);
		for (const error of [
			new Error("SELECT password='secret'"),
			hostile,
			proxy,
			z.string().safeParse(1).error,
		]) {
			expect(await handleError(error, { isDev: false }).json()).toEqual({
				error: {
					code: "INTERNAL_SERVER_ERROR",
					message: "Internal server error",
				},
			});
		}
		expect(calls).toBe(0);
	});
	it("redacts database unique values, metadata and nested SQL", async () => {
		const cause = Object.assign(new Error("private SQL"), {
			code: "23505",
			constraint: "users_email_unique",
			detail: "Key (email)=(private@example.com) already exists.",
			table: "users",
		});
		const response = handleError(new Error("SELECT secret", { cause }), {
			isDev: false,
		});
		expect(response.status).toBe(409);
		const wire = JSON.stringify(await response.json());
		for (const secret of [
			"private@example.com",
			"SELECT",
			"private SQL",
			"users",
			"constraint",
			"cause",
			"stack",
			'"value"',
		])
			expect(wire).not.toContain(secret);
	});
	it("bounds localized input errors and drops invalid values", async () => {
		const error = ApiError.fromZodError({
			issues: Array.from({ length: 20 }, () => ({
				path: ["x".repeat(500)],
				message: "bad".repeat(500),
				input: "secret",
			})),
		});
		const body = await handleError(error, { isDev: false }).json();
		expect(body.error.code).toBe("VALIDATION_ERROR");
		expect(body.error.fieldErrors).toHaveLength(8);
		expect(body.error.fieldErrors[0].path.length).toBeLessThanOrEqual(256);
		expect(body.error.fieldErrors[0].message.length).toBeLessThanOrEqual(200);
		expect(JSON.stringify(body)).not.toContain("secret");
	});
});

it("serializes the same safe localized error through JSON and typed HTTP", async () => {
	const { parseTypedWire } = await import("../../src/shared/typed-wire.js");
	const error = ApiError.badRequest("Bad request", [
		{
			path: "title",
			message: "Too short",
			value: "secret",
			messageKey: "validation.string.min",
			messageParams: { min: 3 },
		},
	]);
	const options = {
		isDev: true,
		locale: "sk",
		app: {
			t: (key: string, _params: unknown, locale?: string) => `${locale}:${key}`,
		} as never,
	};
	const json = await handleError(error, options).json();
	const typed = handleError(error, {
		...options,
		request: new Request("http://localhost/", {
			headers: { "X-SuperJSON": "1" },
		}),
	});
	expect(parseTypedWire(await typed.text())).toEqual(json);
	expect(json.error.message).toBe("sk:error.badRequest");
	expect(json.error.fieldErrors).toEqual([
		{ path: "title", message: "sk:validation.string.min" },
	]);
	expect(json.error).not.toHaveProperty("stack");
});

it("does not invoke overridden error serialization or nested detail accessors", async () => {
	let calls = 0;
	const custom = Object.defineProperty({}, "secret", {
		enumerable: true,
		get() {
			calls++;
			return "private";
		},
	});
	const error = new ApiError({
		code: "CONFLICT",
		message: "Try again",
		context: { custom },
		cause: new Error("secret"),
	});
	Object.defineProperty(error, "toJSON", {
		get() {
			calls++;
			throw new Error("must not run");
		},
	});
	Object.defineProperty(error, "cause", {
		get() {
			calls++;
			throw new Error("must not run");
		},
	});
	expect(await handleError(error, { isDev: false }).json()).toEqual({
		error: { code: "CONFLICT", message: "Try again" },
	});
	expect(calls).toBe(0);
});

it("keeps internal diagnostic messages and translation keys out of public responses", async () => {
	const cause = new Error("private connection details");
	for (const error of [
		ApiError.internal("private SQL", cause),
		ApiError.internal("private SQL", cause, "private.indexer", {
			table: "private_table",
		}),
	]) {
		const translated: string[] = [];
		const response = handleError(error, {
			isDev: false,
			locale: "sk",
			app: {
				t: (key: string) => {
					translated.push(key);
					return "Vnútorná chyba servera";
				},
			} as never,
		});
		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			error: {
				code: "INTERNAL_SERVER_ERROR",
				message: "Vnútorná chyba servera",
			},
		});
		expect(translated).toEqual(["error.internal"]);
		expect(error.message).toBe("private SQL");
		expect(error.cause).toBe(cause);
	}
});
