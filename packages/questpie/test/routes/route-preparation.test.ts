import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { z } from "zod";

import { prepareJsonRoute, route } from "../../src/exports/index.js";
import { isInTransaction } from "../../src/server/collection/crud/shared/transaction.js";
import { executeJsonRoute } from "../../src/server/routes/execute.js";
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
});
