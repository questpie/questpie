import { describe, expect, it } from "bun:test";

import { z } from "zod";

import {
	assertCrdtFieldEligibility,
	getCrdtFieldEligibilityIssues,
} from "#questpie/server/fields/crdt.js";
import { text } from "#questpie/server/modules/core/fields/text.js";
import { textarea } from "#questpie/server/modules/core/fields/textarea.js";

describe("CRDT text field capability", () => {
	it("stores an immutable text marker and typed awareness schema", () => {
		const awareness = z
			.object({
				cursor: z.number().int().nonnegative().optional(),
			})
			.strict();
		const base = textarea().default("").required();
		const collaborative = base.crdt({ format: "text", awareness });

		expect(base._state.crdt).toBeUndefined();
		expect(collaborative._state.crdt).toEqual({
			format: "text",
			awarenessSchema: awareness,
		});
		expect(collaborative).not.toBe(base);
	});

	it("preserves the marker through legal builder call orders", () => {
		const before = textarea()
			.crdt({ format: "text" })
			.default("")
			.required()
			.label("Content")
			.access({ read: true, update: true });
		const after = textarea()
			.default("")
			.required()
			.label("Content")
			.access({ read: true, update: true })
			.crdt({ format: "text" });

		expect(before._state.crdt).toEqual({ format: "text" });
		expect(after._state.crdt).toEqual({ format: "text" });
		expect(() => assertCrdtFieldEligibility(before)).not.toThrow();
		expect(() => assertCrdtFieldEligibility(after)).not.toThrow();
	});

	it("reports every unsupported v1 field shape fail-closed", () => {
		const cases = [
			textarea().crdt({ format: "text" }),
			textarea().default("seed").required().crdt({ format: "text" }),
			textarea().default("").required().localized().crdt({ format: "text" }),
			textarea().default("").required().array().crdt({ format: "text" }),
			textarea().default("").required().virtual().crdt({ format: "text" }),
			textarea().default("").required().inputFalse().crdt({ format: "text" }),
			textarea().default("").required().outputFalse().crdt({ format: "text" }),
			textarea()
				.default("")
				.required()
				.hooks({ beforeChange: (value) => value })
				.crdt({ format: "text" }),
			textarea().default("").required().min(1).crdt({ format: "text" }),
			textarea()
				.default("")
				.required()
				.zod((schema) => schema)
				.crdt({ format: "text" }),
			textarea()
				.default("")
				.required()
				.fromDb((value) => value)
				.crdt({ format: "text" }),
			textarea()
				.default("")
				.required()
				.toDb((value) => value)
				.crdt({ format: "text" }),
			textarea()
				.default("")
				.required()
				.drizzle((column) => column)
				.crdt({ format: "text" }),
			textarea()
				.default("")
				.required()
				.crdt({ format: "text", awareness: {} as never }),
			text({ mode: "text" }).default("").required().crdt({ format: "text" }),
		];

		for (const field of cases) {
			expect(getCrdtFieldEligibilityIssues(field).length).toBeGreaterThan(0);
			expect(() => assertCrdtFieldEligibility(field)).toThrow(
				"Invalid QUESTPIE CRDT text field",
			);
		}
	});
});
