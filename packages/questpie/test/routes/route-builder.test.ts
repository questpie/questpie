import { describe, expect, it } from "bun:test";

import { z } from "zod";

import { route } from "../../src/exports/index.js";
import { isJsonRoute, isRawRoute } from "../../src/server/routes/types.js";

describe("route builder", () => {
	it("creates a frozen raw POST route by default", () => {
		const def = route().handler(async () => new Response("ok"));

		expect(isRawRoute(def)).toBe(true);
		expect(def.method).toBe("POST");
		expect(Object.isFrozen(def)).toBe(true);
	});

	it("adds every supported method helper once when chained", () => {
		const def = route()
			.get()
			.post()
			.put()
			.delete()
			.patch()
			.head()
			.options()
			.get()
			.raw()
			.handler(async () => new Response("ok"));

		expect(def.method).toEqual([
			"GET",
			"POST",
			"PUT",
			"DELETE",
			"PATCH",
			"HEAD",
			"OPTIONS",
		]);
	});

	it("preserves JSON route schema, output schema, access, and params config", () => {
		const inputSchema = z.object({ name: z.string() });
		const outputSchema = z.object({ greeting: z.string() });
		const access = { execute: () => true };

		const def = route()
			.get()
			.params<{ id: string }>()
			.schema(inputSchema)
			.outputSchema(outputSchema)
			.access(access)
			.handler(async ({ input, params }) => ({
				greeting: `${params.id}:${input.name}`,
			}));

		expect(isJsonRoute(def)).toBe(true);
		expect(def.method).toBe("GET");
		expect(def.schema).toBe(inputSchema);
		expect(def.outputSchema).toBe(outputSchema);
		expect(def.access).toBe(access);
	});

	it("raw mode clears previous JSON validation config", () => {
		const def = route()
			.schema(z.object({ name: z.string() }))
			.outputSchema(z.object({ ok: z.boolean() }))
			.raw()
			.handler(async () => new Response("ok"));

		expect(isRawRoute(def)).toBe(true);
		expect("schema" in def).toBe(false);
		expect("outputSchema" in def).toBe(false);
	});

	it("schema mode can be selected after raw mode", () => {
		const inputSchema = z.object({ ok: z.boolean() });

		const def = route()
			.raw()
			.schema(inputSchema)
			.handler(async ({ input }) => ({ ok: input.ok }));

		expect(isJsonRoute(def)).toBe(true);
		expect(def.schema).toBe(inputSchema);
	});
});
