import { describe, expect, it } from "bun:test";

import { z } from "zod";

import { handleError } from "../../src/server/adapters/utils/response.js";
import { ApiError } from "../../src/server/errors/base.js";
import { formatPublicError } from "../../src/server/errors/public.js";

describe("safe public error wire contract", () => {
	it("redacts ApiError when JSON.stringify supplies a property key to toJSON", () => {
		const error = ApiError.internal(
			"private-database-secret",
			new Error("private-cause"),
		);
		const json = JSON.stringify({ error });
		expect(JSON.parse(json)).toEqual({
			error: {
				code: "INTERNAL_SERVER_ERROR",
				message: "Internal server error",
			},
		});
		for (const secret of [
			"stack",
			"cause",
			"private-database-secret",
			"private-cause",
		]) {
			expect(json).not.toContain(secret);
		}
		expect(error.toJSON(true)).toHaveProperty("stack", error.stack);
	});
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
	it("keeps field feedback when a real Zod union issue exceeds the snapshot budget", () => {
		const branch = (prefix: string) =>
			z.object(
				Object.fromEntries(
					Array.from({ length: 10 }, (_, i) => [`${prefix}${i}`, z.string()]),
				),
			);
		const result = z
			.object({
				target: z.union([
					branch("email"),
					branch("sms"),
					branch("push"),
					branch("hook"),
					branch("chat"),
				]),
			})
			.safeParse({ target: {} });
		expect(result.success).toBe(false);
		if (result.success) throw new Error("expected invalid union");
		const error = ApiError.fromZodError(result.error);
		for (const options of [{}, { t: (key: string) => key }]) {
			const formatted = formatPublicError(error, options);
			expect(formatted.code).toBe("VALIDATION_ERROR");
			expect(formatted.fieldErrors).toEqual([
				{ path: "target", message: result.error.issues[0]!.message },
			]);
			expect(Buffer.byteLength(JSON.stringify(formatted))).toBeLessThan(8192);
		}
	});
	it("keeps bounded plain feedback when refinement or translation params are oversized", () => {
		const deep = Array.from({ length: 12 }).reduce<Record<string, unknown>>(
			(nested) => ({ nested }),
			{ secret: "private-refinement-input" },
		);
		const result = z
			.object({
				title: z.string().refine(() => false, {
					message: "Choose another title",
					params: deep,
				}),
			})
			.safeParse({ title: "private-input" });
		if (result.success) throw new Error("expected invalid refinement");
		const error = ApiError.fromZodError(result.error);
		for (const params of [
			{ field: "title" },
			{ blob: "private-param".repeat(1000) },
		]) {
			error.fieldErrors![0]!.messageParams = params;
			const formatted = formatPublicError(error, { t: (key: string) => key });
			expect(formatted.fieldErrors).toEqual([
				{ path: "title", message: "Choose another title" },
			]);
			expect(JSON.stringify(formatted)).not.toContain("private-");
		}
	});
	it("bounds the serialized bytes of oversized field paths and messages", () => {
		const formatted = formatPublicError(
			ApiError.badRequest(
				"Bad request",
				Array.from({ length: 20 }, () => ({
					path: "\u0000".repeat(9000),
					message: "\u0000".repeat(9000),
					value: "private-input",
				})),
			),
		);
		expect(formatted.fieldErrors).toHaveLength(8);
		for (const field of formatted.fieldErrors!) {
			expect(field.path).toHaveLength(256);
			expect(field.message).toHaveLength(200);
		}
		// JSON can escape each bounded character into six bytes.
		expect(Buffer.byteLength(JSON.stringify(formatted))).toBeLessThan(23_000);
		expect(JSON.stringify(formatted)).not.toContain("private-input");
	});
	it("does not read inherited field metadata, accessors or proxies while preserving plain feedback", () => {
		let calls = 0;
		const trap = () => {
			calls++;
			throw new Error("private-detail");
		};
		const inherited = { path: "title", message: "Choose another title" };
		Object.setPrototypeOf(inherited, {
			get validationIssue() {
				return trap();
			},
			get messageParams() {
				return trap();
			},
		});
		const accessor = Object.defineProperty(
			{ path: "slug", message: "Try again" },
			"validationIssue",
			{
				get: trap,
			},
		);
		const nested = {
			path: "name",
			message: "Try again",
			validationIssue: Object.defineProperty({}, "code", {
				enumerable: true,
				get: trap,
			}),
			messageParams: new Proxy(
				{},
				{ get: trap, getPrototypeOf: trap, ownKeys: trap },
			),
		};
		const proxy = new Proxy(
			{ path: "private-path", message: "private-message" },
			{
				get: trap,
				getPrototypeOf: trap,
				getOwnPropertyDescriptor: trap,
			},
		);
		const formatted = formatPublicError(
			ApiError.badRequest("Bad request", [inherited, accessor, nested, proxy]),
			{
				t: (key: string) => key,
			},
		);
		expect(formatted.fieldErrors).toEqual([
			{ path: "title", message: "Choose another title" },
			{ path: "slug", message: "Try again" },
			{ path: "name", message: "Try again" },
		]);
		expect(calls).toBe(0);
		expect(JSON.stringify(formatted)).not.toContain("private-");
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
