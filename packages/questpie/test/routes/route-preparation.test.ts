import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { z } from "zod";

import { prepareJsonRoute, route } from "../../src/exports/index.js";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import { handleError } from "../../src/server/adapters/utils/response.js";
import { isInTransaction } from "../../src/server/collection/crud/shared/transaction.js";
import { executeJsonRoute } from "../../src/server/routes/execute.js";
import {
	parseTypedWire,
	stringifyTypedWire,
} from "../../src/shared/typed-wire.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";

describe("ordinary JSON route preparation", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	beforeAll(async () => {
		setup = await buildMockApp({});
	});
	afterAll(async () => {
		await setup.cleanup();
	});

	it("exposes parsed dependencies once and defers access, handler and output to the supplied context", async () => {
		let transforms = 0;
		let outputs = 0;
		const accessInputs: unknown[] = [];
		const handlerCalls: unknown[] = [];
		const request = new Request("http://fixture.local/items/real", {
			method: "POST",
		});
		const definition = route()
			.post()
			.params<{ id: string }>()
			.schema(
				z.object({
					size: z.string().transform((value) => {
						transforms++;
						return value.length;
					}),
				}),
			)
			.outputSchema(
				z.object({ size: z.number() }).transform((value) => {
					outputs++;
					return value;
				}),
			)
			.access((ctx) => {
				accessInputs.push((ctx as unknown as { input: unknown }).input);
				expect(ctx.params).toEqual({ id: "real" });
				expect(ctx.request).toBe(request);
				return true;
			})
			.handler(({ input, locale, params }) => {
				expect(isInTransaction()).toBe(false);
				handlerCalls.push({ input, locale, params });
				return input;
			});
		const prepared = prepareJsonRoute(
			setup.app,
			definition,
			{ size: "abc" },
			request,
			{ id: "real" },
		);
		expect(prepared.input).toEqual({ size: 3 });
		expect(transforms).toBe(1);
		expect(accessInputs).toEqual([]);
		expect(handlerCalls).toEqual([]);
		expect(outputs).toBe(0);
		for (const locale of ["en", "sk"]) {
			const context = {
				...(await setup.app.createContext({ accessMode: "user" })),
				locale,
			};
			expect(await prepared.execute(context)).toEqual({ size: 3 });
		}
		expect(transforms).toBe(1);
		expect(outputs).toBe(2);
		expect(accessInputs).toEqual([{ size: 3 }, { size: 3 }]);
		expect(handlerCalls).toEqual(
			["en", "sk"].map((locale) => ({
				input: { size: 3 },
				locale,
				params: { id: "real" },
			})),
		);
	});

	it("rejects invalid input at preparation without access, handler or output work", () => {
		let calls = 0;
		const definition = route()
			.post()
			.schema(z.object({ size: z.string() }))
			.outputSchema(
				z.object({ size: z.string() }).transform((value) => {
					calls++;
					return value;
				}),
			)
			.access(() => {
				calls++;
				return true;
			})
			.handler(({ input }) => {
				calls++;
				return input;
			});
		try {
			prepareJsonRoute(setup.app, definition, { size: 123 });
			throw new Error("expected input validation to fail");
		} catch (error) {
			expect(error).toMatchObject({ code: "VALIDATION_ERROR" });
		}
		expect(calls).toBe(0);
	});

	it("rejects oversized bounded input before parsing its elements or running access", () => {
		let elements = 0;
		let access = 0;
		const definition = route()
			.post()
			.schema(
				z.object({
					items: z
						.array(
							z.string().transform((value) => {
								elements++;
								return value;
							}),
						)
						.max(2),
				}),
			)
			.access(() => {
				access++;
				return true;
			})
			.handler(({ input }) => input);
		try {
			prepareJsonRoute(setup.app, definition, { items: ["a", "b", "c"] });
			throw new Error("expected input validation to fail");
		} catch (error) {
			expect(error).toMatchObject({ code: "VALIDATION_ERROR" });
		}
		expect(elements).toBe(0);
		expect(access).toBe(0);
	});

	it("uses parsed input for the same product rule through executeJsonRoute", async () => {
		let transforms = 0;
		const definition = route()
			.post()
			.schema(
				z.object({
					size: z.string().transform((value) => {
						transforms++;
						return value.length;
					}),
				}),
			)
			.access(
				(ctx) => (ctx as unknown as { input: { size: number } }).input.size > 0,
			)
			.handler(({ input }) => input);
		const context = await setup.app.createContext({ accessMode: "user" });
		expect(
			await executeJsonRoute(setup.app, definition, { size: "abc" }, context),
		).toEqual({ size: 3 });
		await expect(
			executeJsonRoute(setup.app, definition, { size: "" }, context),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(transforms).toBe(2);
	});
	it("classifies only input-transform Zod failures as HTTP validation errors and parses typed input once", async () => {
		let transforms = 0;
		let handlers = 0;
		const inner = z.object({ a: z.number() });
		const httpSetup = await buildMockApp({
			routes: {
				"nested:POST": route()
					.post()
					.schema(
						z.object({
							payload: z.string().transform((value) => {
								transforms++;
								return inner.parse(JSON.parse(value));
							}),
						}),
					)
					.access(true)
					.handler(({ input }) => {
						handlers++;
						const a: number = input.payload.a;
						return { a };
					}),
				"handler:POST": route()
					.post()
					.schema(z.object({}))
					.access(true)
					.handler(() => inner.parse({ a: "private-handler-input" })),
				"output:POST": route()
					.post()
					.outputSchema(inner)
					.access(true)
					.handler(() => ({ a: "private-output-input" }) as never),
			},
		});
		try {
			const handle = createFetchHandler(httpSetup.app);
			for (const [path, input, status, code] of [
				[
					"nested",
					{ payload: '{"a":"private-input"}' },
					400,
					"VALIDATION_ERROR",
				],
				["nested", { payload: 123 }, 400, "VALIDATION_ERROR"],
				[
					"nested",
					{ payload: "private-invalid-json" },
					500,
					"INTERNAL_SERVER_ERROR",
				],
				["handler", {}, 500, "INTERNAL_SERVER_ERROR"],
				["output", {}, 500, "INTERNAL_SERVER_ERROR"],
			] as const) {
				const response = await handle(
					new Request(`http://localhost/${path}`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(input),
					}),
				);
				expect(response!.status).toBe(status);
				const body = await response!.json();
				expect(body.error.code).toBe(code);
				if (status === 400) expect(body.error.fieldErrors).toHaveLength(1);
				else expect(body.error.fieldErrors).toBeUndefined();
				expect(JSON.stringify(body)).not.toContain("private-");
			}
			expect(transforms).toBe(2);
			expect(handlers).toBe(0);
			const response = await handle(
				new Request("http://localhost/nested", {
					method: "POST",
					headers: { "content-type": "application/json", "X-SuperJSON": "1" },
					body: stringifyTypedWire({ payload: '{"a":42}' }),
				}),
			);
			expect(response!.status).toBe(200);
			expect(parseTypedWire(await response!.text())).toEqual({ a: 42 });
			expect(transforms).toBe(3);
			expect(handlers).toBe(1);
		} finally {
			await httpSetup.cleanup();
		}
	});
	it("fails closed for a proxy thrown during input parsing without probing it", async () => {
		let calls = 0;
		const proxy = new Proxy(
			{},
			{
				getPrototypeOf() {
					calls++;
					throw new Error("private-proxy");
				},
				get() {
					calls++;
					throw new Error("private-proxy");
				},
			},
		);
		const definition = route()
			.post()
			.schema(
				z.unknown().transform(() => {
					throw proxy;
				}),
			)
			.handler(() => ({}));
		let thrown: unknown;
		try {
			prepareJsonRoute(setup.app, definition, {});
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBe(proxy);
		const response = handleError(thrown, { isDev: false });
		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			error: {
				code: "INTERNAL_SERVER_ERROR",
				message: "Internal server error",
			},
		});
		expect(calls).toBe(0);
	});
});
