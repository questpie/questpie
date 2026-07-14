import { describe, expect, it } from "bun:test";

import { z } from "zod";

import { zodToJsonSchema } from "./schemas.js";

describe("zodToJsonSchema", () => {
	it("preserves the input contract for transformed request schemas", () => {
		const schema = z.object({
			quantity: z
				.string()
				.min(1)
				.transform((value) => Number(value)),
		});

		expect(zodToJsonSchema(schema, "input")).toEqual({
			$schema: "https://json-schema.org/draft/2020-12/schema",
			type: "object",
			properties: {
				quantity: { type: "string", minLength: 1 },
			},
			required: ["quantity"],
		});
	});

	it("does not mislabel an unrepresentable transformed response as an object", () => {
		const schema = z.string().transform((value) => Number(value));

		expect(zodToJsonSchema(schema, "output")).toEqual({
			description:
				"This Zod output schema cannot be represented in JSON Schema; runtime validation remains authoritative.",
		});
	});

	it("retains representable constraints from refinements", () => {
		const schema = z
			.string()
			.min(3)
			.refine((value) => value !== "reserved");

		expect(zodToJsonSchema(schema, "input")).toMatchObject({
			type: "string",
			minLength: 3,
		});
	});
});
